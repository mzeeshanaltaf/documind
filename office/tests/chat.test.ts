import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refusalLine } from "@/game/chat/lines";
import { firstSentence, plainText } from "@/game/chat/speech";
import { applyEvent, type ChatEvent, CUT_OFF, endTurn, newTurn, type NpcTurn, statusLine, streamChat } from "@/game/chat/sse";

// Phase O5 › Tests: `applyEvent` and `streamChat` over a recorded DocuMind SSE stream (a real
// Lahore reception answer, tests/fixtures/chat-answer.sse), plus the cases cut from it: an error
// mid-stream, a stream with no `done` (cut off), and a stop.

const RECORDED = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "chat-answer.sse"), "utf8").replace(/\r\n/g, "\n");
const BLOCKS = RECORDED.split("\n\n").filter((block) => block.trim());
const nameOf = (block: string) => /^event: (\w+)/m.exec(block)?.[1];
/** The stream up to and including the third delta. */
const PARTIAL = (() => {
  let deltas = 0;
  const end = BLOCKS.findIndex((block) => nameOf(block) === "delta" && ++deltas === 3);
  return `${BLOCKS.slice(0, end + 1).join("\n\n")}\n\n`;
})();

const URL = "/api/backend/orgs/org-1/chat";

function sseResponse(body: string | ReadableStream<Uint8Array>) {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** Runs one turn through `streamChat` with `fetch` answering `response`. */
async function run(response: Response | ((signal: AbortSignal) => Response), signal?: AbortSignal) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => (typeof response === "function" ? response(init.signal!) : response)),
  );
  let turn = newTurn("local-1", "How many days of annual leave do I get in Pakistan?", ["doc-1"]);
  const events: ChatEvent[] = [];
  const outcome = await streamChat(URL, { message: turn.question, document_ids: ["doc-1"] }, (event) => {
    events.push(event);
    turn = applyEvent(turn, event);
  }, signal);
  return { outcome, events, turn };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamChat + applyEvent", () => {
  it("builds a complete answer from the recorded stream", async () => {
    const { outcome, events, turn } = await run(sseResponse(RECORDED));
    expect(outcome).toEqual({ kind: "streamed", terminal: true });
    // sse-starlette's keep-alive comments (": ping") are not events.
    expect(BLOCKS.some((block) => block.startsWith(": ping"))).toBe(true);
    expect(events.map((e) => e.event)).toEqual(BLOCKS.map(nameOf).filter(Boolean));
    expect(turn.status).toBe("complete");
    expect(turn.phase).toBe("done");
    expect(turn.meta?.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(turn.id).toBe(turn.meta?.assistantMessageId);
    expect(turn.routing?.bypassed).toBe(true);
    expect(turn.sources.length).toBeGreaterThan(0);
    expect(turn.sources.every((s) => ["PK", "GLOBAL", "US"].includes(s.jurisdiction ?? ""))).toBe(true);
    expect(turn.citations.length).toBeGreaterThan(0);
    expect(turn.usage).not.toBeNull();
    const deltas = events.filter((e) => e.event === "delta").map((e) => (e.data as { text: string }).text).join("");
    expect(turn.content).toBe(deltas);
    expect(turn.content).toMatch(/\[\d+\]/);
  });

  it("keeps the partial answer and the message when an error arrives mid-stream", async () => {
    const body = `${PARTIAL}event: error\ndata: {"message": "The model is overloaded. Try again."}\n\n`;
    const { outcome, turn } = await run(sseResponse(body));
    expect(outcome).toEqual({ kind: "streamed", terminal: true });
    expect(turn).toMatchObject({ status: "error", phase: "done", error: "The model is overloaded. Try again." });
    expect(turn.content.length).toBeGreaterThan(0);
  });

  it("marks a stream that ends without done or error as cut off", async () => {
    const { outcome, turn } = await run(sseResponse(PARTIAL));
    expect(outcome).toEqual({ kind: "streamed", terminal: false });
    expect(turn.status).toBe("streaming");
    const ended = endTurn(turn, "ended");
    expect(ended).toMatchObject({ status: "error", error: CUT_OFF });
    expect(ended.content).toBe(turn.content);
  });

  it("stops: the abort rejects, and the turn keeps what had arrived", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const seen: { turn: NpcTurn | null } = { turn: null };
    const response = (signal: AbortSignal) =>
      sseResponse(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(encoder.encode(PARTIAL));
            signal.addEventListener("abort", () => stream.error(new DOMException("Aborted", "AbortError")));
            // Stop once the partial answer is in.
            setTimeout(() => controller.abort(), 20);
          },
        }),
      );
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => response(init.signal!)));
    let turn = newTurn("local-1", "Question?", null);
    await expect(
      streamChat(URL, { message: "Question?" }, (event) => {
        turn = applyEvent(turn, event);
        seen.turn = turn;
      }, controller.signal),
    ).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
    const stopped = endTurn(seen.turn!, "aborted");
    expect(stopped.status).toBe("stopped");
    expect(stopped.content.length).toBeGreaterThan(0);
  });

  it("returns refusals before the stream: quota, rate limit, unknown documents", async () => {
    const json = (status: number, error: object, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", ...headers } });

    const quota = await run(json(429, { code: "quota_exceeded", message: "Monthly quota reached.", details: { resets_on: "2026-11-01" } }));
    expect(quota.outcome).toMatchObject({ kind: "rejected", status: 429, code: "quota_exceeded", details: { resets_on: "2026-11-01" }, retryAfter: null });

    const limited = await run(json(429, { code: "rate_limited", message: "Slow down." }, { "Retry-After": "12" }));
    expect(limited.outcome).toMatchObject({ kind: "rejected", code: "rate_limited", retryAfter: 12 });

    const unknown = await run(json(422, { code: "unknown_documents", message: "Unknown documents.", details: { document_ids: ["x"] } }));
    expect(unknown.outcome).toMatchObject({ kind: "rejected", status: 422, code: "unknown_documents" });
    expect(unknown.events).toHaveLength(0);
  });

  it("sends the body DocuMind expects (no unknown fields)", async () => {
    const fetcher = vi.fn(async () => sseResponse("event: done\ndata: {}\n\n"));
    vi.stubGlobal("fetch", fetcher);
    await streamChat(URL, { conversation_id: null, message: "Hi", document_ids: ["a", "b"] }, () => undefined);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ conversation_id: null, message: "Hi", document_ids: ["a", "b"] });
  });
});

describe("applyEvent", () => {
  it("walks the status line through the phases", () => {
    let turn = newTurn("t", "Q", null);
    const lines = [statusLine(turn)];
    for (const event of [
      { event: "meta", data: { conversation_id: "c", user_message_id: "u", assistant_message_id: "a" } },
      { event: "routing", data: { departments: [], jurisdiction: null, bypassed: true } },
      { event: "sources", data: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }] },
      { event: "delta", data: { text: "Hello" } },
      { event: "done", data: {} },
    ]) {
      turn = applyEvent(turn, event);
      lines.push(statusLine(turn));
    }
    expect(lines).toEqual(["Looking up policies…", "Looking up policies…", "Looking up policies…", "Reading 6 sources…", "Answering…", ""]);
  });

  it("ignores events after the end, and unknown events", () => {
    const done = applyEvent(newTurn("t", "Q", null), { event: "done", data: {} });
    expect(applyEvent(done, { event: "delta", data: { text: "late" } })).toBe(done);
    const turn = newTurn("t", "Q", null);
    expect(applyEvent(turn, { event: "ping", data: {} })).toBe(turn);
  });
});

describe("NPC speech", () => {
  it("strips Markdown and citation markers", () => {
    expect(plainText("**You get** 14 days [1, 2] of _paid_ leave [3].\n\n- More")).toBe("You get 14 days of paid leave. More");
  });

  it("shows the first sentence once it's complete", () => {
    expect(firstSentence("You get 14 days of annual leave [2]", false)).toBeNull();
    expect(firstSentence("You get 14 days.", false)).toBeNull();
    expect(firstSentence("You get 14 days. After a year", false)).toBe("You get 14 days.");
    expect(firstSentence("You get 14 days", true)).toBe("You get 14 days");
    expect(firstSentence(`${"word ".repeat(60)}end.`, true)?.endsWith("…")).toBe(true);
  });
});

describe("refusal lines", () => {
  it("says each refusal in the NPC's voice", () => {
    expect(refusalLine({ code: "quota_exceeded", resetsOn: "2026-11-01" })).toBe("You've used this month's questions. They renew on 1 Nov.");
    expect(refusalLine({ code: "rate_limited", retryAfter: 12, until: 0 })).toBe("One moment, give me 12s.");
    expect(refusalLine({ code: "unknown_documents" })).toBe("My files just changed. One second.");
  });
});

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  type RunCaseOut,
  type RunDetail,
  type RunEvent,
  type RunStatus,
  TERMINAL_RUN_STATUSES,
} from "@/lib/api-types";

export type Transport = "stream" | "poll" | "idle";

const POLL_MS = 3000;
// EventSource retries on its own; after this many errors in a row we stop and poll instead.
const MAX_STREAM_ERRORS = 3;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

function isTerminal(status: RunStatus) {
  return TERMINAL_RUN_STATUSES.includes(status);
}

/** The SSE cursor after the newest case we already have: `<updated_at>|<id>` (routers/runs.py). */
function cursorOf(cases: Iterable<RunCaseOut>): string | null {
  let latest: RunCaseOut | null = null;
  for (const c of cases) {
    if (!latest || c.updated_at > latest.updated_at || (c.updated_at === latest.updated_at && c.id > latest.id)) {
      latest = c;
    }
  }
  return latest ? `${latest.updated_at}|${latest.id}` : null;
}

/**
 * Live run state. Starts from the server-rendered run and cases, then follows
 * `GET /runs/{id}/events` through the BFF: `run` events replace the counters and status, `case`
 * events upsert a case. When the run ends the stream is closed (the server ends it too, and
 * EventSource would otherwise reconnect forever) and the full detail is fetched once, for the
 * aggregates computed at finalize. If the stream keeps failing, SWR polls instead.
 */
export function useRunEvents(initialRun: RunDetail, initialCases: RunCaseOut[]) {
  const runId = initialRun.id;
  const [run, setRun] = useState<RunDetail>(initialRun);
  const [cases, setCases] = useState(() => new Map(initialCases.map((c) => [c.id, c])));
  const [transport, setTransport] = useState<Transport>(isTerminal(initialRun.status) ? "idle" : "stream");
  // The stream resumes after the newest case seen; read when (re)connecting, not on every update.
  const casesRef = useRef(cases);
  useEffect(() => {
    casesRef.current = cases;
  }, [cases]);

  const finish = useCallback(async () => {
    setTransport("idle");
    try {
      const [detail, list] = await Promise.all([
        getJson<RunDetail>(`/api/backend/runs/${runId}`),
        getJson<{ cases: RunCaseOut[] }>(`/api/backend/runs/${runId}/cases`),
      ]);
      setRun(detail);
      setCases(new Map(list.cases.map((c) => [c.id, c])));
    } catch (error) {
      console.error("Couldn't load the finished run", error);
    }
  }, [runId]);

  useEffect(() => {
    if (transport !== "stream") return;
    const cursor = cursorOf(casesRef.current.values());
    const url = `/api/backend/runs/${runId}/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
    const source = new EventSource(url);
    let errors = 0;

    source.onopen = () => {
      errors = 0;
    };
    source.addEventListener("run", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as RunEvent;
      setRun((current) => ({ ...current, ...data }));
      if (isTerminal(data.status)) {
        source.close();
        void finish();
      }
    });
    source.addEventListener("case", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as RunCaseOut;
      setCases((current) => new Map(current).set(data.id, data));
    });
    source.onerror = () => {
      errors += 1;
      if (source.readyState === EventSource.CLOSED || errors >= MAX_STREAM_ERRORS) {
        source.close();
        setTransport("poll");
      }
    };
    return () => source.close();
  }, [runId, transport, finish]);

  // Fallback: poll the detail and the cases until the run ends.
  const polling = transport === "poll";
  useSWR(polling ? `/api/backend/runs/${runId}` : null, getJson<RunDetail>, {
    refreshInterval: POLL_MS,
    onSuccess: (detail) => {
      setRun(detail);
      if (isTerminal(detail.status)) void finish();
    },
  });
  useSWR(polling ? `/api/backend/runs/${runId}/cases` : null, getJson<{ cases: RunCaseOut[] }>, {
    refreshInterval: POLL_MS,
    onSuccess: (list) => setCases(new Map(list.cases.map((c) => [c.id, c]))),
  });

  /** After a control action (pause, resume, stop) on a run that wasn't streaming. */
  const follow = useCallback(() => setTransport((t) => (t === "idle" ? "stream" : t)), []);

  const caseList = useMemo(() => [...cases.values()], [cases]);
  return { run, cases: caseList, transport, follow };
}

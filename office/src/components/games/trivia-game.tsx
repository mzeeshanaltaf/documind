"use client";

import { BookOpenIcon, CheckIcon, FlameIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { audio } from "@/game/audio/audio";
import type { TriviaBank } from "@/game/games/trivia/bank";
import { loadTriviaBank } from "@/game/games/trivia/banks";
import {
  type AnswerResult,
  advanceRound,
  answerQuestion,
  correctCount,
  pickRound,
  QUESTION_MS,
  QUESTION_SECONDS,
  type RoundQuestion,
  type RoundState,
  ROUND_SIZE,
  startRound,
  streakBonus,
  timeBonus,
} from "@/game/games/trivia/round";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { mulberry32 } from "@/game/world/city/random";
import { pageLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GameResult } from "./game-result";

/**
 * Policy Trivia (phase O8 › Policy Trivia): ten questions from the org's documents, weighted
 * towards this office's country plus the company-wide ones. 20 seconds each, four answers (keys
 * 1 to 4), a streak bonus; each answer is followed by its explanation and a "Show source" that
 * opens the PDF at the page the answer was checked against. No LLM call, so no quota.
 */
export default function TriviaGame({ onQuit }: { onQuit: () => void }) {
  const office = useGame((s) => s.office);
  const slug = office?.org.slug ?? "";
  const country = office?.place.country ?? null;
  const [bank, setBank] = useState<TriviaBank | null | "error" | undefined>(undefined);
  const [round, setRound] = useState<RoundState | null>(null);

  useEffect(() => {
    let live = true;
    loadTriviaBank(slug).then(
      (loaded) => live && setBank(loaded),
      () => live && setBank("error"),
    );
    return () => {
      live = false;
    };
  }, [slug]);

  function start(from: TriviaBank) {
    audio.play("ui-open", { volume: 0.4 });
    setRound(startRound(pickRound(from, country, mulberry32((Math.random() * 2 ** 32) >>> 0))));
  }

  if (bank === undefined) return <Centered><Spinner className="size-6" /></Centered>;
  if (bank === "error") return <Centered><p className="text-sm">The question bank couldn&apos;t be loaded.</p></Centered>;
  if (bank === null) {
    return (
      <Centered>
        <p className="font-heading text-lg font-semibold">No trivia for this org yet</p>
        <p className="max-w-sm text-center text-sm text-muted-foreground">Trivia needs a question bank made from the org&apos;s documents.</p>
        <Button autoFocus onClick={onQuit}>
          Back to the play area
        </Button>
      </Centered>
    );
  }

  if (!round) {
    return (
      <Centered>
        <div className="flex max-w-md flex-col gap-3 text-center">
          <p className="font-heading text-2xl font-semibold">Ten questions from your documents</p>
          <p className="text-sm text-muted-foreground">
            {QUESTION_SECONDS} seconds each, four answers. Questions lean towards {office?.place.role === "hub" ? "every office" : (office?.place.name ?? "this office")} and
            the company-wide policies. Answer fast and in a row for bonus points.
          </p>
        </div>
        <Button size="lg" autoFocus onClick={() => start(bank)}>
          Start <Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
        </Button>
      </Centered>
    );
  }

  if (round.phase === "done") {
    return (
      <Centered>
        <GameResult
          outcome={{ game: "trivia", score: round.score, details: { correct: correctCount(round), total: ROUND_SIZE, location: office?.place.id ?? "sandbox" } }}
          heading={`${correctCount(round)} of ${round.questions.length} correct`}
          onAgain={() => start(bank)}
          onQuit={onQuit}
        >
          <Missed round={round} />
        </GameResult>
      </Centered>
    );
  }

  return (
    <Question
      key={round.index}
      round={round}
      onAnswer={(choice, remainingMs) => setRound((current) => (current ? answerQuestion(current, choice, remainingMs) : current))}
      onNext={() => setRound((current) => (current ? advanceRound(current) : current))}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-4">{children}</div>;
}

/** The questions the player got wrong (or ran out of time on), with the right answer and its page. */
function Missed({ round }: { round: RoundState }) {
  const missed = round.results.map((result, index) => ({ result, question: round.questions[index] })).filter(({ result }) => !result.correct);
  if (missed.length === 0) return <p className="text-sm text-muted-foreground">A perfect round. Nothing to review.</p>;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Review {missed.length} missed</summary>
      <ul className="mt-2 flex max-h-44 flex-col gap-2 overflow-y-auto pr-1">
        {missed.map(({ question }) => (
          <li key={question.id} className="rounded-md bg-muted/60 px-2.5 py-2">
            <p className="leading-snug">{question.question}</p>
            <p className="mt-0.5 text-muted-foreground">
              {question.choices[question.answer]} · <span className="font-mono text-xs">{question.doc_code} {pageLabel(question.page, question.page)}</span>
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

type QuestionProps = {
  round: RoundState;
  onAnswer: (choice: number | null, remainingMs: number) => void;
  onNext: () => void;
};

/** One question, keyed by its index so its clock starts fresh. */
function Question({ round, onAnswer, onNext }: QuestionProps) {
  const question = round.questions[round.index];
  const asking = round.phase === "asking";
  const result: AnswerResult | undefined = round.phase === "reviewing" ? round.results[round.index] : undefined;
  const startedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const answer = useRef(onAnswer);
  useEffect(() => {
    answer.current = onAnswer;
  });

  // The clock: ticks while the question is open, and answers "time's up" when it runs out.
  useEffect(() => {
    if (!asking) return;
    startedAt.current = performance.now();
    const timer = window.setInterval(() => {
      const spent = performance.now() - startedAt.current;
      setElapsed(spent);
      if (spent >= QUESTION_MS) {
        window.clearInterval(timer);
        audio.play("ui-deny", { volume: 0.35 });
        answer.current(null, 0);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [asking]);

  function pick(choice: number) {
    if (!asking) return;
    const remaining = QUESTION_MS - (performance.now() - startedAt.current);
    audio.play(choice === question.answer ? "success" : "ui-deny", { volume: 0.4 });
    onAnswer(choice, remaining);
  }
  const picker = useRef(pick);
  useEffect(() => {
    picker.current = pick;
  });

  // Keys 1 to 4 answer (the dialog ignores the world's keys; these are the game's own).
  useEffect(() => {
    if (!asking) return;
    const onKey = (event: KeyboardEvent) => {
      const match = /^(?:Digit|Numpad)([1-4])$/.exec(event.code);
      if (!match || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      picker.current(Number(match[1]) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking]);

  const left = Math.max(0, QUESTION_SECONDS - elapsed / 1000);
  const warn = left <= 5;
  const streak = round.streak;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-center gap-3 overflow-y-auto p-4 sm:p-6" data-trivia-question={question.id}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-medium">
          Question {round.index + 1} of {round.questions.length}
        </span>
        <span className="text-muted-foreground tabular-nums">
          Score <span data-trivia-score="" className="font-medium text-foreground">{round.score}</span>
        </span>
        {streak >= 2 && (
          <span className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-accent-foreground">
            <FlameIcon className="size-3.5" aria-hidden /> {streak} in a row
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums" aria-hidden>
          {asking ? `${Math.ceil(left)} s` : result ? "" : ""}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Time left"
        aria-valuemin={0}
        aria-valuemax={QUESTION_SECONDS}
        aria-valuenow={Math.ceil(left)}
        className="h-1.5 w-full shrink-0 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-100 ease-linear", warn ? "bg-destructive" : "bg-primary")} style={{ width: `${(left / QUESTION_SECONDS) * 100}%` }} />
      </div>

      <div className="rounded-xl bg-popover p-4 ring-1 ring-foreground/10 sm:p-5">
        <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {question.department}
          {question.jurisdiction !== "GLOBAL" ? ` · ${question.jurisdiction}` : ""}
        </p>
        <h3 className="font-heading text-xl leading-snug font-semibold sm:text-2xl">{question.question}</h3>
      </div>

      <div role="group" aria-label="Answers" className="grid gap-2 sm:grid-cols-2">
        {question.choices.map((choice, index) => {
          const chosen = result?.choice === index;
          const right = result && index === question.answer;
          const wrong = chosen && !right;
          return (
            <button
              key={choice}
              type="button"
              disabled={!asking}
              data-choice={index}
              data-state={right ? "correct" : wrong ? "wrong" : undefined}
              onClick={() => pick(index)}
              className={cn(
                "flex items-center gap-3 rounded-lg bg-popover px-3 py-3 text-left text-[0.9375rem] leading-snug ring-1 ring-foreground/10 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                asking && "hover:bg-accent",
                right && "bg-primary/10 ring-2 ring-primary",
                wrong && "bg-destructive/10 ring-2 ring-destructive",
                result && !right && !wrong && "opacity-60",
              )}
            >
              <Kbd className="h-6 min-w-6 shrink-0 text-[0.8rem]">{index + 1}</Kbd>
              <span className="flex-1">{choice}</span>
              {right && <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden />}
              {wrong && <XIcon className="size-4 shrink-0 text-destructive" aria-hidden />}
            </button>
          );
        })}
      </div>

      {result && <Review question={question} result={result} streak={streak} onNext={onNext} last={round.index === round.questions.length - 1} />}
    </div>
  );
}

function Review({ question, result, streak, onNext, last }: { question: RoundQuestion; result: AnswerResult; streak: number; onNext: () => void; last: boolean }) {
  const documents = useGame((s) => s.office?.documents);
  const doc = documents?.find((d) => d.doc_code === question.doc_code && d.indexed_at !== null);

  function showSource() {
    if (!doc) return;
    audio.play("ui-open", { volume: 0.4 });
    useGame.getState().openViewer({
      documentId: doc.id,
      title: doc.title,
      docCode: doc.doc_code,
      page: question.page,
      pageEnd: question.page,
      highlightText: null,
      npc: null,
      department: doc.department,
    });
    emit({ type: "citation_opened", doc_code: question.doc_code, department: doc.department });
  }

  const headline = result.correct ? "Correct" : result.choice === null ? "Time's up" : "Not quite";
  const bonus = result.correct ? [`100 for the answer`, timeBonus(result.remainingMs) > 0 && `+${timeBonus(result.remainingMs)} for speed`, streakBonus(streak) > 0 && `+${streakBonus(streak)} for the streak`].filter(Boolean).join(" · ") : "";

  return (
    <div data-trivia-review="" className="flex flex-col gap-3 rounded-xl bg-popover p-4 ring-1 ring-foreground/10">
      <p aria-live="polite" className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn("font-heading text-lg font-semibold", result.correct ? "text-primary" : "text-destructive")}>{headline}</span>
        {result.correct && <span className="font-mono text-sm tabular-nums">+{result.points}</span>}
        {bonus && <span className="text-xs text-muted-foreground">{bonus}</span>}
        {!result.correct && <span className="text-sm text-muted-foreground">The answer is “{question.choices[question.answer]}”.</span>}
      </p>
      <p className="max-w-[65ch] text-[0.9375rem] leading-relaxed">{question.explanation}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {question.doc_code} · {pageLabel(question.page, question.page)}
        </span>
        <Button size="sm" variant="outline" disabled={!doc} onClick={showSource} data-show-source="">
          <BookOpenIcon data-icon="inline-start" aria-hidden />
          Show source
        </Button>
        <Button size="sm" autoFocus className="ml-auto" onClick={onNext} data-trivia-next="">
          {last ? "See your score" : "Next question"}
        </Button>
      </div>
    </div>
  );
}

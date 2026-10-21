"use client";

import { CheckIcon, EyeOffIcon, MinusIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { skipItem } from "@/app/(app)/review/actions";
import { ButtonLink } from "@/components/button-link";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { ReviewItem, ReviewItemSummary, ReviewNext, ReviewProgress, ReviewQueueDetail } from "@/lib/api-types";
import { shortId } from "@/lib/format";
import { metricLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { ItemReview } from "./item-review";
import { QueueProgress, SAMPLING_LABELS } from "./queues-table";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

function setItemParam(itemId: string | null) {
  const url = new URL(window.location.href);
  if (itemId) url.searchParams.set("item", itemId);
  else url.searchParams.delete("item");
  // Not router.replace: that would re-render the page and drop the reviewer's drafts.
  window.history.replaceState(window.history.state, "", url);
}

/** One reviewer working through a queue: the current case, the item strip, progress. */
export function ReviewSession({
  queue,
  initialItem,
  initialProgress,
}: {
  queue: ReviewQueueDetail;
  initialItem: ReviewItem | null;
  initialProgress: ReviewProgress;
}) {
  const base = `/api/backend/review-queues/${queue.id}`;
  const [item, setItem] = useState(initialItem);
  const [progress, setProgress] = useState(initialProgress);
  const [items, setItems] = useState<ReviewItemSummary[]>(queue.items);
  const [loading, startLoading] = useTransition();

  const mark = useCallback((itemId: string, patch: Partial<ReviewItemSummary>) => {
    setItems((current) => current.map((i) => (i.id === itemId ? { ...i, ...patch } : i)));
  }, []);

  const show = useCallback((next: ReviewItem | null) => {
    setItem(next);
    setItemParam(next?.id ?? null);
    window.scrollTo({ top: 0 });
  }, []);

  const goNext = useCallback(() => {
    startLoading(async () => {
      try {
        const next = await getJson<ReviewNext>(`${base}/next`);
        setProgress(next.progress);
        show(next.item);
      } catch {
        toast.error("Couldn't load the next case. Try again.");
      }
    });
  }, [base, show]);

  const open = useCallback(
    (itemId: string) => {
      startLoading(async () => {
        try {
          show(await getJson<ReviewItem>(`${base}/items/${itemId}`));
        } catch {
          toast.error("Couldn't open that case.");
        }
      });
    },
    [base, show],
  );

  const skip = useCallback(() => {
    if (!item) return;
    const skipped = item.id;
    startLoading(async () => {
      const result = await skipItem(queue.id, skipped);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      mark(skipped, { mine_skipped: true });
      setProgress(result.data.progress);
      show(result.data.item);
    });
  }, [item, mark, queue.id, show]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="font-heading text-2xl leading-tight font-semibold tracking-[-0.01em]">{queue.name}</h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <Link href={`/runs/${queue.run_id}`} className="hover:text-foreground hover:underline">
                {queue.run_name ?? <span className="font-mono">{shortId(queue.run_id)}</span>}
              </Link>
              <span>{queue.metrics.map(metricLabel).join(", ")}</span>
              <span>
                {SAMPLING_LABELS[queue.sampling]} · seed <span className="font-mono">{queue.seed}</span>
              </span>
              {queue.blind && (
                <span className="inline-flex items-center gap-1" title="The judge's grades show after you submit yours.">
                  <EyeOffIcon className="size-3.5" aria-hidden />
                  Blind
                </span>
              )}
            </p>
          </div>
          <ButtonLink href="/calibration" variant="outline" size="sm">
            Calibration
          </ButtonLink>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <QueueProgress progress={progress} />
          <ItemStrip items={items} currentId={item?.id ?? null} onOpen={open} disabled={loading} />
        </div>
      </header>

      {item ? (
        <ItemReview
          key={item.id}
          item={item}
          blind={queue.blind}
          busy={loading}
          onSubmitted={(result) => {
            setItem(result.item);
            setProgress(result.progress);
            mark(result.item.id, { mine_done: true, status: "done" });
          }}
          onNext={goNext}
          onSkip={skip}
        />
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>You&apos;ve been through this queue</EmptyTitle>
            <EmptyDescription>
              {progress.mine_skipped > 0
                ? `${progress.mine_done} graded, ${progress.mine_skipped} skipped. Open a skipped case from the strip above to grade it after all.`
                : `All ${progress.mine_done} cases graded.`}{" "}
              Calibration picks the grades up within a few seconds. A second reviewer grading the same queue adds the
              human-human ceiling.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <ButtonLink href="/calibration">See calibration</ButtonLink>
            <ButtonLink href="/review" variant="outline">
              All queues
            </ButtonLink>
          </EmptyContent>
        </Empty>
      )}
    </div>
  );
}

/** Every case of the queue as a numbered square: graded, skipped, current. Click to open one. */
function ItemStrip({
  items,
  currentId,
  onOpen,
  disabled,
}: {
  items: ReviewItemSummary[];
  currentId: string | null;
  onOpen: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <ol className="flex max-w-full flex-wrap gap-1" aria-label="Cases in this queue">
      {items.map((i) => {
        const state = i.mine_done ? "graded" : i.mine_skipped ? "skipped" : "to grade";
        return (
          <li key={i.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onOpen(i.id)}
              aria-current={i.id === currentId ? "true" : undefined}
              aria-label={`Case ${i.position}, ${i.case_key}: ${state}`}
              title={`${i.case_key} · ${state}${i.reviewers > 1 ? ` · ${i.reviewers} reviewers` : ""}`}
              className={cn(
                "flex size-7 items-center justify-center rounded-md border font-mono text-[0.7rem] tabular-nums transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
                i.mine_done && "border-transparent bg-muted text-success",
                i.mine_skipped && !i.mine_done && "border-dashed text-muted-foreground",
                i.id === currentId && "border-primary ring-1 ring-primary",
              )}
            >
              {i.mine_done ? (
                <CheckIcon className="size-3.5" aria-hidden />
              ) : i.mine_skipped ? (
                <MinusIcon className="size-3.5" aria-hidden />
              ) : (
                i.position
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

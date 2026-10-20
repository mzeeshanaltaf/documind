"use client";

import { ChevronLeftIcon, ChevronRightIcon, DatabaseIcon, MoreHorizontalIcon, PlayIcon, TrashIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  approveCandidate,
  commitBatch,
  deleteBatch,
  rejectCandidate,
  restoreCandidate,
  resumeBatch,
  updateCandidate,
} from "@/app/(app)/synthetic/actions";
import { OptionSelect } from "@/components/app/option-select";
import { FormAlert } from "@/components/auth/form-alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ActionResult } from "@/lib/eval-api";
import type { Candidate, CandidatePatch, DatasetOut, SyntheticBatch } from "@/lib/api-types";
import { formatCost, formatCount } from "@/lib/format";
import { BatchProgress } from "./batches-table";
import { CandidatePanel, type PanelMode } from "./candidate-panel";
import { BatchStatusBadge, batchTitle, typeLabel } from "./labels";
import { SourceExcerpts } from "./source-excerpts";

type Filter = "pending" | "approved" | "rejected" | "all";
const ALL_TYPES = "__all";
const POLL_MS = 3000;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

function matches(candidate: Candidate, filter: Filter, type: string): boolean {
  if (type !== ALL_TYPES && candidate.type !== type) return false;
  if (filter === "all") return true;
  // Still-generating candidates join the review queue: they turn reviewable in place.
  if (filter === "pending") return candidate.status === "pending";
  return candidate.status === filter && candidate.gen_status !== "queued";
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || !!target.closest("[role=listbox],[role=menu],[role=dialog]");
}

export function BatchReview({
  initialBatch,
  initialCandidates,
  datasets,
}: {
  initialBatch: SyntheticBatch;
  initialCandidates: Candidate[];
  datasets: DatasetOut[];
}) {
  const batchUrl = `/api/backend/synthetic-batches/${initialBatch.id}`;
  const { data: batch = initialBatch, mutate: mutateBatch } = useSWR(batchUrl, getJson<SyntheticBatch>, {
    fallbackData: initialBatch,
    refreshInterval: (latest) => (latest?.status === "generating" ? POLL_MS : 0),
  });
  const generating = batch.status === "generating";
  const { data: listing, mutate: mutateCandidates } = useSWR(
    `${batchUrl}/candidates`,
    getJson<{ candidates: Candidate[] }>,
    { fallbackData: { candidates: initialCandidates }, refreshInterval: generating ? POLL_MS : 0 },
  );
  const candidates = useMemo(() => listing?.candidates ?? [], [listing]);

  const [filter, setFilter] = useState<Filter>("pending");
  const [type, setType] = useState(ALL_TYPES);
  const visible = useMemo(() => candidates.filter((c) => matches(c, filter, type)), [candidates, filter, type]);
  // The current candidate by id; when it leaves the filtered list (approved from "to review"),
  // the one that slid into its position takes over.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(0);
  const foundIndex = visible.findIndex((c) => c.id === currentId);
  const index = foundIndex >= 0 ? foundIndex : Math.min(anchor, Math.max(visible.length - 1, 0));
  const current = visible[index] ?? null;

  const [mode, setMode] = useState<PanelMode>("view");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const go = useCallback(
    (next: number) => {
      if (!visible.length) return;
      const clamped = Math.max(0, Math.min(visible.length - 1, next));
      setCurrentId(visible[clamped].id);
      setAnchor(clamped);
      setMode("view");
      setError(null);
    },
    [visible],
  );

  function chooseFilter(next: Filter) {
    setFilter(next);
    setCurrentId(null);
    setAnchor(0);
    setMode("view");
  }

  const apply = useCallback(
    (run: () => Promise<ActionResult<Candidate>>, { advance }: { advance: boolean }) => {
      if (!current) return;
      setError(null);
      const position = index;
      startTransition(async () => {
        const result = await run();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const updated = result.data;
        await mutateCandidates(
          (data) => ({ candidates: (data?.candidates ?? []).map((c) => (c.id === updated.id ? updated : c)) }),
          { revalidate: false },
        );
        void mutateBatch();
        setMode("view");
        if (!advance) return;
        // Stay on the slot: if the candidate left the filter the next one moves up into it,
        // otherwise step forward.
        if (matches(updated, filter, type)) go(position + 1);
        else {
          setCurrentId(null);
          setAnchor(position);
        }
      });
    },
    [current, index, mutateCandidates, mutateBatch, filter, type, go],
  );

  const approve = useCallback(() => {
    if (current && current.gen_status === "generated" && current.status !== "approved" && !current.case_id)
      apply(() => approveCandidate(current.id), { advance: true });
  }, [apply, current]);

  const reject = useCallback(
    (reason: string | null) => {
      if (current) apply(() => rejectCandidate(current.id, reason), { advance: true });
    },
    [apply, current],
  );

  const restore = useCallback(() => {
    if (current) apply(() => restoreCandidate(current.id), { advance: false });
  }, [apply, current]);

  const save = useCallback(
    (patch: CandidatePatch) => {
      if (current) apply(() => updateCandidate(current.id, patch), { advance: false });
    },
    [apply, current],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || mode !== "view") return;
      const editable = current && current.gen_status === "generated" && !current.case_id;
      if (e.key === "j") go(index + 1);
      else if (e.key === "k") go(index - 1);
      else if (e.key === "a" && editable) approve();
      else if (e.key === "e" && editable) setMode("edit");
      else if (e.key === "r" && current && !current.case_id && current.status !== "rejected") setMode("reject");
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approve, current, go, index, mode]);

  const counts = batch.counts;
  const uncommitted = Math.max(counts.approved - counts.committed, 0);
  const typeOptions = Object.keys(batch.by_type);
  const quotes = current?.evidence_quotes ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-2xl leading-tight font-semibold tracking-[-0.01em]">{batchTitle(batch)}</h1>
              <BatchStatusBadge status={batch.status} reason={batch.status_reason} />
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{batch.kind === "enrichment" ? "Reference answers" : "New test cases"}</span>
              {batch.target_dataset && (
                <Link href={`/datasets/${batch.target_dataset.id}`} className="font-mono text-xs hover:text-foreground hover:underline">
                  {batch.target_dataset.slug}
                  {batch.kind === "enrichment" && batch.config.dataset_version ? ` v${batch.config.dataset_version}` : ""}
                </Link>
              )}
              <span className="font-mono text-xs">{batch.org_slug}</span>
              <span className="font-mono text-xs">{batch.config.generator_model ?? "claude-opus-5-5"}</span>
              {batch.config.seed != null && <span className="font-mono text-xs">seed {batch.config.seed}</span>}
              <span className="tabular-nums">
                {formatCost(batch.cost_usd)}
                {batch.max_cost_usd != null && <> of {formatCost(batch.max_cost_usd)} cap</>}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {batch.status === "paused" && <ResumeButton batch={batch} onDone={() => void mutateBatch()} />}
            <CommitButton batch={batch} datasets={datasets} uncommitted={uncommitted} onDone={() => {
              void mutateBatch();
              void mutateCandidates();
            }} />
            <BatchMenu batch={batch} />
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <BatchProgress batch={batch} />
          <ShortfallNote batch={batch} />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            aria-label="Show"
            variant="outline"
            size="sm"
            spacing={0}
            value={[filter]}
            onValueChange={(v: string[]) => v[0] && chooseFilter(v[0] as Filter)}
          >
            <ToggleGroupItem value="pending">To review · {formatCount(counts.pending + counts.queued)}</ToggleGroupItem>
            <ToggleGroupItem value="approved">Approved · {formatCount(counts.approved)}</ToggleGroupItem>
            <ToggleGroupItem value="rejected">Rejected · {formatCount(counts.rejected)}</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
          {typeOptions.length > 1 && (
            <OptionSelect
              aria-label="Case type"
              size="sm"
              value={type}
              onValueChange={(v) => {
                setType(v);
                setCurrentId(null);
                setAnchor(0);
              }}
              options={[
                { value: ALL_TYPES, label: "All types" },
                ...typeOptions.map((t) => ({ value: t, label: typeLabel(t) })),
              ]}
              className="w-40"
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground lg:inline">
            <kbd className="font-mono">a</kbd> approve · <kbd className="font-mono">e</kbd> edit · <kbd className="font-mono">r</kbd> reject ·{" "}
            <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> next/previous
          </span>
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {visible.length ? `${index + 1} of ${visible.length}` : "0 of 0"}
          </span>
          <Button variant="outline" size="icon" aria-label="Previous candidate (k)" onClick={() => go(index - 1)} disabled={index <= 0}>
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next candidate (j)"
            onClick={() => go(index + 1)}
            disabled={index >= visible.length - 1}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      {current ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
          <CandidatePanel
            key={current.id}
            candidate={current}
            mode={mode}
            busy={busy}
            error={error}
            onMode={(m) => {
              setError(null);
              setMode(m);
            }}
            onApprove={approve}
            onReject={reject}
            onRestore={restore}
            onSave={save}
          />
          <div className="lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)] lg:self-start lg:overflow-y-auto">
            <SourceExcerpts candidate={current} quotes={quotes} />
          </div>
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{filter === "pending" ? "Nothing left to review" : "No candidates here"}</EmptyTitle>
            <EmptyDescription>
              {filter === "pending"
                ? uncommitted
                  ? `Commit the ${uncommitted} approved candidate${uncommitted === 1 ? "" : "s"} into a dataset draft, or look through the rejected ones.`
                  : "Look through the rejected candidates: an auto-rejected one can still be approved."
                : "Pick another filter or type."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

function ShortfallNote({ batch }: { batch: SyntheticBatch }) {
  const short = Object.entries(batch.config.shortfall ?? {}).filter(([, n]) => (n ?? 0) > 0);
  const skipped = batch.config.skipped?.length ?? 0;
  if (!short.length && !skipped) return null;
  return (
    <p className="max-w-[65ch] text-xs text-muted-foreground">
      {short.length > 0 && (
        <>
          Fewer seeds than asked: {short.map(([t, n]) => `${typeLabel(t)} −${n}`).join(", ")} (not enough matching
          passages in the selected documents).{" "}
        </>
      )}
      {skipped > 0 && <>{skipped} case{skipped === 1 ? "" : "s"} skipped (already referenced, or no expected documents).</>}
    </p>
  );
}

function CommitButton({
  batch,
  datasets,
  uncommitted,
  onDone,
}: {
  batch: SyntheticBatch;
  datasets: DatasetOut[];
  uncommitted: number;
  onDone: () => void;
}) {
  const uid = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const enrichment = batch.kind === "enrichment";
  const [datasetId, setDatasetId] = useState(batch.target_dataset_id ?? datasets[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dataset = datasets.find((d) => d.id === datasetId);

  function commit() {
    setError(null);
    startTransition(async () => {
      const result = await commitBatch(batch.id, enrichment ? null : datasetId || null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { dataset: target, version, added, updated, skipped } = result.data;
      setOpen(false);
      onDone();
      const what = enrichment ? `${updated} case${updated === 1 ? "" : "s"} updated` : `${added} case${added === 1 ? "" : "s"} added`;
      toast.success(`${what} in ${target.name} v${version.version} (draft).`, {
        description: skipped.length ? `${skipped.length} skipped: ${skipped[0].reason.replace(/_/g, " ")}` : undefined,
        action: { label: "Open draft", onClick: () => router.push(`/datasets/${target.id}/v/${version.version}`) },
      });
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={uncommitted === 0}>
        <DatabaseIcon data-icon="inline-start" />
        Commit {uncommitted > 0 ? formatCount(uncommitted) : ""} approved
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Commit approved candidates</AlertDialogTitle>
            <AlertDialogDescription>
              {enrichment
                ? `The ${uncommitted} approved references are written onto their cases in ${batch.target_dataset?.name ?? "the dataset"}'s draft version.`
                : `The ${uncommitted} approved candidates are added as new cases (source: synthetic) to the dataset's draft version.`}{" "}
              Without a draft, one is created from the latest version. Published versions never change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormAlert message={error} />
          {!enrichment && (
            <Field>
              <FieldLabel htmlFor={`${uid}-dataset`}>Dataset</FieldLabel>
              <OptionSelect
                id={`${uid}-dataset`}
                value={datasetId}
                onValueChange={setDatasetId}
                options={datasets.map((d) => ({ value: d.id, label: d.name }))}
                placeholder="Create a dataset first"
                className="w-full"
              />
              {dataset && (
                <FieldDescription>
                  {dataset.latest_version?.status === "draft"
                    ? `Goes into its draft v${dataset.latest_version.version}.`
                    : `Creates draft v${(dataset.latest_version?.version ?? 0) + 1}.`}
                </FieldDescription>
              )}
            </Field>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button onClick={commit} disabled={pending || (!enrichment && !datasetId)}>
              {pending && <Spinner data-icon="inline-start" />}
              Commit {formatCount(uncommitted)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ResumeButton({ batch, onDone }: { batch: SyntheticBatch; onDone: () => void }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const atCap = batch.status_reason === "budget";
  const [cap, setCap] = useState(() => String(Math.max((batch.max_cost_usd ?? 0) * 2, batch.estimate_usd * 2).toFixed(2)));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resume() {
    setError(null);
    startTransition(async () => {
      const result = await resumeBatch(batch.id, atCap ? Number(cap) : null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      toast.success("Generation resumed.");
      onDone();
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => (atCap ? setOpen(true) : resume())} disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
        Resume
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Raise the cost cap</AlertDialogTitle>
            <AlertDialogDescription>
              This batch has spent {formatCost(batch.cost_usd)} of its {formatCost(batch.max_cost_usd)} cap with{" "}
              {batch.candidate_count - batch.generated_count - batch.failed_count} candidates still to write.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormAlert message={error} />
          <Field>
            <FieldLabel htmlFor={`${uid}-cap`}>New cap (USD)</FieldLabel>
            <Input
              id={`${uid}-cap`}
              type="number"
              min={0}
              step="0.5"
              inputMode="decimal"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="font-mono"
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button onClick={resume} disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Resume
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BatchMenu({ batch }: { batch: SyntheticBatch }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteBatch(batch.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Batch deleted.");
      router.push("/synthetic");
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More actions" />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
            <TrashIcon />
            Delete batch
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this batch?</AlertDialogTitle>
            <AlertDialogDescription>
              Its candidates and review decisions go too. Cases already committed stay in their dataset, and the spend stays
              in the month&apos;s total.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormAlert message={error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Delete batch
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}



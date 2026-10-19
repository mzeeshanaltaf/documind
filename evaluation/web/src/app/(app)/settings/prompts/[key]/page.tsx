import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import type { PromptDiff, PromptVersion } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson, apiJsonOrNull } from "@/lib/eval-api";
import { formatDateTime, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Judge prompt" };

export default function PromptPage({ params, searchParams }: PageProps<"/settings/prompts/[key]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Prompt params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function int(value: string | string[] | undefined): number | null {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A unified diff, line by line: additions and removals get a tint and a +/− gutter, not colour alone. */
function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="text-sm text-muted-foreground">The two versions have the same body.</p>;
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/30 py-2 font-mono text-xs leading-relaxed">
      {diff.split("\n").map((line, i) => {
        const kind = line.startsWith("+++") || line.startsWith("---") ? "file" : line[0];
        return (
          <div
            key={i}
            className={cn(
              "px-3 whitespace-pre-wrap",
              kind === "+" && "bg-success/10 text-foreground",
              kind === "-" && "bg-destructive/10 text-foreground",
              kind === "@" && "text-info",
              kind === "file" && "text-muted-foreground",
            )}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

async function Prompt({
  params,
  searchParams,
}: {
  params: PageProps<"/settings/prompts/[key]">["params"];
  searchParams: PageProps<"/settings/prompts/[key]">["searchParams"];
}) {
  const { user } = await requireAdmin();
  const [{ key: rawKey }, query] = await Promise.all([params, searchParams]);
  const key = decodeURIComponent(rawKey);
  const versions = await apiJsonOrNull<PromptVersion[]>(`prompts/${encodeURIComponent(key)}/versions`, { userId: user.id });
  if (!versions?.length) notFound();

  const latest = versions[0];
  const selected = versions.find((v) => v.version === int(query.v)) ?? latest;
  const from = int(query.from);
  const to = int(query.to);
  const diff =
    from && to
      ? await apiJson<PromptDiff>(`prompts/${encodeURIComponent(key)}/diff`, { userId: user.id, query: { from, to } })
      : null;
  const base = `/settings/prompts/${encodeURIComponent(key)}`;

  return (
    <PageContainer className="max-w-5xl gap-8">
      <div>
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/settings" className="hover:text-foreground hover:underline">
            Settings
          </Link>
          <span aria-hidden>/</span>
          <Link href="/settings/prompts" className="hover:text-foreground hover:underline">
            Judge prompts
          </Link>
        </nav>
        <PageHeader title={key} description={`${versions.length} version${versions.length === 1 ? "" : "s"}; the newest is used by new runs.`} />
      </div>

      <section aria-labelledby="versions" className="flex flex-col gap-3">
        <h2 id="versions" className="font-sans text-sm font-semibold">
          Versions
        </h2>
        <ol className="flex flex-col divide-y rounded-lg border">
          {versions.map((v, i) => {
            const previous = versions[i + 1];
            return (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Link
                    href={`${base}?v=${v.version}`}
                    aria-current={v.version === selected.version && !diff ? "true" : undefined}
                    className={cn("font-mono font-medium hover:underline", v.version === selected.version && !diff && "text-primary")}
                  >
                    v{v.version}
                  </Link>
                  <span className="font-mono text-xs text-muted-foreground">{shortId(v.sha256)}</span>
                  <span className="font-mono text-xs">
                    {v.model}
                    {v.effort && ` · ${v.effort}`}
                    {v.thinking && ` · thinking ${v.thinking}`}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(v.created_at)}</span>
                </span>
                {previous && (
                  <Link href={`${base}?from=${previous.version}&to=${v.version}`} className="text-sm text-primary underline-offset-4 hover:underline">
                    Diff with v{previous.version}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {diff ? (
        <section aria-labelledby="diff" className="flex flex-col gap-3">
          <h2 id="diff" className="font-sans text-sm font-semibold">
            v{diff.from_version} → v{diff.to_version}
          </h2>
          <DiffView diff={diff.diff} />
        </section>
      ) : (
        <section aria-labelledby="body" className="flex flex-col gap-3">
          <h2 id="body" className="font-sans text-sm font-semibold">
            v{selected.version} body
          </h2>
          <pre className="max-h-[70svh] overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {selected.body}
          </pre>
          {selected.output_schema && (
            <details className="rounded-lg border">
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Output schema</summary>
              <pre className="overflow-auto border-t p-4 font-mono text-xs leading-relaxed">
                {JSON.stringify(selected.output_schema, null, 2)}
              </pre>
            </details>
          )}
        </section>
      )}
    </PageContainer>
  );
}

import { ChevronRightIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { HealthOut, SystemInfo } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings />
    </Suspense>
  );
}

function Ok({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  const Icon = ok ? CircleCheckIcon : CircleAlertIcon;
  return (
    <span className={cn("inline-flex items-center gap-1.5", ok ? "text-success" : "text-destructive")}>
      <Icon className="size-4" aria-hidden />
      {ok ? yes : no}
    </span>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="flex flex-col">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 border-b py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-all sm:text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 className="font-sans text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

const mono = (value: string | null | undefined) => <span className="font-mono text-xs">{value ?? "n/a"}</span>;

async function evalHealth(): Promise<HealthOut | null> {
  // /health is public on the eval API (no key); read it server-side for the DB check.
  try {
    const response = await fetch(`${process.env.EVAL_API_URL?.replace(/\/+$/, "")}/health`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as HealthOut) : null;
  } catch {
    return null;
  }
}

async function Settings() {
  const { user } = await requireAdmin();
  const [system, health] = await Promise.all([apiJson<SystemInfo>("system", { userId: user.id }), evalHealth()]);
  const { documind } = system;

  return (
    <PageContainer className="max-w-4xl gap-10">
      <PageHeader title="Settings" description="What Evaluation is connected to, and the versions every run snapshots." />

      <Section title="Connectivity">
        <Rows
          rows={[
            ["Eval API", <Ok key="api" ok={!!health} yes={`up, ${health?.version === "dev" ? "dev" : (health?.version ?? "").slice(0, 8)}`} no="unreachable" />],
            ["Eval database", <Ok key="db" ok={health?.db === "ok"} yes={`ok, schema ${system.eval.db_schema}`} no="error" />],
            ["DocuMind", <Ok key="dm" ok={documind.reachable} yes={`reachable at ${documind.url ?? "n/a"}`} no={`unreachable${documind.error ? ` (${documind.error})` : ""}`} />],
            ["DocuMind version", mono(documind.version)],
            ["Anthropic", <Ok key="an" ok={system.anthropic.reachable} yes="key works" no={system.anthropic.configured ? `unreachable${system.anthropic.error ? ` (${system.anthropic.error})` : ""}` : "ANTHROPIC_API_KEY is not set"} />],
            ["Sign-in accounts", <span key="auth">DocuMind&apos;s, schema {mono(system.eval.auth_schema)}</span>],
            ["Worker slots", `${system.eval.worker_slots} (DocuMind ${system.eval.documind_concurrency} at a time, judge ${system.eval.judge_concurrency})`],
          ]}
        />
      </Section>

      <Section
        title="Service users"
        description="DocuMind accounts the harness acts as: eval-bot asks the questions, eval-probe checks access control (E8)."
      >
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {system.service_users.map((u) => {
                const healthy = u.found && !u.banned && (u.role === "service" ? u.is_admin : !u.is_admin);
                return (
                  <TableRow key={u.role}>
                    <TableCell>{u.role === "service" ? "Service (platform admin)" : "Probe (non-admin)"}</TableCell>
                    <TableCell className="max-w-0 min-w-48">
                      <span className="block truncate text-sm">{u.email ?? "not configured"}</span>
                      <span className="block truncate font-mono text-[0.7rem] text-muted-foreground">{u.id ?? "set EVAL_SERVICE_USER_ID / EVAL_PROBE_USER_ID"}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Ok
                        ok={healthy}
                        yes="ok"
                        no={!u.id ? "not set" : !u.found ? "not found" : u.banned ? "banned" : u.role === "service" ? "not an admin" : "is an admin"}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Pricing and prompt fingerprints" description="Hashes recorded in every run's snapshot; a change explains a cost or score shift.">
        <Rows
          rows={[
            ["Judge pricing (judge-pricing.json)", mono(system.eval.judge_pricing_sha256)],
            ["DocuMind pricing (model-pricing.json)", mono(documind.pricing_sha256)],
            ...Object.entries(documind.prompt_hashes ?? {}).map(
              ([key, hash]) => [`DocuMind prompt: ${key}`, mono(hash)] as [string, React.ReactNode],
            ),
          ]}
        />
      </Section>

      <Link
        href="/settings/prompts"
        className="flex items-center justify-between gap-3 rounded-lg border p-4 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Judge prompts</span>
          <span className="text-xs text-muted-foreground">Every version of every judge prompt, with diffs between them.</span>
        </span>
        <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    </PageContainer>
  );
}

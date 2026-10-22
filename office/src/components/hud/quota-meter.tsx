"use client";

import { useGame } from "@/game/store/game-store";
import type { Quota } from "@/lib/api-types";
import { formatCompact, formatCount, formatDayMonth, type QuotaLevel, quotaLevel, useQuota } from "@/lib/quota";
import { cn } from "@/lib/utils";

/**
 * The monthly DocuMind allowance, top right (phase O5 › Quota meter): two thin bars (messages,
 * tokens) and DocuMind's composer wording. Amber when running low, red when used up, with the
 * state in words too. Hidden for platform admins (`unlimited`) and outside an org.
 */
const BAR: Record<QuotaLevel, string> = { ok: "bg-primary", low: "bg-warning", exhausted: "bg-destructive" };

function Bar({ used, limit, level }: { used: number; limit: number; level: QuotaLevel }) {
  const fill = limit ? Math.min(1, used / limit) : 1;
  return (
    <span aria-hidden className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
      <span className={cn("block h-full rounded-full", BAR[level])} style={{ width: `${Math.max(fill * 100, used > 0 ? 4 : 0)}%` }} />
    </span>
  );
}

export function QuotaMeter() {
  const inOrg = useGame((s) => s.office !== null);
  const { data: quota } = useQuota();
  if (!inOrg || !quota || quota.unlimited) return null;
  return <Meter quota={quota} />;
}

function Meter({ quota }: { quota: Quota }) {
  const level = quotaLevel(quota);
  const messagesLevel: QuotaLevel = level === "exhausted" ? "exhausted" : quota.message_limit - quota.messages_used <= 3 ? "low" : "ok";
  const tokensLevel: QuotaLevel = level === "exhausted" ? "exhausted" : quota.tokens_used >= quota.token_limit * 0.9 ? "low" : "ok";
  return (
    <div
      data-quota-level={level}
      className="pointer-events-auto flex h-9 items-center gap-3 rounded-lg bg-background/92 px-3 text-[0.7rem] text-muted-foreground tabular-nums shadow-sm ring-1 ring-foreground/10"
    >
      <span className="inline-flex items-center gap-1.5">
        <Bar used={quota.messages_used} limit={quota.message_limit} level={messagesLevel} />
        <span data-quota="messages">
          {formatCount(quota.messages_used)} of {formatCount(quota.message_limit)} messages
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 max-sm:hidden">
        <Bar used={quota.tokens_used} limit={quota.token_limit} level={tokensLevel} />
        {formatCompact(quota.tokens_used)} of {formatCompact(quota.token_limit)} tokens
      </span>
      <span className={cn("max-md:hidden", level === "exhausted" && "font-medium text-destructive", level === "low" && "font-medium text-warning")}>
        {level === "exhausted" ? "Used up · " : level === "low" ? "Running low · " : ""}renews {formatDayMonth(quota.resets_on)}
      </span>
    </div>
  );
}

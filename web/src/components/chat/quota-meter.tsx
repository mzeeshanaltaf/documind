import Link from "next/link";
import type { Quota } from "@/lib/api-types";
import { formatCompact, formatCount, formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

function Bar({ used, limit }: { used: number; limit: number }) {
  const fill = limit ? Math.min(1, used / limit) : 1;
  return (
    <span aria-hidden className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
      <span
        className={cn("block h-full rounded-full", fill >= 1 ? "bg-destructive" : "bg-primary")}
        style={{ width: `${Math.max(fill * 100, used > 0 ? 4 : 0)}%` }}
      />
    </span>
  );
}

/** "12 of 25 messages · 31K of 100K tokens this month", under the composer. Admins see nothing. */
export function QuotaMeter({ quota, myAnalyticsHref }: { quota: Quota; myAnalyticsHref: string }) {
  if (quota.unlimited) return null;
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground tabular-nums">
      <span className="inline-flex items-center gap-1.5">
        <Bar used={quota.messages_used} limit={quota.message_limit} />
        {formatCount(quota.messages_used)} of {formatCount(quota.message_limit)} messages
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Bar used={quota.tokens_used} limit={quota.token_limit} />
        {formatCompact(quota.tokens_used)} of {formatCompact(quota.token_limit)} tokens
      </span>
      <span>
        this month, renews {formatDayMonth(quota.resets_on)}.{" "}
        <Link href={myAnalyticsHref} className="underline underline-offset-2 hover:text-foreground">
          Details
        </Link>
      </span>
    </p>
  );
}

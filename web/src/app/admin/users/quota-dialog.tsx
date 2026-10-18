"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Quota } from "@/lib/api-types";
import { formatCompact, formatCount } from "@/lib/format";
import { resetUserQuota, updateUserQuota } from "./actions";

type Defaults = { message_limit: number; token_limit: number };

function parseCount(value: string): number | null {
  const trimmed = value.replace(/[,\s_]/g, "");
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** Set one user's monthly message and token limits; usage so far this month is shown for context. */
export function QuotaDialog({
  open,
  onOpenChange,
  userId,
  label,
  quota,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  label: string;
  quota: Quota | null;
  defaults: Defaults;
}) {
  const id = useId();
  const [messages, setMessages] = useState(String(quota?.message_limit ?? defaults.message_limit));
  const [tokens, setTokens] = useState(String(quota?.token_limit ?? defaults.token_limit));
  const [pending, startTransition] = useTransition();

  const messageLimit = parseCount(messages);
  const tokenLimit = parseCount(tokens);
  const valid = messageLimit !== null && tokenLimit !== null;

  function run(action: () => ReturnType<typeof updateUserQuota>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) run(() => updateUserQuota(userId, messageLimit, tokenLimit));
          }}
        >
          <DialogHeader>
            <DialogTitle>Monthly quota for {label}</DialogTitle>
            <DialogDescription>
              {quota
                ? `Used so far this month: ${formatCount(quota.messages_used)} messages and ${formatCompact(quota.tokens_used)} tokens. `
                : ""}
              The quota renews on the 1st of each month (UTC). Questions are refused once either limit is reached; 0 blocks
              chatting.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={messageLimit === null || undefined}>
              <FieldLabel htmlFor={`${id}-messages`}>Messages per month</FieldLabel>
              <Input
                id={`${id}-messages`}
                inputMode="numeric"
                value={messages}
                aria-invalid={messageLimit === null}
                onChange={(e) => setMessages(e.target.value)}
              />
              <FieldDescription>Default: {formatCount(defaults.message_limit)}. Each question sent counts as one.</FieldDescription>
            </Field>
            <Field data-invalid={tokenLimit === null || undefined}>
              <FieldLabel htmlFor={`${id}-tokens`}>Tokens per month</FieldLabel>
              <Input
                id={`${id}-tokens`}
                inputMode="numeric"
                value={tokens}
                aria-invalid={tokenLimit === null}
                onChange={(e) => setTokens(e.target.value)}
              />
              <FieldDescription>
                Default: {formatCount(defaults.token_limit)}. Counts input and output tokens of every model call made for them.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" disabled={pending || !quota?.is_custom} onClick={() => run(() => resetUserQuota(userId))}>
              Reset to default
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !valid}>
                {pending && <Spinner data-icon="inline-start" />}
                Save quota
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

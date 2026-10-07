"use client";

import { MessageSquareTextIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteConversation, renameConversation } from "@/app/(app)/app/[orgSlug]/chat/actions";
import {
  AlertDialog,
  AlertDialogAction,
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { Conversation } from "@/lib/api-types";
import { cn } from "@/lib/utils";

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  orgSlug: string;
  onNewChat: () => void;
  onNavigate?: () => void;
  onRenamed: (conversation: Conversation) => void;
  onDeleted: (id: string) => void;
};

const DAY = 86_400_000;

function bucket(updatedAt: string, now: number) {
  const age = now - new Date(updatedAt).getTime();
  if (age < DAY) return "Today";
  if (age < 7 * DAY) return "Previous 7 days";
  if (age < 30 * DAY) return "Previous 30 days";
  return "Older";
}

export function ConversationList({ conversations, activeId, orgSlug, onNewChat, onNavigate, onRenamed, onDeleted }: Props) {
  const [now] = useState(() => Date.now());
  const groups = new Map<string, Conversation[]>();
  for (const c of conversations) {
    const key = bucket(c.updated_at, now);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  return (
    <nav aria-label="Conversations" className="flex min-h-0 flex-1 flex-col">
      <div className="p-2">
        <Button variant="outline" className="w-full justify-start" onClick={onNewChat}>
          <PlusIcon data-icon="inline-start" />
          New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Your questions and answers are saved here.
          </p>
        ) : (
          [...groups.entries()].map(([label, items]) => (
            <section key={label} className="pt-3" aria-label={label}>
              <h2 className="px-2 pb-1 font-sans text-xs font-medium text-muted-foreground">{label}</h2>
              <ul className="flex flex-col gap-0.5">
                {items.map((c) => (
                  <ConversationItem
                    key={c.id}
                    conversation={c}
                    active={c.id === activeId}
                    orgSlug={orgSlug}
                    onNavigate={onNavigate}
                    onRenamed={onRenamed}
                    onDeleted={onDeleted}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}

function ConversationItem({
  conversation,
  active,
  orgSlug,
  onNavigate,
  onRenamed,
  onDeleted,
}: {
  conversation: Conversation;
  active: boolean;
  orgSlug: string;
  onNavigate?: () => void;
  onRenamed: (conversation: Conversation) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const title = conversation.title || "Untitled conversation";

  function rename(value: string) {
    const next = value.trim();
    setEditing(false);
    if (!next || next === conversation.title) return;
    onRenamed({ ...conversation, title: next });
    startTransition(async () => {
      const result = await renameConversation(orgSlug, conversation.id, next);
      if (result.ok) onRenamed(result.data);
      else {
        onRenamed(conversation);
        toast.error(result.error);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteConversation(orgSlug, conversation.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirming(false);
      onDeleted(conversation.id);
      toast.success("Conversation deleted.");
    });
  }

  return (
    <li
      className={cn(
        "group/item relative flex items-center rounded-md transition-colors hover:bg-muted",
        active && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
      )}
    >
      {editing ? (
        <input
          aria-label="Conversation title"
          defaultValue={conversation.title ?? ""}
          maxLength={200}
          autoFocus
          className="h-8 w-full rounded-md border border-ring bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => rename(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <Link
          href={`/app/${orgSlug}/chat/${conversation.id}`}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <MessageSquareTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className={cn("truncate", !conversation.title && "text-muted-foreground")}>{title}</span>
          {pending && <Spinner className="ml-auto size-3" />}
        </Link>
      )}

      {!editing && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${title}`}
                className="mr-1 shrink-0 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 max-md:opacity-100"
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{title}&rdquo; and its answers are removed for good. The documents it cited aren&apos;t affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={remove}>
              {pending && <Spinner data-icon="inline-start" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

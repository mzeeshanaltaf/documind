"use client";

import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useId, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SendResult } from "@/hooks/use-chat-stream";
import { ScopeChips, ScopePicker } from "./scope-picker";
import type { CatalogDoc } from "./types";

const MAX_CHARS = 4000;

export type ComposerHandle = { focus: () => void };

type Props = {
  ref?: React.Ref<ComposerHandle>;
  documents: CatalogDoc[];
  scope: string[];
  onScopeChange: (ids: string[]) => void;
  streaming: boolean;
  onSend: (text: string) => Promise<SendResult>;
  onStop: () => void;
};

export function Composer({ ref, documents, scope, onScopeChange, streaming, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  async function submit() {
    const value = text.trim();
    if (!value || streaming) return;
    setText("");
    // A rejected send (rate limit, network) gives the question back.
    if ((await onSend(value)) === "rejected") setText((current) => current || value);
  }

  return (
    <form
      className="rounded-xl border bg-card shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ScopeChips documents={documents} selected={scope} onChange={onScopeChange} disabled={streaming} />
      <label htmlFor={`${hintId}-input`} className="sr-only">
        Your question
      </label>
      <textarea
        id={`${hintId}-input`}
        ref={textareaRef}
        value={text}
        maxLength={MAX_CHARS}
        rows={1}
        placeholder={scope.length ? "Ask about the selected documents…" : "Ask a question about your policies…"}
        aria-describedby={hintId}
        className="field-sizing-content block max-h-60 min-h-12 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted-foreground"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <ScopePicker documents={documents} selected={scope} onChange={onScopeChange} disabled={streaming} />
        <p id={hintId} className="ml-auto hidden text-xs text-muted-foreground sm:block">
          Enter to send, Shift+Enter for a new line
        </p>
        {streaming ? (
          <Button type="button" size="icon" variant="outline" aria-label="Stop answering" onClick={onStop}>
            <SquareIcon className="fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Send question" disabled={!text.trim()} className="max-sm:ml-auto">
            <ArrowUpIcon />
          </Button>
        )}
      </div>
    </form>
  );
}

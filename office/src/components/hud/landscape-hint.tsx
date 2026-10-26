"use client";

import { RotateCwIcon, XIcon } from "lucide-react";
import { useState } from "react";

/**
 * A phone held upright gets a one-line nudge to turn it: the joystick and the Use button need
 * the width (phase O10 › Mobile). Pure CSS decides when it shows (coarse pointer, portrait);
 * closing it hides it until the next visit.
 */
export function LandscapeHint() {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div
      role="note"
      className="pointer-events-auto fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 hidden items-center gap-3 rounded-xl bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 [@media(pointer:coarse)_and_(orientation:portrait)]:flex"
    >
      <RotateCwIcon aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">The office plays best with your phone turned sideways.</p>
      <button
        type="button"
        onClick={() => setClosed(true)}
        aria-label="Dismiss"
        className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <XIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}

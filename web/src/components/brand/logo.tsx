import { cn } from "@/lib/utils";

/**
 * DocuMind mark: an ink-green tile holding a page whose middle line is
 * highlighted, the "cited passage". Colours come from the design tokens so the
 * mark follows light/dark mode.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path
        d="M10.5 7.5h7.4l4.6 4.6v11.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1Z"
        fill="var(--primary-foreground)"
      />
      <path d="M17.9 7.5v3.6a1 1 0 0 0 1 1h3.6" fill="var(--primary)" fillOpacity="0.28" />
      <rect x="11.75" y="12.6" width="5" height="1.5" rx="0.75" fill="var(--primary)" opacity="0.45" />
      <rect x="10.75" y="15.6" width="10.5" height="3.2" rx="0.8" fill="var(--highlight)" />
      <rect x="11.75" y="16.45" width="8.5" height="1.5" rx="0.75" fill="var(--highlight-foreground)" opacity="0.85" />
      <rect x="11.75" y="20.4" width="6.5" height="1.5" rx="0.75" fill="var(--primary)" opacity="0.45" />
    </svg>
  );
}

export function Logo({
  className,
  markClassName,
  showWordmark = true,
}: {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <LogoMark className={markClassName} title={showWordmark ? undefined : "DocuMind"} />
      {showWordmark && (
        <span className="font-heading text-[1.2rem] leading-none font-semibold tracking-[-0.015em]">
          DocuMind
        </span>
      )}
    </span>
  );
}

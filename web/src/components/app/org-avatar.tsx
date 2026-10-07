import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";

/** Square monogram tile for an organization (no logos uploaded yet). */
export function OrgAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-heading text-[0.8rem] font-semibold text-primary-foreground",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

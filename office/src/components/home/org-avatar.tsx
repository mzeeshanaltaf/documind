import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";

/**
 * Square tile for an organization: its logo when it has one, else the monogram (copied from
 * web/src/components/app/org-avatar.tsx, synced 2026-10-22, plus the logo branch).
 */
export function OrgAvatar({ name, logo, className }: { name: string; logo?: string | null; className?: string }) {
  if (logo) {
    return (
      // A logo can live on any host, so it skips next/image (which needs each host allow-listed).
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} alt="" className={cn("size-8 shrink-0 rounded-md border bg-background object-contain", className)} />
    );
  }
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

"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Mobile-only bar with the sidebar trigger. The chat has its own header (with the trigger), so it's skipped there. */
export function MobileTopBar({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const pathname = usePathname();
  const chatBase = `/app/${orgSlug}/chat`;
  if (pathname === chatBase || pathname.startsWith(`${chatBase}/`)) return null;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-3 md:hidden">
      <SidebarTrigger />
      <span className="truncate text-sm font-medium">{orgName}</span>
    </div>
  );
}

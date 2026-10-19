import { Logo } from "@/components/brand/logo";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Mobile-only bar with the sidebar trigger. */
export function MobileTopBar() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
      <SidebarTrigger />
      <Logo markClassName="size-6" />
    </div>
  );
}

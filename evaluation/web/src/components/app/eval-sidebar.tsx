"use client";

import {
  ClipboardCheckIcon,
  DatabaseIcon,
  GaugeIcon,
  GitCompareArrowsIcon,
  LayoutDashboardIcon,
  PlayIcon,
  Settings2Icon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, LogoMark } from "@/components/brand/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { type ShellUser, UserMenu } from "./user-menu";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType;
  /** The phase that builds it; until then the item is shown disabled. */
  phase?: string;
};

const WORK: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/datasets", label: "Datasets", icon: DatabaseIcon },
  { href: "/runs", label: "Runs", icon: PlayIcon },
  { href: "/compare", label: "Compare", icon: GitCompareArrowsIcon },
  { href: "/trends", label: "Trends", icon: TrendingUpIcon },
];
const QUALITY: NavItem[] = [
  { href: "/synthetic", label: "Synthetic", icon: SparklesIcon, phase: "E7" },
  { href: "/review", label: "Review", icon: ClipboardCheckIcon, phase: "E9" },
  { href: "/calibration", label: "Calibration", icon: GaugeIcon, phase: "E9" },
];

function NavItems({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <SidebarMenu>
      {items.map(({ href, label, icon: Icon, phase }) => {
        if (phase) {
          return (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton aria-disabled disabled tooltip={`${label} (not built yet)`} className="opacity-60">
                <Icon />
                <span>{label}</span>
              </SidebarMenuButton>
              <SidebarMenuBadge className="font-mono text-[0.625rem] text-muted-foreground">{phase}</SidebarMenuBadge>
            </SidebarMenuItem>
          );
        }
        const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <SidebarMenuItem key={href}>
            <SidebarMenuButton
              render={<Link href={href} aria-current={active ? "page" : undefined} />}
              isActive={active}
              tooltip={label}
            >
              <Icon />
              <span>{label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function EvalSidebar({ user }: { user: ShellUser }) {
  const pathname = usePathname();
  const settingsActive = pathname.startsWith("/settings");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/"
          aria-label="Evaluation dashboard"
          className="flex h-12 items-center rounded-md px-1.5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo className="group-data-[collapsible=icon]:hidden" />
          <LogoMark className="hidden size-6 group-data-[collapsible=icon]:block" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NavItems items={WORK} pathname={pathname} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Quality</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={QUALITY} pathname={pathname} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/settings" aria-current={settingsActive ? "page" : undefined} />}
                  isActive={settingsActive}
                  tooltip="Settings"
                >
                  <Settings2Icon />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

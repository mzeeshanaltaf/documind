"use client";

import { ChartLineIcon, FileTextIcon, MessageSquareTextIcon, Settings2Icon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { OrgSwitcher } from "./org-switcher";
import type { ShellOrg, ShellUser } from "./types";
import { UserMenu } from "./user-menu";

const ASK = [{ segment: "chat", label: "Chat", icon: MessageSquareTextIcon }];
// Admin-only: hidden here, and every page re-checks server-side.
const MANAGE = [
  { segment: "documents", label: "Documents", icon: FileTextIcon },
  { segment: "members", label: "Members", icon: UsersIcon },
  { segment: "settings", label: "Settings", icon: Settings2Icon },
  { segment: "analytics", label: "Analytics", icon: ChartLineIcon },
];

function NavItems({ items, base, pathname }: { items: typeof ASK; base: string; pathname: string }) {
  return (
    <SidebarMenu>
      {items.map(({ segment, label, icon: Icon }) => {
        const href = `${base}/${segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <SidebarMenuItem key={segment}>
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

export function AppSidebar({ org, orgs, user }: { org: ShellOrg; orgs: ShellOrg[]; user: ShellUser }) {
  const pathname = usePathname();
  const base = `/app/${org.slug}`;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrgSwitcher current={org} orgs={orgs} isAdmin={user.isAdmin} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NavItems items={ASK} base={base} pathname={pathname} />
          </SidebarGroupContent>
        </SidebarGroup>
        {user.isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Manage</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavItems items={MANAGE} base={base} pathname={pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

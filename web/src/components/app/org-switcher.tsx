"use client";

import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { OrgAvatar } from "./org-avatar";
import type { ShellOrg } from "./types";

export function OrgSwitcher({ current, orgs, isAdmin }: { current: ShellOrg; orgs: ShellOrg[]; isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <OrgAvatar name={current.name} />
            <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span className="truncate text-sm font-semibold">{current.name}</span>
              <span className="truncate text-xs text-muted-foreground">Organization</span>
            </span>
            <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
            <Command>
              <CommandInput placeholder="Find an organization…" />
              <CommandList>
                <CommandEmpty>No organization by that name.</CommandEmpty>
                <CommandGroup heading={isAdmin ? "All organizations" : "Your organizations"}>
                  {orgs.map((org) => (
                    <CommandItem
                      key={org.id}
                      value={`${org.name} ${org.slug}`}
                      onSelect={() => go(`/app/${org.slug}/chat`)}
                    >
                      <OrgAvatar name={org.name} className="size-6 text-[0.65rem]" />
                      <span className="truncate">{org.name}</span>
                      {org.id === current.id && <CheckIcon className="ml-auto" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {isAdmin && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem value="create organization new" onSelect={() => go("/app/new-org")}>
                        <PlusIcon />
                        Create organization
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

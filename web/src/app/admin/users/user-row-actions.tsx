"use client";

import { BanIcon, MoreHorizontalIcon, ShieldIcon, ShieldOffIcon, UserCheckIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { type ActionResult, setBanned, setPlatformAdmin } from "./actions";

type Confirm = { kind: "demote" | "ban" } | null;

export function UserRowActions({
  userId,
  label,
  isAdmin,
  isBanned,
  isEnvAdmin,
}: {
  userId: string;
  label: string;
  isAdmin: boolean;
  isBanned: boolean;
  isEnvAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm>(null);

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      setConfirm(null);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`} disabled={pending} />}
        >
          {pending ? <Spinner /> : <MoreHorizontalIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuGroup>
            {isAdmin ? (
              <DropdownMenuItem
                disabled={isEnvAdmin}
                onClick={() => setConfirm({ kind: "demote" })}
                title={isEnvAdmin ? "Listed in PLATFORM_ADMIN_EMAILS" : undefined}
              >
                <ShieldOffIcon />
                {isEnvAdmin ? "Admin via env (locked)" : "Remove platform admin"}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => run(() => setPlatformAdmin(userId, true))}>
                <ShieldIcon />
                Make platform admin
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {isBanned ? (
              <DropdownMenuItem onClick={() => run(() => setBanned(userId, false))}>
                <UserCheckIcon />
                Restore access
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: "ban" })}>
                <BanIcon />
                Suspend account
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "ban" ? `Suspend ${label}?` : `Remove ${label} as platform admin?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "ban"
                ? "They're signed out everywhere and can't sign in until you restore access. Their memberships are kept."
                : "They keep access to the organizations they're a member of, but can no longer manage organizations, members or documents."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(() => (confirm?.kind === "ban" ? setBanned(userId, true) : setPlatformAdmin(userId, false)))
              }
            >
              {pending && <Spinner data-icon="inline-start" />}
              {confirm?.kind === "ban" ? "Suspend" : "Remove admin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

"use client";

import { MoreHorizontalIcon, RotateCwIcon, UserMinusIcon, XIcon } from "lucide-react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { type ActionResult, cancelInvitation, removeMember, resendInvitation } from "./actions";

function report(result: ActionResult) {
  if (result.ok) toast.success(result.message);
  else toast.error(result.error);
}

export function RemoveMemberButton({
  orgSlug,
  orgName,
  memberId,
  label,
}: {
  orgSlug: string;
  orgName: string;
  memberId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} onClick={() => setOpen(true)}>
        <UserMinusIcon />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to {orgName} right away. You can add them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep access</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  report(await removeMember(orgSlug, memberId));
                  setOpen(false);
                })
              }
            >
              {pending && <Spinner data-icon="inline-start" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function InvitationActions({
  orgSlug,
  invitationId,
  email,
}: {
  orgSlug: string;
  invitationId: string;
  email: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${email}`} disabled={pending} />}
      >
        {pending ? <Spinner /> : <MoreHorizontalIcon />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => startTransition(async () => report(await resendInvitation(orgSlug, invitationId)))}
          >
            <RotateCwIcon />
            Resend invitation
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => startTransition(async () => report(await cancelInvitation(orgSlug, invitationId)))}
          >
            <XIcon />
            Withdraw invitation
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

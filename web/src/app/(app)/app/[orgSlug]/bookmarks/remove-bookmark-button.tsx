"use client";

import { BookmarkXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setBookmark } from "../chat/actions";

export function RemoveBookmarkButton({ orgSlug, messageId }: { orgSlug: string; messageId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove bookmark"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setBookmark(orgSlug, messageId, false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Bookmark removed.");
                router.refresh();
              })
            }
          />
        }
      >
        {pending ? <Spinner /> : <BookmarkXIcon />}
      </TooltipTrigger>
      <TooltipContent>Remove bookmark</TooltipContent>
    </Tooltip>
  );
}

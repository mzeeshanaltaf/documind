import { LockIcon, PencilLineIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Published = frozen (lock); draft = still editable (pencil). */
export function VersionBadge({ status }: { status: "draft" | "published" }) {
  return status === "published" ? (
    <Badge variant="outline" className="gap-1 text-success">
      <LockIcon />
      Published
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-warning">
      <PencilLineIcon />
      Draft
    </Badge>
  );
}

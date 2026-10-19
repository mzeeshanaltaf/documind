import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Form-level message, announced to screen readers. */
export function FormAlert({ message, tone = "error" }: { message: string | null; tone?: "error" | "success" }) {
  if (!message) return null;
  const Icon = tone === "error" ? CircleAlertIcon : CircleCheckIcon;
  return (
    <Alert variant={tone === "error" ? "destructive" : "default"} role={tone === "error" ? "alert" : "status"}>
      <Icon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

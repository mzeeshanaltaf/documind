import { cn } from "@/lib/utils";

export function PageContainer({ className, children }: { className?: string; children: React.ReactNode }) {
  return <main className={cn("mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-8 md:px-10 md:py-10", className)}>{children}</main>;
}

import { Skeleton } from "@/components/ui/skeleton";

/** Static stand-in for the app shell while the session and org stream in. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-svh w-full" aria-busy="true" aria-label="Loading">
      <div className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-3 md:flex">
        <div className="flex items-center gap-2 p-1">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex flex-col gap-2 px-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
      <PageSkeleton />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-10" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-64 w-full max-w-4xl" />
    </div>
  );
}

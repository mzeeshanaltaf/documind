import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { SourcePanel } from "@/components/auth/source-panel";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/" className="self-start rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <Logo />
        </Link>
        <main className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[22rem]">{children}</div>
        </main>
        <p className="text-xs text-muted-foreground">
          Answers come from your organization&apos;s own documents, with the page they came from.
        </p>
      </div>
      <SourcePanel />
    </div>
  );
}

import { DirectoryPanel } from "@/components/auth/directory-panel";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Logo className="self-start" />
        <main className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[22rem]">{children}</div>
        </main>
        <p className="text-xs text-muted-foreground">Sign in with your DocuMind account. Questions count toward your DocuMind allowance.</p>
      </div>
      <DirectoryPanel />
    </div>
  );
}

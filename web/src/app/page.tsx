import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/button-link";

// Interim home until the marketing site lands in Phase 7.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <Logo markClassName="size-10" className="[&>span:last-child]:text-3xl" />
      <p className="max-w-md text-balance text-muted-foreground">
        Turn company documents into an intelligent assistant.
      </p>
      <div className="flex gap-2">
        <ButtonLink href="/sign-in">
          Sign in
        </ButtonLink>
        <ButtonLink href="/sign-up" variant="outline">
          Create an account
        </ButtonLink>
      </div>
    </main>
  );
}

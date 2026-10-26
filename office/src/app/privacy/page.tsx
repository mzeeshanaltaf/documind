import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { DOCUMIND_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy" };

const UPDATED = "26 October 2026";

/**
 * What the Office itself stores, in plain words. Everything about accounts, documents and chat
 * is DocuMind's: its (legally reviewed) Privacy Policy is the source, and this page links to
 * it instead of restating it.
 */
export default function OfficePrivacyPage() {
  return (
    <div className="flex min-h-svh flex-1 flex-col px-4 py-8 sm:px-10">
      <Link
        href="/"
        aria-label="Office home"
        className="self-start rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Logo />
      </Link>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 py-12">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight">Privacy</h1>
          <p className="text-sm text-muted-foreground">DocuMind Office · updated {UPDATED}</p>
        </div>

        <p className="text-[0.9375rem] leading-relaxed">
          The Office is a 3D front door to DocuMind. You sign in with your DocuMind account, and the experts you talk to
          are DocuMind chats. So everything about your account, your organization&apos;s documents, your questions and
          the answers is covered by{" "}
          <a
            href={`${DOCUMIND_URL}/privacy`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            DocuMind&apos;s Privacy Policy
          </a>
          . This page only lists what the Office adds.
        </p>

        <section className="flex flex-col gap-2" aria-labelledby="stores">
          <h2 id="stores" className="font-heading text-xl font-semibold">
            What the Office stores about you
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-[0.9375rem] leading-relaxed">
            <li>
              <strong>Your look and settings:</strong> your avatar colours, display name and preferences (volume, quality,
              reduced motion).
            </li>
            <li>
              <strong>Your progress, per organization:</strong> quests and achievements, access cards you hold, offices
              and rooms you have visited, and counts such as questions asked and citations opened. Never the text of a
              question or an answer.
            </li>
            <li>
              <strong>Game scores:</strong> your score in each mini-game, when you played, and a few numbers about the
              round (such as items sorted).
            </li>
            <li>
              <strong>Leaderboard name:</strong> your first name and last initial, shown to members of the same
              organization (and its platform admins). You can hide yourself from the leaderboards in the menu, and your
              scores then no longer appear.
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="questions">
          <h2 id="questions" className="font-heading text-xl font-semibold">
            Your questions to the experts
          </h2>
          <p className="text-[0.9375rem] leading-relaxed">
            A question to a department expert is sent to DocuMind like any chat. It appears in your DocuMind
            conversation history and counts toward your monthly DocuMind quota. The Office keeps no copy of it. Trivia,
            greetings and the other games never call an AI model.
          </p>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="technical">
          <h2 id="technical" className="font-heading text-xl font-semibold">
            Cookies and analytics
          </h2>
          <p className="text-[0.9375rem] leading-relaxed">
            One session cookie keeps you signed in to the Office; it is separate from your DocuMind session. The Office
            also keeps your settings in your browser&apos;s local storage so they apply at once. Page views and a few
            game events (such as entering an office or finishing a game) may be counted with Umami, which is self-hosted,
            sets no cookies, doesn&apos;t store IP addresses and receives no names or message content.
          </p>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="control">
          <h2 id="control" className="font-heading text-xl font-semibold">
            Your choices
          </h2>
          <p className="text-[0.9375rem] leading-relaxed">
            Office progress and scores are deleted along with your DocuMind account. To have them deleted sooner, or to
            ask anything else about your data, use the contact page in{" "}
            <a href={`${DOCUMIND_URL}/contact`} className="font-medium text-primary underline-offset-4 hover:underline">
              DocuMind
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}

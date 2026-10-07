import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/contact-form";
import { CONTAINER } from "@/components/marketing/nav";
import { contactErrorMessage } from "@/lib/contact";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Contact",
  description: "Talk to us about setting up DocuMind for your company's policies, or send feedback.",
  alternates: { canonical: "/contact" },
};

// Rendered per request, without a Suspense fallback: the no-JS form post redirects
// here with ?sent=1 / ?error=…, and the result has to be in the HTML itself
// (a streamed Suspense boundary only resolves with JavaScript).
export const instant = false;

const TOPICS = [
  {
    title: "Setting up DocuMind",
    body: "Tell us roughly how many policy documents you have, which countries they cover, and who will ask the questions.",
  },
  {
    title: "Already a member somewhere?",
    body: "Access to an organization is granted by its admin. Ask them to add the email address you signed up with.",
  },
  {
    title: "Feedback and bugs",
    body: "An answer that cited the wrong page, a question it should have handled: we want to hear about it.",
  },
];

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const params = await searchParams;
  const sent = params.sent === "1";
  const error = contactErrorMessage(typeof params.error === "string" ? params.error : undefined);

  return (
    // Phones: intro, form, topics. Desktop: intro and topics on the left, the form beside them.
    <div
      className={cn(
        CONTAINER,
        "grid gap-10 py-[clamp(3.5rem,2.5rem+4vw,6.5rem)] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-20 lg:gap-y-10",
      )}
    >
      <div>
        <h1 className="font-heading text-[clamp(2.25rem,1.6rem+2.6vw,3.5rem)] leading-[1.06] font-semibold tracking-tight">
          Talk to us
        </h1>
        <p className="mt-5 max-w-120 text-[1.0625rem] leading-relaxed text-muted-foreground sm:text-lg">
          Questions about DocuMind, a pilot for your team, or feedback on an answer. A person reads every message.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5 sm:p-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <ContactForm initialSent={sent} initialError={error} />
      </div>

      <dl className="flex flex-col">
        {TOPICS.map((topic) => (
          <div key={topic.title} className="border-t py-5">
            <dt className="text-[0.9375rem] font-semibold">{topic.title}</dt>
            <dd className="mt-1.5 max-w-120 text-[0.9375rem] leading-relaxed text-muted-foreground">{topic.body}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

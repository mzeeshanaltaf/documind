import { ArrowRightIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button-link";
import { AskExcerpt, IndexExcerpt, RoutingDemo, SearchDemo, UploadExcerpt } from "@/components/marketing/demos";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { CONTAINER } from "@/components/marketing/nav";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "DocuMind · Turn company documents into an intelligent assistant" },
  alternates: { canonical: "/" },
};

const SECTION_Y = "py-[clamp(4.5rem,3rem+5vw,8rem)]";
const H2 = "font-heading text-[clamp(1.85rem,1.35rem+2vw,2.85rem)] leading-[1.1] font-semibold tracking-[-0.02em]";
const LEAD = "text-[1.0625rem] leading-relaxed text-muted-foreground sm:text-lg";
const CTA = "h-11 px-5 text-[0.9375rem]";

/** A section opens like a numbered part of a policy manual: number, name, rule. */
function SectionMark({ n, label, className }: { n: string; label: string; className?: string }) {
  return (
    <p className={cn("flex items-center gap-3 text-sm text-muted-foreground", className)}>
      <span className="font-mono text-xs">{n}</span>
      <span>{label}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </p>
  );
}

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Problem />
      <HowItWorks />
      <Features />
      <Security />
      <Faq />
      <FinalCta />
    </>
  );
}

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="overflow-hidden">
      <div
        className={cn(
          CONTAINER,
          "grid items-center gap-14 pt-[clamp(3rem,2rem+4vw,6rem)] pb-[clamp(4rem,3rem+4vw,7rem)] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-16",
        )}
      >
        <div className="flex flex-col items-start">
          <p className="text-sm text-muted-foreground">For People Ops, HR, IT, Finance and Compliance teams</p>
          <h1
            id="hero-title"
            className="mt-5 font-heading text-[clamp(2.5rem,1.45rem+4.3vw,4.6rem)] leading-[1.03] font-semibold tracking-[-0.028em]"
          >
            Turn company documents into an intelligent assistant.
          </h1>
          <p className={cn(LEAD, "mt-6 max-w-136")}>
            Employees ask in plain language. DocuMind answers from your policies, with citations that open the
            exact page.
          </p>
          <div className="mt-9 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
            <ButtonLink href="/sign-up" size="lg" className={CTA}>
              Get started
              <ArrowRightIcon data-icon="inline-end" />
            </ButtonLink>
            <ButtonLink href="/contact" variant="outline" size="lg" className={CTA}>
              Talk to us
            </ButtonLink>
          </div>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}

const PROBLEMS = [
  {
    problem: "Policy PDFs nobody reads",
    today: "Hundreds of pages of HR, IT and Finance manuals, read once at onboarding and searched with Ctrl+F.",
    outcome: "An answer in a few sentences, taken from the manual itself, with the page it came from.",
  },
  {
    problem: "The same tickets, every week",
    today: "How many days carry over? Who approves this purchase? People Ops answers it again, from memory.",
    outcome: "Employees settle the routine questions themselves. Your team keeps the judgment calls.",
  },
  {
    problem: "Rules that change by country",
    today: "A Berlin employee and a Sydney employee ask the same question and need different answers.",
    outcome: "DocuMind works out which country is meant and answers from that country's manual.",
  },
];

function Problem() {
  return (
    <section aria-labelledby="problem-title" className={cn("border-t", SECTION_Y)}>
      <div className={CONTAINER}>
        <SectionMark n="01" label="The problem" />
        <h2 id="problem-title" className={cn(H2, "mt-8 max-w-3xl")}>
          The answer is already written down. Finding it is the hard part.
        </h2>

        <div className="mt-12 sm:mt-16">
          <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-10 border-b pb-3 text-xs font-medium tracking-wide text-muted-foreground md:grid">
            <span>Problem</span>
            <span>Today</span>
            <span>With DocuMind</span>
          </div>
          <ol>
            {PROBLEMS.map((row, i) => (
              <li
                key={row.problem}
                className="grid gap-3 border-b py-7 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-10 md:py-9"
              >
                <h3 className="flex items-baseline gap-3 font-heading text-xl font-semibold leading-snug">
                  <span className="font-mono text-xs font-normal text-muted-foreground">{`1.${i + 1}`}</span>
                  {row.problem}
                </h3>
                <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
                  <span className="mr-1.5 font-medium text-foreground md:hidden">Today:</span>
                  {row.today}
                </p>
                <p className="text-[0.9375rem] leading-relaxed">
                  <span className="mr-1.5 font-medium md:hidden">With DocuMind:</span>
                  {row.outcome}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: "Upload your policies",
    body: "Drop in the PDFs you already have. Each file is checked, stored privately and queued for indexing.",
    excerpt: <UploadExcerpt />,
  },
  {
    title: "DocuMind indexes them",
    body: "It reads each document's header, sections and page numbers, and tags it with its department, country and type.",
    excerpt: <IndexExcerpt />,
  },
  {
    title: "Ask, and get cited answers",
    body: "People ask in their own words. Every answer comes with numbered sources that open the PDF at the passage.",
    excerpt: <AskExcerpt />,
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className={cn("bg-sidebar", SECTION_Y)}>
      <div className={CONTAINER}>
        <SectionMark n="02" label="How it works" />
        <h2 id="how-title" className={cn(H2, "mt-8 max-w-3xl")}>
          From a folder of PDFs to cited answers, in three steps.
        </h2>

        <ol className="mt-12 grid gap-12 sm:mt-16 md:grid-cols-3 md:gap-8 lg:gap-12">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col">
              <div className="flex items-center gap-4 border-t border-foreground/80 pt-4">
                <span className="font-heading text-4xl leading-none font-semibold tabular-nums">{i + 1}</span>
                <h3 className="text-base font-semibold">{step.title}</h3>
              </div>
              <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground md:min-h-21">{step.body}</p>
              <div className="mt-6">{step.excerpt}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const MORE_FEATURES = [
  {
    title: "Citations that open the exact page",
    body: "Every answer lists its sources. Click one and the PDF opens at that page, with the passage highlighted.",
  },
  {
    title: "Many organizations, one platform",
    body: "Each organization has its own documents, members and settings. People only see the organizations they belong to.",
  },
  {
    title: "Usage and cost you can see",
    body: "Tokens, latency and cost per answer, by model, department and person. Pick a standard or flex service tier per organization to trade speed for cost.",
  },
  {
    title: "Google or email sign-in",
    body: "Sign in with Google, or with email and a password, confirmed by a one-time code.",
  },
];

function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className={SECTION_Y}>
      <div className={CONTAINER}>
        <SectionMark n="03" label="Features" />
        <h2 id="features-title" className={cn(H2, "mt-8 max-w-3xl")}>
          Built for questions people have to get right.
        </h2>

        <div className="mt-14 grid items-center gap-10 sm:mt-20 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-20">
          <div>
            <h3 className="font-heading text-2xl leading-snug font-semibold">Finds the code and the question behind it</h3>
            <p className="mt-4 max-w-136 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Keyword search (BM25) catches document codes, section numbers and defined terms. Semantic search
              catches the same question asked in other words. DocuMind runs both and merges the results, so{" "}
              <span className="font-mono text-[0.8125rem] text-foreground">SIM-PRC-001</span> and &ldquo;can I
              expense my internet?&rdquo; each land on the right page.
            </p>
          </div>
          <SearchDemo />
        </div>

        <div className="mt-20 grid items-center gap-10 sm:mt-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-20">
          <div className="lg:order-2">
            <h3 className="font-heading text-2xl leading-snug font-semibold">Department agents that know the country</h3>
            <p className="mt-4 max-w-136 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Each question goes to the right specialist: HR, IT, Finance, Procurement, Facilities, Compliance and
              more. When it mentions a country or a city, the answer comes from that country&apos;s manual first,
              and the base policy fills the gaps. If the country matters and isn&apos;t clear, DocuMind asks.
            </p>
          </div>
          <div className="lg:order-1">
            <RoutingDemo />
          </div>
        </div>

        <dl className="mt-20 grid gap-x-12 gap-y-10 sm:mt-28 sm:grid-cols-2">
          {MORE_FEATURES.map((feature) => (
            <div key={feature.title} className="border-t pt-5">
              <dt className="text-base font-semibold">{feature.title}</dt>
              <dd className="mt-2 max-w-120 text-[0.9375rem] leading-relaxed text-muted-foreground">{feature.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const SAFEGUARDS = [
  {
    title: "Private storage",
    body: "PDFs sit in private object storage with no public links. They reach a reader only through the app, after a sign-in and an access check.",
  },
  {
    title: "Role-based access",
    body: "Platform admins manage organizations, documents and members. Members can ask about, and open, only their own organization's documents.",
  },
  {
    title: "Used only to answer you",
    body: "Your documents and questions are used to run the service for your organization. No advertising, and your data is never sold.",
  },
  {
    title: "Self-hosted infrastructure",
    body: "The app, database and file storage run on our own server. Text goes to OpenAI only to index documents and write answers.",
  },
];

function Security() {
  return (
    <section id="security" aria-labelledby="security-title" className={cn("border-t", SECTION_Y)}>
      <div className={cn(CONTAINER, "grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:gap-20")}>
        <div>
          <SectionMark n="04" label="Security and privacy" />
          <h2 id="security-title" className={cn(H2, "mt-8")}>
            Your policies stay yours.
          </h2>
          <p className={cn(LEAD, "mt-6 max-w-120")}>
            Internal policies aren&apos;t public documents, so DocuMind doesn&apos;t treat them like one.
          </p>
          <Link
            href="/privacy"
            className="mt-6 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Read the privacy policy
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </Link>
        </div>

        <dl className="grid gap-x-10 sm:grid-cols-2">
          {SAFEGUARDS.map((item, i) => (
            <div key={item.title} className={cn("border-t py-6", i < 2 && "sm:border-t-foreground/80")}>
              <dt className="text-base font-semibold">{item.title}</dt>
              <dd className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Which file types can we upload?",
    a: "PDF, up to 50 MB per file. The PDF needs a text layer: scanned pages saved as images can't be read yet.",
  },
  {
    q: "How are answers grounded in our documents?",
    a: "For each question, DocuMind retrieves the most relevant passages from your organization's documents and writes the answer from those passages only. Each statement carries a numbered citation to the document, section and page it came from.",
  },
  {
    q: "What happens when the answer isn't in the documents?",
    a: "It says so plainly instead of guessing, and points to the team that owns the policy. When the answer depends on a country it can't infer, it asks which one you mean.",
  },
  {
    q: "Who can upload documents?",
    a: "Platform admins upload documents, edit their metadata and manage members. Everyone else in an organization can ask questions and open the cited pages.",
  },
  {
    q: "Can I ask about specific documents only?",
    a: "Yes. Pick one or more documents before you ask, and DocuMind answers from those documents alone.",
  },
  {
    q: "Where is our data stored?",
    a: (
      <>
        Documents, chat history and accounts are stored on our own server (a VPS hosted by Hostinger), in a
        database and private object storage. OpenAI processes document text when it&apos;s indexed, and your
        question with the retrieved passages when an answer is written. The <Link href="/privacy" className="text-primary underline underline-offset-3">privacy policy</Link>{" "}
        lists every service involved.
      </>
    ),
  },
];

function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={cn("border-t", SECTION_Y)}>
      <div className={cn(CONTAINER, "grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:gap-20")}>
        <div>
          <SectionMark n="05" label="FAQ" />
          <h2 id="faq-title" className={cn(H2, "mt-8")}>
            What people ask first.
          </h2>
          <p className={cn(LEAD, "mt-6 max-w-120")}>
            Something else?{" "}
            <Link href="/contact" className="text-primary underline underline-offset-4">
              Send us a message
            </Link>
            .
          </p>
        </div>

        <div className="border-t">
          {FAQS.map((item) => (
            <details key={item.q} className="faq-item group border-b">
              <summary className="flex cursor-pointer items-start justify-between gap-6 rounded-sm py-5 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                <span className="font-heading text-lg leading-snug font-semibold">{item.q}</span>
                <PlusIcon
                  aria-hidden
                  className="faq-chevron mt-1 size-4 shrink-0 text-muted-foreground transition-[rotate] duration-200 ease-out"
                />
              </summary>
              <div className="max-w-160 pb-6 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="bg-band text-band-foreground">
      <div className={cn(CONTAINER, "flex flex-col gap-10 py-[clamp(4.5rem,3rem+5vw,7.5rem)] lg:flex-row lg:items-end lg:justify-between")}>
        <div className="max-w-2xl">
          <h2 id="cta-title" className="font-heading text-[clamp(2rem,1.4rem+2.6vw,3.25rem)] leading-[1.08] font-semibold tracking-[-0.022em]">
            Settle the next policy question in one click.
          </h2>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-band-muted sm:text-lg">
            Invited by your team? Create your account and start asking. Setting DocuMind up for your company?
            Talk to us about your policies.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row lg:shrink-0">
          <ButtonLink
            href="/sign-up"
            size="lg"
            className={cn(CTA, "bg-band-foreground text-band hover:bg-band-foreground/90 focus-visible:ring-band-foreground/50")}
          >
            Get started
            <ArrowRightIcon data-icon="inline-end" />
          </ButtonLink>
          <ButtonLink
            href="/contact"
            variant="outline"
            size="lg"
            className={cn(
              CTA,
              "border-band-foreground/40 bg-transparent text-band-foreground hover:bg-band-foreground/10 hover:text-band-foreground focus-visible:ring-band-foreground/50 dark:border-band-foreground/40 dark:bg-transparent dark:hover:bg-band-foreground/10",
            )}
          >
            Talk to us
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

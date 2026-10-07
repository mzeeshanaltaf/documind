import type { Metadata } from "next";
import Link from "next/link";
import { CONTAINER } from "@/components/marketing/nav";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What DocuMind collects, why, who processes it, how long it's kept and your rights.",
  alternates: { canonical: "/privacy" },
};

/** Edit when the policy changes. */
const EFFECTIVE_DATE = "7 October 2026";

const SECTIONS = [
  { id: "who-we-are", title: "Who we are" },
  { id: "data-we-collect", title: "Data we collect" },
  { id: "how-we-use-it", title: "How we use it" },
  { id: "service-providers", title: "Service providers" },
  { id: "cookies", title: "Cookies and local storage" },
  { id: "retention", title: "How long we keep it" },
  { id: "security", title: "Security" },
  { id: "your-rights", title: "Your rights" },
  { id: "international-transfers", title: "International transfers" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact" },
];

function Contents({ className }: { className?: string }) {
  return (
    <nav aria-labelledby="contents-title" className={className}>
      <p id="contents-title" className="text-xs font-medium tracking-wide text-muted-foreground">
        Contents
      </p>
      <ol className="mt-3 flex flex-col gap-0.5 text-sm">
        {SECTIONS.map((section, i) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="-mx-2 flex gap-2.5 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="w-5 shrink-0 font-mono text-xs leading-5 tabular-nums">{i + 1}</span>
              {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function H2({ id }: { id: string }) {
  const index = SECTIONS.findIndex((section) => section.id === id);
  return (
    <h2 id={id}>
      <span className="mr-3 font-mono text-sm font-normal text-muted-foreground">{index + 1}</span>
      {SECTIONS[index].title}
    </h2>
  );
}

export default function PrivacyPage() {
  return (
    <div className={cn(CONTAINER, "py-[clamp(3.5rem,2.5rem+4vw,6.5rem)]")}>
      <header className="max-w-3xl">
        <h1 className="font-heading text-[clamp(2.25rem,1.6rem+2.6vw,3.5rem)] leading-[1.06] font-semibold tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Effective <time dateTime="2026-10-07">{EFFECTIVE_DATE}</time>
        </p>
        <p className="mt-6 max-w-[65ch] text-[1.0625rem] leading-relaxed text-muted-foreground">
          DocuMind answers questions from an organization&apos;s own policy documents. This policy explains what
          personal data that involves, what we do with it and the choices you have.
        </p>
      </header>

      <div className="mt-12 grid gap-10 border-t pt-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Contents />
        </aside>

        <article className="legal-prose max-w-[68ch]">
          <H2 id="who-we-are" />
          <p>
            DocuMind (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a document-answering service operated by the owner of this
            website. We decide how the personal data described here is processed, and we are responsible for it.
          </p>
          <p>
            Organizations use DocuMind to let their people ask questions about internal policies. Where an
            organization uploads documents that contain personal data, that organization is responsible for having
            the right to share them with us; we process them only to provide the service to it.
          </p>

          <H2 id="data-we-collect" />
          <h3>Account data</h3>
          <p>
            Your name and email address, and the date your account was created. If you sign in with Google, we also
            receive your basic Google profile (name, email address and profile picture link).
          </p>
          <h3>Authentication data</h3>
          <ul>
            <li>Session records: a session token, its expiry, and the IP address and browser (user agent) it was created from.</li>
            <li>Your password, stored only as a salted hash. We never store or see it in plain text.</li>
            <li>One-time codes for email verification and password resets, stored as hashes and valid for 10 minutes.</li>
            <li>If you use Google sign-in, the tokens Google returns to complete the sign-in.</li>
          </ul>
          <h3>Organization membership</h3>
          <p>
            The organizations you belong to, your role in each, and invitations sent to your email address, including
            who sent them.
          </p>
          <h3>Documents and derived data</h3>
          <p>
            PDFs uploaded by an organization&apos;s admin, and what we derive from them to answer questions: the
            extracted text split into passages, numerical representations of those passages (embeddings), and
            metadata such as the title, document code, department, country, document type, a short summary and the
            section outline.
          </p>
          <h3>Chat messages and feedback</h3>
          <p>
            Your questions, the answers, the sources each answer cited, conversation titles, and any feedback you give
            on an answer (thumbs up or down and an optional note).
          </p>
          <h3>Usage metrics</h3>
          <p>
            For each request to the language model: the operation, model, service tier, token counts, latency and
            cost, linked to the organization and the user who made the request.
          </p>
          <h3>Contact form submissions</h3>
          <p>
            Your name, email address, message and the time you sent it. Your IP address is used for rate limiting
            (see below) and isn&apos;t stored with the message.
          </p>
          <h3>Web analytics</h3>
          <p>
            Aggregated page-view statistics from Umami, a cookieless analytics tool we host ourselves. It doesn&apos;t
            set cookies, doesn&apos;t track you across sites and doesn&apos;t build a profile of you.
          </p>
          <h3>Technical logs</h3>
          <p>
            Our servers log requests (time, path, response status and a request ID) to keep the service running and
            to investigate errors.
          </p>

          <H2 id="how-we-use-it" />
          <ul>
            <li>
              <strong>To provide the service:</strong> creating and securing your account, managing organizations and
              members, storing and indexing documents, and showing you your conversations.
            </li>
            <li>
              <strong>To answer questions from your organization&apos;s documents:</strong> finding the relevant
              passages and writing an answer that cites them. Your organization&apos;s documents are used only for that
              organization.
            </li>
            <li>
              <strong>For security and abuse prevention:</strong> rate limiting chat messages, sign-in attempts and
              contact-form submissions, and investigating misuse.
            </li>
            <li>
              <strong>For support:</strong> replying to contact-form messages and helping with problems you report.
            </li>
            <li>
              <strong>To improve the service:</strong> measuring answer quality from feedback, and cost and latency
              from usage metrics.
            </li>
          </ul>
          <p>
            We rely on the following legal bases: performing our contract with you or your organization (providing
            the service), our legitimate interests (security, abuse prevention, support and improving the service),
            and your consent where we ask for it. We don&apos;t sell personal data, use it for advertising or use your
            documents to train AI models.
          </p>

          <H2 id="service-providers" />
          <p>These providers process personal data on our behalf, only as needed for the purposes above:</p>
          <ul>
            <li>
              <strong>OpenAI</strong> generates answers and embeddings. It receives document text when a document is
              indexed, and your question, the retrieved passages and recent messages of the conversation when an
              answer is written. Under OpenAI&apos;s API terms, this data isn&apos;t used to train its models by
              default; OpenAI may keep it for a limited time to monitor abuse.
            </li>
            <li>
              <strong>Resend</strong> delivers transactional email: verification codes, password-reset codes and
              organization invitations. It receives your email address and the email&apos;s content.
            </li>
            <li>
              <strong>Google</strong> provides sign-in with Google, if you choose it.
            </li>
            <li>
              <strong>Upstash</strong> stores short-lived rate-limit counters, keyed by your user ID (chat) or your
              IP address (contact form).
            </li>
            <li>
              <strong>n8n</strong>, a workflow tool we run on our own server, receives contact-form submissions and
              delivers them to us.
            </li>
            <li>
              <strong>Hostinger</strong> provides the virtual private server that runs the application, the database
              and the private file storage.
            </li>
            <li>
              <strong>Umami</strong>, self-hosted on our server, produces the aggregated web analytics described above.
            </li>
          </ul>

          <H2 id="cookies" />
          <p>
            We use only the cookies needed to keep you signed in (a session cookie, plus short-lived cookies during
            Google sign-in). Your light or dark theme choice is saved in your browser&apos;s local storage. We
            don&apos;t use advertising or tracking cookies.
          </p>

          <H2 id="retention" />
          <ul>
            <li>
              <strong>Account and membership data:</strong> for as long as your account exists. Sessions expire on
              their own and are deleted when you sign out or your account is removed.
            </li>
            <li>
              <strong>Documents:</strong> for as long as the organization keeps them. When an admin deletes a
              document, the file is removed from storage and its passages and embeddings are deleted.
            </li>
            <li>
              <strong>Organizations:</strong> until the organization is closed. When it is, we delete its
              documents and files, memberships, settings and conversations.
            </li>
            <li>
              <strong>Conversations:</strong> until you delete them, or until your account or the organization is
              deleted.
            </li>
            <li>
              <strong>Usage metrics:</strong> kept for cost accounting. They may remain after an account is deleted,
              linked only to an internal ID, without your name or email address.
            </li>
            <li>
              <strong>Contact messages:</strong> as long as needed to handle your request.
            </li>
            <li>
              <strong>Rate-limit counters:</strong> expire automatically within minutes.
            </li>
          </ul>
          <p>
            You can ask us to delete your account and the data linked to it at any time through the{" "}
            <Link href="/contact">contact form</Link>.
          </p>

          <H2 id="security" />
          <p>
            Connections to DocuMind are encrypted with TLS. Passwords and one-time codes are stored as hashes.
            Documents are kept in private storage with no public links and are served only through the application,
            after it checks that you&apos;re signed in and allowed to see them. Every request is checked against your
            role and organization membership, the application&apos;s internal API requires a secret key, and sign-in,
            chat and contact requests are rate-limited. No system is perfectly secure, but we work to protect your
            data and will tell affected users about a breach as the law requires.
          </p>

          <H2 id="your-rights" />
          <p>Depending on where you live, you may have the right to:</p>
          <ul>
            <li>access the personal data we hold about you and get a copy of it;</li>
            <li>correct data that is inaccurate or incomplete;</li>
            <li>have your data deleted;</li>
            <li>object to, or ask us to restrict, processing based on our legitimate interests;</li>
            <li>receive your data in a portable format;</li>
            <li>withdraw consent where processing is based on it.</li>
          </ul>
          <p>
            To exercise any of these rights, use the <Link href="/contact">contact form</Link>. We may need to confirm
            your identity first. If your request concerns documents uploaded by your organization, we may refer it
            to the organization&apos;s admin. You also have the right to complain to your local data protection
            authority.
          </p>

          <H2 id="international-transfers" />
          <p>
            Some of the providers above, including OpenAI, Resend, Google and Upstash, may process data in the United
            States or other countries outside your own. Where the law requires it, we rely on appropriate safeguards
            for these transfers, such as the European Commission&apos;s standard contractual clauses.
          </p>

          <H2 id="children" />
          <p>
            DocuMind is a workplace tool and isn&apos;t intended for children under 16. We don&apos;t knowingly
            collect their personal data; if you believe we have, contact us and we&apos;ll delete it.
          </p>

          <H2 id="changes" />
          <p>
            We&apos;ll update this policy when the service or the law changes, and change the effective date above.
            If a change materially affects how we use your data, we&apos;ll tell signed-up users by email or in the
            app before it takes effect.
          </p>

          <H2 id="contact" />
          <p>
            For questions about this policy or your data, write to us through the{" "}
            <Link href="/contact">contact form</Link>. We&apos;ll reply by email.
          </p>
        </article>
      </div>
    </div>
  );
}

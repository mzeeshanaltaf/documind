# Product

## Register

product

## Users
HR generalists, operations managers and compliance officers at mid-sized, multi-country companies. They are at a desk during the working day, usually between meetings, answering a concrete question for themselves or an employee: "How many days of parental leave does an employee in Germany get?", "What's the approval limit for a purchase order?". They need an answer they can defend, which means a source they can open and point to.

A second, smaller group is the platform admin: the person who sets up organizations, uploads the policy PDFs, and adds people. Their job is to keep the corpus clean and the right people in the right orgs.

## Product Purpose
DocuMind turns a company's policy documents into an assistant that answers in plain language and cites the exact document, section and page. Success is a user trusting the answer enough to act on it, because one click shows them the passage it came from. Precision and traceability matter more than personality.

## Brand Personality
Trustworthy, calm, precise. The voice is a well-briefed colleague from the policy team: direct, plainly worded, never chirpy, never hedging without reason. It says what the document says and shows where. Emotional goal: the relief of a settled question.

References that capture the right feel:
- **Linear / Vercel:** crisp precision, neutral surfaces, one sharp accent, dense when it needs to be.
- **Notion / Craft:** document-first calm, generous reading measure, an editorial feel for long text.
- **Stripe Dashboard:** enterprise trust, clear tables, polish that signals "this is handled".
- **Arc / Raycast:** small moments of warmth and craft inside a serious tool.

## Anti-references
- **Generic AI chatbot:** purple/violet gradients, sparkles everywhere, glowing orbs, a ChatGPT clone layout with no identity.
- **Legacy enterprise intranet:** SharePoint-style grey boxes, cramped forms, 2012 corporate blue.
- **SaaS landing cliché:** hero metrics, identical icon-card grids, gradient text, glassmorphism.
- **Dark hacker tool:** a dark-by-default, neon dev-tool aesthetic.

## Design Principles
1. **Show the source.** Every answer earns trust by pointing at the document. Citations are first-class UI, not footnotes.
2. **Calm over clever.** The interface recedes; the policy text and the answer lead. No decoration that doesn't carry meaning.
3. **Documents are the material.** The visual language borrows from well-set documents (serif headings, a clear reading measure, numbered sections), not from chat-app or AI-tool tropes.
4. **Earned familiarity.** Standard navigation, standard forms, standard tables. HR and compliance users should never have to learn a novel affordance.
5. **Precise at every state.** Loading, empty, error and permission states are written and designed as carefully as the happy path.

## Accessibility & Inclusion
- WCAG 2.2 AA: text contrast ≥ 4.5:1 (3:1 for large text and UI boundaries), visible focus on every interactive element, full keyboard access including citation chips.
- Respect `prefers-reduced-motion`: state transitions only, no movement when reduced.
- Never encode meaning in colour alone (status badges carry a label or icon).
- Light and dark themes both meet AA; the default follows the OS.

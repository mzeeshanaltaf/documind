---
name: DocuMind
description: Turn company documents into an intelligent assistant.
colors:
  paper: "oklch(0.988 0.003 160)"
  ink: "oklch(0.205 0.012 165)"
  ink-green: "oklch(0.43 0.075 168)"
  ink-green-text: "oklch(0.985 0.006 160)"
  shelf: "oklch(0.968 0.005 160)"
  shelf-selected: "oklch(0.928 0.014 165)"
  muted-surface: "oklch(0.958 0.005 160)"
  muted-ink: "oklch(0.515 0.012 165)"
  accent-wash: "oklch(0.948 0.016 165)"
  rule: "oklch(0.905 0.006 160)"
  field-edge: "oklch(0.875 0.008 160)"
  focus-ring: "oklch(0.55 0.09 168)"
  highlighter: "oklch(0.92 0.085 95)"
  highlighter-ink: "oklch(0.26 0.03 90)"
  destructive: "oklch(0.53 0.18 28)"
  success: "oklch(0.5 0.11 152)"
  warning: "oklch(0.555 0.12 68)"
  info: "oklch(0.52 0.09 240)"
  night-paper: "oklch(0.172 0.008 165)"
  night-ink: "oklch(0.94 0.006 160)"
  night-ink-green: "oklch(0.76 0.09 168)"
  night-highlighter: "oklch(0.42 0.07 92)"
typography:
  display:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "1.7rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  code:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.7rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "0.3rem"
  md: "0.4rem"
  lg: "0.5rem"
  xl: "0.7rem"
spacing:
  field-gap: "1.25rem"
  section-gap: "2.5rem"
  page-x: "2.5rem"
  page-y: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.ink-green}"
    textColor: "{colors.ink-green-text}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
  button-primary-large:
    backgroundColor: "{colors.ink-green}"
    textColor: "{colors.ink-green-text}"
    rounded: "{rounded.lg}"
    height: "2.25rem"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "2rem"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "2rem"
  sidebar-item-active:
    backgroundColor: "{colors.shelf-selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  citation-mark:
    backgroundColor: "{colors.highlighter}"
    textColor: "{colors.highlighter-ink}"
    rounded: "3px"
  badge-secondary:
    backgroundColor: "{colors.muted-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
---

# Design System: DocuMind

Tokens live in `web/src/app/globals.css` (`:root` and `.dark`, mapped into Tailwind v4 with `@theme inline`). That file is the implementation; this file is the rationale. The two must agree. Never add a colour or font outside `globals.css`.

## 1. Overview

**Creative North Star: "The Annotated Policy Binder"**

DocuMind is a well-kept policy binder that answers back. Its surfaces are paper, its type is ink, and its single act of colour is the one a careful reader makes: a highlighter stroke across the exact sentence that settles the question. The interface exists to get a user from a question to a passage they can point to, so it stays quiet and lets the document lead.

The register is product. Density is moderate: tables and forms are compact, like Linear's or Stripe's, while reading surfaces (answers, cited passages, empty states) get a document's generous measure, like Notion's. Serif headings and monospaced document codes borrow from typeset policy documents. Warmth comes from small craft moments in the Raycast spirit (the highlighter, the cited-line logo), never from decoration.

The system rejects, by name: the **generic AI chatbot** (purple/violet gradients, sparkles, glowing orbs, a ChatGPT clone layout), the **legacy enterprise intranet** (SharePoint grey boxes, cramped forms, 2012 corporate blue), the **SaaS landing cliché** (hero metrics, identical icon-card grids, gradient text, glassmorphism), and the **dark hacker tool** (dark-by-default neon).

**Key Characteristics:**
- Paper-and-ink neutrals tinted toward green-grey (hue ~160), never pure black or white.
- One accent, ink green, for primary actions, current selection and focus only.
- Highlighter yellow is reserved for cited passages (and the logo's cited line).
- Serif display for titles; one humanist sans for all UI; mono for document codes, section numbers and codes.
- Light by default (daylit office desks); dark follows the OS and passes AA.
- Flat, tonal layering; shadows only for floating layers.

## 2. Colors

A restrained palette: tinted paper neutrals, one ink-green accent and one reserved highlighter.

### Primary
- **Ink Green** (`oklch(0.43 0.075 168)`, dark mode `oklch(0.76 0.09 168)`): primary buttons, the active sidebar indicator, links, focus rings (a lighter `oklch(0.55 0.09 168)`), the logo tile and org monograms. 7.5:1 against paper. It reads as "verified, settled", and it deliberately isn't the category's default blue or purple.

### Secondary
- **Highlighter** (`oklch(0.92 0.085 95)` with ink `oklch(0.26 0.03 90)`, dark `oklch(0.42 0.07 92)`): the marked span inside a cited passage, text selection, and the logo's middle line. Nothing else.

### Neutral
- **Paper** (`oklch(0.988 0.003 160)`): the page background. Dark: **Night Paper** (`oklch(0.172 0.008 165)`).
- **Ink** (`oklch(0.205 0.012 165)`): body text and headings. 17:1 on paper.
- **Muted Ink** (`oklch(0.515 0.012 165)`): secondary text, descriptions, table meta. ≥ 4.96:1 on every neutral surface.
- **Shelf** (`oklch(0.968 0.005 160)`): the second neutral layer for the app sidebar, admin header and the auth companion panel. **Shelf Selected** (`oklch(0.928 0.014 165)`) marks the current nav item.
- **Muted Surface / Accent Wash** (`oklch(0.958 0.005 160)` / `oklch(0.948 0.016 165)`): wells, badges, hover and citation chips.
- **Rule** (`oklch(0.905 0.006 160)`) for borders and dividers; **Field Edge** (`oklch(0.875 0.008 160)`) for input outlines.

### State
- **Destructive** `oklch(0.53 0.18 28)`, **Success** `oklch(0.5 0.11 152)`, **Warning** `oklch(0.555 0.12 68)`, **Info** `oklch(0.52 0.09 240)`. All ≥ 4.5:1 as text on paper. Exposed as `text-destructive`, `text-success`, `text-warning`, `text-info`.

### Data visualization (Phase 6)
- **Categorical slots, fixed order:** `--chart-1` green `oklch(0.5 0.11 168)`, `--chart-2` amber `oklch(0.66 0.14 70)`, `--chart-3` blue `oklch(0.55 0.13 250)`; dark `oklch(0.62 0.11 168)` / `oklch(0.665 0.14 68)` / `oklch(0.6 0.13 250)`. Validated with the dataviz palette checks (lightness band, chroma ≥ 0.1, CVD ΔE ≥ 8, normal-vision floor, ≥ 3:1 on the surface) in both themes. Brand ink green (C 0.075) reads grey as a mark, so slot 1 is a stronger step of the same hue.
- **Marks:** bars ≤ 24px with a 4px rounded data end, 2px surface gaps between stacked segments, 2px lines, hairline grid, one y-axis per chart. Single-series charts have no legend; multi-series legends keep series order. Every chart has a table view.
- **PDF highlight** (`--pdf-highlight`, `oklch(0.9 0.13 95)` in both themes): rendered PDF pages are always white paper, so the cited span uses the light highlighter, multiplied over the glyphs.

### Email
Email clients can't read CSS variables, so `web/src/lib/email/layout.ts` carries sRGB equivalents of these tokens (paper `#f9fcfa`, ink `#121916`, muted `#616a66`, rule `#dce1de`, ink green `#1a5d48`, highlighter `#f6e5a4`). Regenerate them if a token changes.

### Named Rules
**The One Ink Rule.** Ink green covers at most 10% of any screen: primary action, current selection, focus. Inactive states are never green.

**The Highlighter Rule.** Highlighter yellow means "this exact text is the source". Using it for emphasis, warnings or decoration is prohibited.

## 3. Typography

**Display Font:** Source Serif 4 (with ui-serif, Georgia)
**Body Font:** Instrument Sans (with ui-sans-serif, system-ui)
**Label/Mono Font:** Geist Mono (with ui-monospace)

**Character:** A text serif with optical sizing gives titles the authority of a typeset manual; Instrument Sans is a calm, slightly humanist grotesk that disappears into the task. Mono is for things a person might type or cite: `SIM-HR-102`, `§5.2`, OTP codes, URL slugs.

### Hierarchy
- **Display** (600, 1.7rem, 1.2): auth page titles. `font-heading`.
- **Headline** (600, 1.5rem, 1.25): app page titles (`PageHeader`), empty-state titles at 1.25rem.
- **Title** (600, 0.875rem, sans): section labels inside a page ("People with access").
- **Body** (400, 0.875rem, 1.55): forms, tables, descriptions. Prose caps at 65ch.
- **Label** (500, 0.75rem): field hints, table meta, badges.
- **Code** (400, 0.7rem, mono): document codes, section numbers, page refs.

### Named Rules
**The Serif-for-Titles Rule.** Source Serif 4 appears on h1/h2 (applied globally in `globals.css`), the wordmark, empty-state titles and dialog titles. It never appears on buttons, labels, inputs or table data.

**The Fixed Scale Rule.** Product sizes are fixed rem steps (ratio ~1.2). No `clamp()` type in the app; fluid display type is for the Phase 7 marketing page only.

## 4. Elevation

Flat by default, with tonal layering. Depth comes from the paper → shelf → muted surface steps and 1px rules, not shadows. Shadows exist only for things that float above the page: popovers, menus, dialogs and toasts (shadcn defaults), plus a hairline `shadow-xs`/`shadow-sm` with a 1px ring on the illustrative cited-passage card.

### Named Rules
**The Flat-At-Rest Rule.** Surfaces in the document flow have no shadow. If a static card has a drop shadow, remove it and use a rule or a tonal step.

## 5. Components

Built on shadcn `base-nova` (Base UI primitives), lucide icons. Character: refined and restrained; standard affordances, precise states.

### Buttons
- **Shape:** gently rounded (0.5rem).
- **Primary:** ink green on paper-white text; `h-8` default, `size="lg"` (`h-9`) for full-width auth actions.
- **Outline / Ghost:** outline for secondary actions next to a primary (Google sign-in, "Create an account"); ghost for tertiary actions (Resend code, Cancel, row actions).
- **Loading:** a `Spinner` with `data-icon="inline-start"`, the button disabled, and the label switched to a present participle ("Signing in…").
- **Links that look like buttons** use `ButtonLink` (`web/src/components/button-link.tsx`), never `<Button render={<Link/>} nativeButton={false}>`, which gives the anchor `role="button"`.

### Inputs / Fields
- **Style:** 1px field-edge outline on paper, 0.5rem radius, `h-8`.
- **Focus:** the border shifts to the ring colour plus a 3px ring at 50%.
- **Error:** `data-invalid` on `Field`, `aria-invalid` on the control, the message in `FieldError` under the field; form-level errors go in a destructive `Alert` above the fields (`FormAlert`). Toasts are for confirmations, never for the only copy of an error.
- **IDs:** every client-form field id comes from `useId()`. Next keeps visited routes mounted (hidden), so static ids collide across pages.

### Navigation
- **App sidebar** (shadcn `Sidebar`, collapsible to icons): Shelf background; an org switcher (`Popover` + `Command`) on top; a "Chat" group; a "Manage" group (Documents, Members, Settings, Analytics) only for platform admins; and a user menu (theme radio, Platform admin link, Sign out) at the foot. Active item: Shelf Selected background plus `aria-current="page"`.
- **Standalone pages** (`/app` empty state, `/app/new-org`, `/admin/*`) use a slim top bar: logo, email, Sign out.

### Tables
Bordered `rounded-lg` container, no zebra stripes; secondary columns hide below `sm`/`md`; a person cell = avatar + name + muted email; dates in `en-GB` short form with tabular numerals; row actions are ghost icon buttons with aria-labels.

### Citation (signature component)
A source card: mono doc code + serif title + mono page ref, a rule, the section number in mono with a serif heading, then the passage in serif with the cited span wrapped in `<mark>` using the Highlighter. Inline answer references are small mono chips on Accent Wash. First used on the auth companion panel (`components/auth/source-panel.tsx`); the chat reuses it in `SourceCard` (`components/chat/citation-chip.tsx`): chip → hover card → sources list → PDF viewer with the passage marked.

### Logo
`components/brand/logo.tsx`: an ink-green tile holding a paper page whose middle line is highlighted (the cited passage), next to the serif "DocuMind" wordmark. `app/icon.svg` is the static favicon version.

## 6. Do's and Don'ts

### Do:
- **Do** define every colour in `globals.css` as OKLCH, with a `.dark` counterpart, and use semantic utilities (`bg-primary`, `text-muted-foreground`, `bg-highlight`).
- **Do** keep text contrast ≥ 4.5:1 in both themes (verified for every pair above), with visible focus on everything.
- **Do** show a skeleton (`Skeleton`, `PageSkeleton`) for streamed content and an `Empty` state that says what to do next.
- **Do** write errors that say what happened and what to do ("That code has expired. Send a new one below.").
- **Do** respect `prefers-reduced-motion` (handled globally); motion is 150–250ms ease-out and only conveys state.

### Don't:
- **Don't** look like a **generic AI chatbot**: no purple/violet gradients, sparkles, glowing orbs or ChatGPT-clone layouts.
- **Don't** look like a **legacy enterprise intranet**: no grey-box SharePoint panels, cramped forms or 2012 corporate blue.
- **Don't** use **SaaS landing clichés**: no hero metrics, identical icon-card grids, gradient text or glassmorphism.
- **Don't** ship a **dark hacker tool**: dark mode follows the OS and is never the default or neon.
- **Don't** use `border-left`/`border-right` > 1px as a coloured accent stripe.
- **Don't** use pure `#000` or `#fff`, or any colour that isn't a token.
- **Don't** use em dashes in UI copy.
- **Don't** nest cards, or wrap a section in a card just to group it.

/** Landing-page anchors, absolute so they also work from /contact and /privacy. */
export const SECTION_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#security", label: "Security" },
  { href: "/#faq", label: "FAQ" },
] as const;

/** Shared container: 16px gutters on phones, 72rem max. */
export const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

/**
 * DocuMind's public URL (the same key, and meaning, as in web/): accounts live there, so
 * "Forgot password" and "Open DocuMind" link to it. Inlined at build time.
 */
export const DOCUMIND_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");

export const SITE_NAME = "DocuMind Evaluation";

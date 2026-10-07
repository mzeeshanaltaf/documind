import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// A constant, not `new Date()`: the sitemap is prerendered, and the pages change only on deploys.
const LAST_MODIFIED = "2026-10-07";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/contact`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.6 },
    { url: `${SITE_URL}/privacy`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/sign-in`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/sign-up`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.5 },
  ];
}

import type { MetadataRoute } from "next";

/** Nothing here is for crawlers. Also the Coolify health check (`GET /robots.txt`). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

import Script from "next/script";
import { SignupTracker } from "@/components/analytics/signup-tracker";
import { UMAMI } from "@/lib/analytics";

/** Umami tracker, mounted once in the root layout. Renders nothing outside production builds. */
export function Umami() {
  if (!UMAMI) return null;
  return (
    <>
      <Script
        src={UMAMI.scriptUrl}
        data-website-id={UMAMI.websiteId}
        data-domains={UMAMI.domains}
        strategy="afterInteractive"
      />
      <SignupTracker />
    </>
  );
}

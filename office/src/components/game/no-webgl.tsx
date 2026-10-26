import { LogoMark } from "@/components/brand/logo";
import { ButtonLink } from "@/components/button-link";
import { deriveLocations } from "@/lib/locations";
import { DOCUMIND_URL } from "@/lib/site";
import type { OfficeContext } from "@/game/store/game-store";

/**
 * Shown instead of the game when the browser can't create a WebGL context (phase O10 ›
 * Accessibility). The office itself needs 3D, but the way to the answers doesn't: DocuMind
 * has the same documents and the same experts as plain chat.
 */
export function NoWebgl({ office }: { office?: OfficeContext }) {
  const locations = office ? deriveLocations(office.org, office.documents) : [];
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center gap-6 px-4 py-16">
      <LogoMark className="size-10" />
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl leading-tight font-semibold">The office needs 3D graphics</h1>
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
          This browser can&apos;t start WebGL, so the office can&apos;t open. Turning on hardware acceleration in the
          browser settings, or trying another browser, usually fixes it. Meanwhile, every answer is one click away in
          DocuMind.
        </p>
      </div>
      <div>
        <ButtonLink href={office ? `${DOCUMIND_URL}/app/${office.org.slug}` : DOCUMIND_URL}>Open DocuMind</ButtonLink>
      </div>
      {office && locations.length > 0 && (
        <section aria-labelledby="no-webgl-locations" className="flex flex-col gap-2">
          <h2 id="no-webgl-locations" className="text-sm font-medium">
            {office.org.name} offices
          </h2>
          <ul className="flex flex-col divide-y rounded-xl border">
            {locations.map((location) => (
              <li key={location.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                <span className="font-medium">{location.name}</span>
                <span className="text-sm text-muted-foreground">{location.roleLabel}</span>
                {location.docCodes.length > 0 && (
                  <span className="font-mono text-xs text-muted-foreground">{location.docCodes.join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

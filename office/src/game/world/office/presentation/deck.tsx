import { ArrowUpRightIcon, DoorOpenIcon, MapPinIcon } from "lucide-react";
import type { ReactNode } from "react";
import { DOCUMIND_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import { pinPosition, type ProgrammeSlide, type Slide, type SlideItem } from "./slides";

/**
 * One slide as DOM (phase O7 › Slide engine), in DocuMind's binder language: a mono part mark and
 * slide number over a hairline rule, a serif title, sans body, ruled rows instead of cards, and the
 * source page as a footnote. Two variants share the markup:
 * - `screen`: a fixed 960×540 frame for the auditorium screen (drei `Html transform`);
 * - `page`: reflowing rem type for the "View full screen" dialog (readable at 360 px).
 */
export type SlideVariant = "screen" | "page";

/** Where the player is, for the map's "You are here". */
export type SlidePlace = { id: string; name: string; hub: boolean };

type Props = {
  entry: ProgrammeSlide;
  variant: SlideVariant;
  place: SlidePlace | null;
  className?: string;
  /** Renders the title (the dialog passes its own title element, so the slide names the dialog). */
  renderTitle?: (props: { className: string; children: string }) => ReactNode;
};

const S = {
  screen: {
    frame: "h-[540px] w-[960px] gap-6 px-14 pt-10 pb-8",
    mark: "text-[15px]",
    title: "text-[44px] leading-[1.1]",
    hero: "text-[64px] leading-[1.05]",
    body: "text-[21px] leading-[1.5]",
    small: "text-[15px] leading-[1.45]",
    item: "text-[19px] leading-[1.45]",
    dense: "text-[16px] leading-[1.4]",
    value: "text-[30px] leading-[1.15]",
    quote: "text-[34px] leading-[1.3]",
  },
  page: {
    frame: "gap-5",
    mark: "text-xs",
    title: "text-2xl leading-tight sm:text-3xl",
    hero: "text-3xl leading-tight sm:text-4xl",
    body: "text-base leading-relaxed",
    small: "text-sm leading-normal",
    item: "text-[0.9375rem] leading-relaxed",
    dense: "text-sm leading-normal",
    value: "text-xl leading-snug",
    quote: "text-xl leading-snug sm:text-2xl",
  },
} as const;

type Sizes = (typeof S)[SlideVariant];

const two = (n: number) => String(n).padStart(2, "0");

export function SlideView({ entry, variant, place, className, renderTitle }: Props) {
  const { deck, slide, index, total } = entry;
  const s = S[variant];
  const screen = variant === "screen";
  const Tag = screen ? "p" : "h2";
  const title = (classes: string) =>
    renderTitle ? renderTitle({ className: classes, children: slide.title }) : <Tag className={classes}>{slide.title}</Tag>;

  return (
    <article
      className={cn(
        "flex flex-col text-foreground",
        screen && "overflow-hidden bg-background font-sans antialiased",
        s.frame,
        className,
      )}
    >
      <header className={cn("flex items-baseline justify-between gap-4 border-b border-border pb-2 font-mono text-muted-foreground", s.mark)}>
        <span className="truncate">
          Part {deck.id === "documind" ? 1 : 2} · {deck.title}
        </span>
        <span className="shrink-0 tabular-nums">
          {two(index + 1)} / {two(total)}
        </span>
      </header>

      <div className={cn("flex min-h-0 flex-1 flex-col", screen ? "gap-6" : "gap-4")}>
        {slide.kind === "title" ? (
          <div className={cn("flex flex-col justify-center", screen ? "flex-1 gap-6" : "gap-3")}>
            {title(cn("max-w-[18ch] font-heading font-semibold tracking-[-0.015em] text-balance", s.hero))}
            {slide.body && <p className={cn("max-w-[52ch] text-muted-foreground text-pretty", s.body)}>{slide.body}</p>}
            {slide.linkToDocuMind &&
              (screen ? (
                <p className={cn("font-mono text-primary", s.small)}>{DOCUMIND_URL.replace(/^https?:\/\//, "")}</p>
              ) : (
                <a
                  href={DOCUMIND_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  Open DocuMind
                  <ArrowUpRightIcon className="size-4" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ))}
          </div>
        ) : (
          <>
            {title(cn("font-heading font-semibold tracking-[-0.01em] text-balance", s.title))}
            <SlideContent slide={slide} variant={variant} s={s} place={place} />
          </>
        )}
      </div>

      {slide.source && (
        <footer className={cn("font-mono text-muted-foreground", screen ? "text-[13px]" : "text-xs")}>Source: {slide.source}</footer>
      )}
    </article>
  );
}

function SlideContent({ slide, variant, s, place }: { slide: Slide; variant: SlideVariant; s: Sizes; place: SlidePlace | null }) {
  const screen = variant === "screen";
  const lead = slide.body ? <p className={cn("max-w-[62ch] text-muted-foreground text-pretty", s.body)}>{slide.body}</p> : null;

  switch (slide.kind) {
    case "bullets":
      return (
        <>
          {lead}
          {slide.numbered ? <Steps items={slide.items ?? []} variant={variant} s={s} /> : <Rows items={slide.items ?? []} variant={variant} s={s} />}
        </>
      );
    case "stat-grid":
      return (
        <>
          <dl className={cn("grid border-t border-border", screen ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
            {(slide.stats ?? []).map((stat) => (
              <div key={stat.label} className={cn("flex flex-col gap-0.5 border-b border-border", screen ? "px-0 py-3 pr-6" : "py-2.5 sm:pr-4")}>
                <dt className={cn("text-muted-foreground", s.small)}>{stat.label}</dt>
                <dd className={cn("font-heading font-semibold", s.value)}>{stat.value}</dd>
                {stat.note && <dd className={cn("text-muted-foreground", s.small)}>{stat.note}</dd>}
              </div>
            ))}
          </dl>
          {lead}
        </>
      );
    case "quote":
      return (
        <>
          {slide.quote && (
            <figure className="flex flex-col gap-2">
              <blockquote className={cn("max-w-[44ch] font-heading font-medium text-pretty", s.quote)}>“{slide.quote.text}”</blockquote>
              <figcaption className={cn("font-mono text-muted-foreground", s.small)}>{slide.quote.source}</figcaption>
            </figure>
          )}
          {lead}
          {slide.items && slide.items.length > 0 && (
            <ul className={cn("grid border-t border-border", screen ? "grid-cols-3 gap-x-6" : "grid-cols-1 sm:grid-cols-2 sm:gap-x-4")}>
              {slide.items.map((item) => (
                <li key={item.term ?? item.text} className={cn("flex flex-col border-b border-border py-2", s.dense)}>
                  <span className="font-semibold">{item.term}</span>
                  <span className="text-muted-foreground">{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    case "map":
      return <MapContent slide={slide} variant={variant} s={s} place={place} />;
    case "video":
      return (
        <>
          {screen ? (
            // The screen shows the video itself as a texture; this frame is only its stand-in.
            // eslint-disable-next-line @next/next/no-img-element -- a fixed-size frame inside WebGL's DOM layer.
            <img src={slide.video?.poster} alt="" className="min-h-0 flex-1 rounded-lg object-cover ring-1 ring-border" />
          ) : (
            slide.video && (
              <video
                controls
                playsInline
                preload="metadata"
                poster={slide.video.poster}
                className="aspect-video w-full rounded-lg bg-muted ring-1 ring-border"
                aria-describedby="slide-video-note"
              >
                <source src={slide.video.src} type="video/mp4" />
                <track kind="captions" src={slide.video.captions} srcLang="en" label="On-screen text (English)" default />
              </video>
            )
          )}
          {lead}
          {!screen && slide.video && !slide.video.hasAudio && (
            <p id="slide-video-note" className="text-sm text-muted-foreground">
              The video has no sound; its captions describe the text on screen.
            </p>
          )}
        </>
      );
    default:
      return lead;
  }
}

function Steps({ items, variant, s }: { items: SlideItem[]; variant: SlideVariant; s: Sizes }) {
  const screen = variant === "screen";
  return (
    <ol className={cn("grid", screen ? "grid-cols-4 gap-6" : "grid-cols-1 gap-3 sm:grid-cols-2")}>
      {items.map((item, index) => (
        <li key={item.term ?? item.text} className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className={cn("font-mono text-primary", s.small)}>{two(index + 1)}</span>
          {item.term && <span className={cn("font-heading font-semibold", s.value)}>{item.term}</span>}
          <span className={cn("text-muted-foreground", s.item)}>{item.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Rows({ items, variant, s }: { items: SlideItem[]; variant: SlideVariant; s: Sizes }) {
  const screen = variant === "screen";
  // Long lists (a timeline, the leadership) take two columns and a smaller size on the screen.
  const dense = items.length > 6;
  const withTerms = items.some((item) => item.term);
  // Years and other short terms get a narrow column on the screen; the page stacks every term
  // over its text, so nothing wraps into a thin column at small widths.
  const shortTerms = items.every((item) => (item.term ?? "").length <= 5);
  const termWidth = screen ? (shortTerms ? "w-14" : dense ? "w-42" : "w-38") : "w-full";
  return (
    <ul className={cn("grid border-t border-border", screen && dense ? "grid-cols-2 gap-x-8" : "grid-cols-1", !screen && dense && "sm:grid-cols-2 sm:gap-x-6")}>
      {items.map((item) => (
        <li
          key={`${item.term ?? ""}:${item.text}`}
          className={cn(
            "flex gap-x-4 border-b border-border",
            dense ? s.dense : s.item,
            screen ? (dense ? "py-1.5" : "py-2.5") : "flex-wrap gap-y-0.5 py-2",
          )}
        >
          {withTerms && <span className={cn("shrink-0 font-semibold", termWidth)}>{item.term}</span>}
          {!withTerms && <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-primary" />}
          <span className="min-w-0 flex-1 text-pretty">
            {item.text}
            {item.code && <span className="ml-2 font-mono text-[0.8em] whitespace-nowrap text-muted-foreground">{item.code}</span>}
          </span>
          {item.room && <RoomTag room={item.room} small={screen ? s.small : "text-xs"} />}
        </li>
      ))}
    </ul>
  );
}

/** "HR room": which room down the corridor covers it. */
function RoomTag({ room, small }: { room: string; small: string }) {
  return (
    <span className={cn("inline-flex h-fit shrink-0 items-center gap-1 self-center rounded-md bg-accent px-1.5 py-0.5 whitespace-nowrap text-accent-foreground", small)}>
      <DoorOpenIcon className="size-[1em]" aria-hidden />
      {room} room
    </span>
  );
}

/** The map crops the poles: latitudes 75° N to 45° S. */
const MAP_TOP = 75;
const MAP_BOTTOM = -45;

function MapContent({ slide, variant, s, place }: { slide: Slide; variant: SlideVariant; s: Sizes; place: SlidePlace | null }) {
  const screen = variant === "screen";
  const pins = slide.pins ?? [];
  const here = place ? pins.find((pin) => pin.id === place.id) : undefined;
  const span = MAP_TOP - MAP_BOTTOM;
  const full = 180 / span;

  return (
    <div className={cn("flex min-h-0 flex-1", screen ? "gap-8" : "flex-col gap-4")}>
      <div className={cn("flex flex-col gap-3", screen ? "w-130 shrink-0" : "w-full")}>
        <p className={cn("inline-flex w-fit items-center gap-1.5 rounded-md bg-accent px-2 py-0.5 font-medium text-accent-foreground", s.small)}>
          <MapPinIcon className="size-[1em]" aria-hidden />
          {here ? `You are here: ${here.name}` : place?.hub ? `You are in the ${place.name}` : "Our offices"}
        </p>
        <div className="relative w-full overflow-hidden rounded-lg bg-muted ring-1 ring-border" style={{ aspectRatio: `${360 / span}` }} aria-hidden>
          <div className="absolute inset-x-0" style={{ top: `${(-(90 - MAP_TOP) / span) * 100}%`, height: `${full * 100}%` }}>
            <div
              className="absolute inset-0 bg-muted-foreground/30"
              style={{ maskImage: "url(/assets/textures/earth-mask.png)", maskMode: "luminance", maskSize: "100% 100%", WebkitMaskImage: "url(/assets/textures/earth-mask.png)", WebkitMaskSize: "100% 100%" }}
            />
            {pins.map((pin) => {
              const { x, y } = pinPosition(pin);
              const current = pin.id === here?.id;
              return (
                <span
                  key={pin.id}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
                    current ? "size-3.5 bg-primary" : pin.hq ? "size-3 bg-foreground" : "size-2.5 bg-foreground/70",
                  )}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                />
              );
            })}
          </div>
        </div>
        {slide.body && <p className={cn("text-muted-foreground text-pretty", s.small)}>{slide.body}</p>}
      </div>
      <ul className={cn("flex min-w-0 flex-1 flex-col border-t border-border", screen ? "justify-start" : "")}>
        {pins.map((pin) => {
          const current = pin.id === here?.id;
          return (
            <li key={pin.id} className={cn("flex flex-col border-b border-border", screen ? "py-1.5" : "py-2", s.dense)}>
              <span className="flex items-center gap-2 font-semibold">
                {pin.name}
                {current && <Marker screen={screen}>You are here</Marker>}
              </span>
              <span className="text-muted-foreground">{pin.role}</span>
              {!screen && <span className="text-muted-foreground">{pin.focus}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Marker({ screen, children }: { screen: boolean; children: ReactNode }) {
  return (
    <span className={cn("rounded-sm bg-primary px-1 font-medium text-primary-foreground", screen ? "text-[13px]" : "text-xs")}>{children}</span>
  );
}

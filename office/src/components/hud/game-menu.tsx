"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  KeyboardIcon,
  LogOutIcon,
  MapPinIcon,
  SettingsIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { audio } from "@/game/audio/audio";
import { flushSettings } from "@/game/persist";
import type { QualitySetting } from "@/game/settings";
import { useGame } from "@/game/store/game-store";
import { authClient } from "@/lib/auth-client";
import { DOCUMIND_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

type View = "main" | "settings" | "controls";

const TIER_LABELS = { low: "Low", medium: "Medium", high: "High" } as const;

/** The Esc menu: resume, settings, controls help, change location, DocuMind, sign out. */
export function GameMenu() {
  const open = useGame((s) => s.modal?.type === "menu");
  const [view, setView] = useState<View>("main");

  function close() {
    useGame.getState().closeModal();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        audio.play(next ? "ui-open" : "ui-close", { volume: 0.5 });
      }}
      onOpenChangeComplete={(next) => !next && setView("main")}
    >
      <DialogContent className="gap-5 sm:max-w-md">
        {view === "main" && <MainView onResume={close} onNavigate={setView} />}
        {view === "settings" && <SettingsView onBack={() => setView("main")} onControls={() => setView("controls")} />}
        {view === "controls" && <ControlsView onBack={() => setView("settings")} />}
      </DialogContent>
    </Dialog>
  );
}

const rowClass = cn(buttonVariants({ variant: "ghost" }), "h-10 w-full justify-start gap-3 px-3 text-[0.9375rem] font-normal");

function MainView({ onResume, onNavigate }: { onResume: () => void; onNavigate: (view: View) => void }) {
  const router = useRouter();
  const location = useGame((s) => s.world.location);
  const orgSlug = useGame((s) => s.office?.org.slug);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await flushSettings();
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl font-semibold">Menu</DialogTitle>
        <DialogDescription>{[location.org, location.city, location.room].filter(Boolean).join(" · ")}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1">
        <Button size="lg" className="mb-2 w-full" autoFocus onClick={onResume}>
          Resume
        </Button>
        <button type="button" className={rowClass} onClick={() => onNavigate("settings")}>
          <SettingsIcon className="text-muted-foreground" />
          Settings
          <ChevronRightIcon className="ml-auto text-muted-foreground" />
        </button>
        <ButtonLink href={orgSlug ? `/${orgSlug}` : "/"} variant="ghost" className={rowClass}>
          <MapPinIcon className="text-muted-foreground" />
          Change location
        </ButtonLink>
        <a href={DOCUMIND_URL} target="_blank" rel="noreferrer" className={rowClass}>
          <ExternalLinkIcon className="text-muted-foreground" />
          Open DocuMind
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <Separator className="my-1.5" />
        <button type="button" className={rowClass} onClick={signOut} disabled={signingOut}>
          <LogOutIcon className="text-muted-foreground" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </>
  );
}

function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <DialogHeader className="flex-row items-center gap-2">
      <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back" className="-ml-1.5">
        <ChevronLeftIcon />
      </Button>
      <DialogTitle className="text-xl font-semibold">{title}</DialogTitle>
      <DialogDescription className="sr-only">{title} for the office</DialogDescription>
    </DialogHeader>
  );
}

function SettingsView({ onBack, onControls }: { onBack: () => void; onControls: () => void }) {
  const settings = useGame((s) => s.settings);
  const autoTier = useGame((s) => s.quality.auto);
  const update = useGame((s) => s.updateSettings);
  const soundId = useId();
  const musicId = useId();
  const tagsId = useId();

  const motion = settings.reduced_motion === null ? "system" : settings.reduced_motion ? "reduced" : "full";

  return (
    <>
      <SubHeader title="Settings" onBack={onBack} />
      <div className="flex flex-col gap-6">
        <FieldSet className="gap-2.5">
          <FieldLegend variant="label">Quality</FieldLegend>
          <ToggleGroup
            variant="outline"
            spacing={0}
            className="w-full"
            value={[settings.quality]}
            onValueChange={([value]) => value && update({ quality: value as QualitySetting })}
          >
            {(["auto", "low", "medium", "high"] as const).map((tier) => (
              <ToggleGroupItem key={tier} value={tier} className="flex-1 capitalize">
                {tier}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>
            {settings.quality === "auto"
              ? `Adjusts to your frame rate; ${TIER_LABELS[autoTier]} right now.`
              : "Low turns off shadows and name tags. High adds soft glow."}
          </FieldDescription>
        </FieldSet>

        <Field className="gap-2.5">
          <div className="flex items-baseline justify-between">
            <FieldLabel id={soundId}>Sound effects</FieldLabel>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{Math.round(settings.sound_volume * 100)}%</span>
          </div>
          <Slider
            aria-labelledby={soundId}
            min={0}
            max={100}
            value={Math.round(settings.sound_volume * 100)}
            onValueChange={(value) => update({ sound_volume: (value as number) / 100 })}
            onValueCommitted={() => audio.play("ui-click")}
          />
        </Field>

        <Field className="gap-2.5">
          <div className="flex items-baseline justify-between">
            <FieldLabel id={musicId}>Music</FieldLabel>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{Math.round(settings.music_volume * 100)}%</span>
          </div>
          <Slider
            aria-labelledby={musicId}
            min={0}
            max={100}
            value={Math.round(settings.music_volume * 100)}
            onValueChange={(value) => update({ music_volume: (value as number) / 100 })}
          />
        </Field>

        <FieldSet className="gap-2.5">
          <FieldLegend variant="label">Motion</FieldLegend>
          <ToggleGroup
            variant="outline"
            spacing={0}
            className="w-full"
            value={[motion]}
            onValueChange={([value]) =>
              value && update({ reduced_motion: value === "system" ? null : value === "reduced" })
            }
          >
            <ToggleGroupItem value="system" className="flex-1">
              Match system
            </ToggleGroupItem>
            <ToggleGroupItem value="reduced" className="flex-1">
              Reduced
            </ToggleGroupItem>
            <ToggleGroupItem value="full" className="flex-1">
              Full
            </ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>Reduced turns off camera bob, shake and spinning previews.</FieldDescription>
        </FieldSet>

        <Field orientation="horizontal" className="items-start justify-between gap-4">
          <FieldContent>
            <FieldLabel htmlFor={tagsId}>Show name tags</FieldLabel>
            <FieldDescription>Names over people&apos;s heads. Always hidden on Low.</FieldDescription>
          </FieldContent>
          <Switch
            id={tagsId}
            checked={settings.show_name_tags}
            onCheckedChange={(checked) => update({ show_name_tags: checked })}
          />
        </Field>

        <button type="button" className={cn(rowClass, "-mt-2")} onClick={onControls}>
          <KeyboardIcon className="text-muted-foreground" />
          Controls
          <ChevronRightIcon className="ml-auto text-muted-foreground" />
        </button>
      </div>
    </>
  );
}

const CONTROL_ROWS: { keys: string[]; action: string }[] = [
  { keys: ["W", "A", "S", "D"], action: "Move (or the arrow keys)" },
  { keys: ["Shift"], action: "Run while held" },
  { keys: ["E"], action: "Talk, sit, read or open" },
  { keys: ["J"], action: "Journal" },
  { keys: ["M"], action: "Map" },
  { keys: ["Esc"], action: "Menu, or close a dialog" },
];

function ControlsView({ onBack }: { onBack: () => void }) {
  return (
    <>
      <SubHeader title="Controls" onBack={onBack} />
      <div className="flex flex-col gap-5">
        <dl className="flex flex-col divide-y rounded-lg border">
          {CONTROL_ROWS.map((row) => (
            <div key={row.action} className="flex items-center justify-between gap-4 px-3 py-2.5">
              <dt className="text-sm">{row.action}</dt>
              <dd className="flex shrink-0 gap-1">
                {row.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Camera:</span> right-drag to look around; scroll to zoom.
          </p>
          <p>
            <span className="font-medium text-foreground">Touch:</span> drag the stick to walk (push it all the way to
            run), drag the view to look around, and tap the hand to use.
          </p>
        </div>
      </div>
    </>
  );
}

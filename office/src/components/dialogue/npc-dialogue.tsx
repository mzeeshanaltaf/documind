"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowLeftIcon, CameraIcon, ChevronRightIcon, IdCardIcon, LibraryIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { audio } from "@/game/audio/audio";
import { npcProfile, type NpcProfile } from "@/game/npc/profiles";
import { type NpcView, type OfficeContext, useGame } from "@/game/store/game-store";
import { useOfficeDepartments } from "@/game/world/office/use-floorplan";
import { CardPicker } from "./card-picker";
import { NpcChat } from "./npc-chat";

/**
 * The dialogue with a DocuMind-backed NPC (phase O5 › Dialogue panel), docked along the bottom so
 * the speaker stays in view (the camera frames both). A real dialog: focus is trapped, Esc
 * closes it, and the game ignores keys while it's open. Reception opens on its menu; the chat
 * and the card picker are views inside the same panel.
 */
export function NpcDialogue() {
  const modal = useGame((s) => (s.modal?.type === "npc" ? s.modal : null));
  const office = useGame((s) => s.office);
  const npc = modal?.npc ?? null;
  const profile = useMemo(() => (npc ? npcProfile(npc, office) : null), [npc, office]);
  const open = modal !== null && profile !== null && office !== null;

  function close() {
    audio.play("ui-close", { volume: 0.4 });
    useGame.getState().closeModal();
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && close()} modal="trap-focus">
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          data-npc-dialogue=""
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-h-[min(72dvh,40rem)] max-w-2xl flex-col gap-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0"
        >
          {open && modal && profile && office && <Panel npc={modal.npc} view={modal.view} profile={profile} office={office} onClose={close} />}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type PanelProps = { npc: string; view: NpcView; profile: NpcProfile; office: OfficeContext; onClose: () => void };

function Panel({ npc, view, profile, office, onClose }: PanelProps) {
  const setView = (next: NpcView) => useGame.getState().setNpcView(next);
  const back = profile.menu && view !== "menu";

  return (
    <>
      <header className="flex items-start gap-2">
        {back && (
          <Button variant="ghost" size="icon-sm" className="-ml-1.5" aria-label="Back to the menu" onClick={() => setView("menu")}>
            <ArrowLeftIcon />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DialogPrimitive.Title className="font-heading text-lg leading-tight font-semibold">{profile.persona.name}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              {profile.persona.role} · {office.place.name}
            </span>
            {view === "chat" && <ScopeButton profile={profile} />}
          </DialogPrimitive.Description>
        </div>
        <Button variant="ghost" size="icon-sm" className="-mr-1.5" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </header>

      {view === "menu" && <ReceptionMenu profile={profile} onPick={setView} />}
      {view === "chat" && <NpcChat npc={npc} profile={profile} office={office} />}
      {view === "cards" && <CardPicker onDone={() => setView("menu")} />}
    </>
  );
}

/** "Answers from 10 Lahore documents": the full list in a popover. */
function ScopeButton({ profile }: { profile: NpcProfile }) {
  const { scope } = profile;
  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1 rounded-sm underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <LibraryIcon className="size-3" aria-hidden />
        {scope.label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2 p-3">
        <p className="text-xs text-muted-foreground">
          {scope.documentIds === null
            ? "DocuMind picks the right departments and countries for each question."
            : scope.fallback
              ? "No local documents for this office, so every document is in reach."
              : "Only these documents are searched for answers here."}
        </p>
        <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {scope.documents.map((doc) => (
            <li key={doc.id} className="flex items-baseline gap-2 text-sm">
              <span className="w-24 shrink-0 font-mono text-[0.7rem] text-muted-foreground">{doc.doc_code ?? "n/a"}</span>
              <span className="min-w-0 flex-1 leading-snug">{doc.title}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ReceptionMenu({ profile, onPick }: { profile: NpcProfile; onPick: (view: NpcView) => void }) {
  const departments = useOfficeDepartments();
  const held = useGame((s) => s.player.cards.filter((card) => departments.includes(card)).length);
  const options = [
    {
      view: "chat" as const,
      icon: MessageCircleQuestionIcon,
      label: "Ask a question",
      detail: profile.scope.label,
      action: () => onPick("chat"),
    },
    {
      view: "cards" as const,
      icon: IdCardIcon,
      label: "Get access cards",
      detail: departments.length === 0 ? "No department rooms here" : `${held} of ${departments.length} held`,
      action: () => onPick("cards"),
    },
    {
      view: null,
      icon: CameraIcon,
      label: "Change my look",
      detail: "The badge photo booth",
      action: () => useGame.getState().openModal({ type: "avatar" }),
    },
  ];

  return (
    <>
      <p className="max-w-[65ch] text-[0.9375rem] leading-relaxed">{profile.greeting}</p>
      <ul className="flex flex-col gap-1" aria-label="What would you like to do?">
        {options.map((option, index) => (
          <li key={option.label}>
            <button
              type="button"
              autoFocus={index === 0}
              onClick={() => {
                audio.play("ui-click", { volume: 0.4 });
                option.action();
              }}
              className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <option.icon className="size-4" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="truncate text-xs text-muted-foreground">{option.detail}</span>
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

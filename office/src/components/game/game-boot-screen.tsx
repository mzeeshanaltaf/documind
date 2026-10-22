import { LogoMark } from "@/components/brand/logo";

/**
 * What shows before the game's JS arrives (server-rendered, and while the chunk downloads). It
 * matches the loading curtain, so the hand-over to the game is seamless.
 */
export function GameBootScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div role="status" className="flex flex-col items-center gap-5">
        <LogoMark className="size-10" />
        <p className="text-sm font-medium">Opening the office</p>
      </div>
    </div>
  );
}

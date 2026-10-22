/**
 * The signed-in pages: the org picker (`/`), the globe (`/[orgSlug]`) and the game
 * (`/[orgSlug]/[location]`). Each page checks the session itself; the pickers add the top bar.
 */
export default function GameLayout({ children }: LayoutProps<"/">) {
  return <div className="flex min-h-svh flex-1 flex-col">{children}</div>;
}

/** Account rules shared by the sign-in hook, the guards and the BFF (mirrors DocuMind's API
 * `is_admin_role` / ban handling). Client-safe: no server imports. */

export const BANNED_CODE = "ACCOUNT_BANNED";
export const BANNED_MESSAGE = "This DocuMind account is suspended, so it can't enter the office. Ask your DocuMind admin.";

/** Better Auth's admin plugin stores roles comma-separated (e.g. "admin,user"). */
export function hasAdminRole(role: string | null | undefined): boolean {
  return (role ?? "").split(",").some((part) => part.trim() === "admin");
}

/** Better Auth lifts expired bans lazily (on the next DocuMind sign-in), so honour the expiry. */
export function isBanned(banned: boolean | null | undefined, banExpires: Date | string | null | undefined): boolean {
  if (!banned) return false;
  return !banExpires || new Date(banExpires).getTime() > Date.now();
}

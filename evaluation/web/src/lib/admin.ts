/** Platform-admin rules, shared by the sign-in hook and the guards (mirrors the eval API's
 * `is_admin_role` / `is_banned`). Client-safe: no server imports. */

export const NOT_ADMIN_CODE = "NOT_PLATFORM_ADMIN";
export const NOT_ADMIN_MESSAGE = "Only DocuMind platform admins can use Evaluation.";

type AdminFields = {
  role?: string | null;
  banned?: boolean | null;
  banExpires?: Date | string | null;
};

/** Better Auth's admin plugin stores roles comma-separated (e.g. "admin,user"). */
export function hasAdminRole(role: string | null | undefined): boolean {
  return (role ?? "").split(",").some((part) => part.trim() === "admin");
}

/** Better Auth lifts expired bans lazily (on the next DocuMind sign-in), so honour the expiry. */
export function isBanned(banned: boolean | null | undefined, banExpires: Date | string | null | undefined): boolean {
  if (!banned) return false;
  return !banExpires || new Date(banExpires).getTime() > Date.now();
}

export function isPlatformAdmin(user: AdminFields | null | undefined): boolean {
  return !!user && hasAdminRole(user.role) && !isBanned(user.banned, user.banExpires);
}

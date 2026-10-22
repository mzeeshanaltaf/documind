/**
 * Eval orgs (`organization.metadata` = `{"eval": true}`, created by the evaluation harness) hold
 * synthetic data and never appear in the office, not even for platform admins. `metadata` is a
 * text column, so it may be null or malformed. Client-safe: no server imports.
 */
export function isEvalOrgMetadata(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    const parsed: unknown = JSON.parse(metadata);
    return typeof parsed === "object" && parsed !== null && (parsed as { eval?: unknown }).eval === true;
  } catch {
    return false;
  }
}

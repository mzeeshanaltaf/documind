"use server";

import { z } from "zod";
import { ApiError, apiJson } from "@/lib/api";
import type { OrgSettings } from "@/lib/api-types";
import { requireOrgAdmin } from "@/lib/auth-guards";

export type SettingsResult = { ok: true; data: OrgSettings } | { ok: false; error: string };

const tier = z.enum(["standard", "flex", "auto"]);
const updateSchema = z
  .object({
    chat_model: z.string().min(1).max(100),
    router_model: z.string().min(1).max(100),
    chat_service_tier: tier,
    background_service_tier: tier,
    top_k: z.number().int().min(4).max(15),
  })
  .partial()
  .strict();

/** PUT /settings with only the changed fields; FastAPI validates models against the pricing file. */
export async function saveSettings(orgSlug: string, changes: z.input<typeof updateSchema>): Promise<SettingsResult> {
  const { user, org } = await requireOrgAdmin(z.string().min(1).max(64).parse(orgSlug));
  const parsed = updateSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, error: "Some values are out of range. Check the form and try again." };
  try {
    const data = await apiJson<OrgSettings>(`orgs/${org.id}/settings`, { userId: user.id, method: "PUT", body: parsed.data });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { ok: false, error: error.message };
    console.error("[settings] save failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "Couldn't save the settings. Try again." };
  }
}

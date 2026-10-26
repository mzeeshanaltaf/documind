import { saveProgressSchema } from "@/game/quests/schema";
import { requireOrgAccess } from "@/lib/auth-guards";
import { writeProgress } from "@/lib/progress";

/**
 * The page-hide flush for quest progress (phase O9 › Persistence): `navigator.sendBeacon` can't
 * call a Server Action, so the last batch comes here. The same checks as `saveProgress`: a
 * session, org access, then zod, then the server-side merge. JSON only, so a cross-site form
 * can't post to it. Runs on Node.js (the default under cacheComponents).
 */
const MAX_BODY_BYTES = 32 * 1024;

const reply = (status: number, ok = false) => Response.json({ ok }, { status });

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply(415);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return reply(413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400);
  }
  const parsed = saveProgressSchema.safeParse(body);
  if (!parsed.success) return reply(400);

  let userId: string;
  try {
    // Signed out, banned, not a member or an eval org: the guards redirect or `notFound()`.
    ({ user: { id: userId } } = await requireOrgAccess(parsed.data.orgId));
  } catch {
    return reply(404);
  }
  try {
    await writeProgress(userId, parsed.data.orgId, parsed.data.patch);
  } catch (error) {
    console.error("[progress] beacon save failed", error);
    return reply(500);
  }
  return reply(200, true);
}

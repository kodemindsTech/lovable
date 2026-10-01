import { z } from "zod";

/**
 * Structured AI output contract (PRD §24). Application logic only ever reads these typed fields.
 * `score` is deliberately absent: the number always comes from the calculation engine.
 */
export const CoachReplySchema = z.object({
  status: z.enum(["on_track", "slightly_off", "off_track", "unknown"]),
  summary: z.string().min(1).max(1500),
  priority: z.string().max(300),
  recommendations: z.array(z.string().min(1).max(300)).max(3),
  confidence: z.number().min(0).max(1),
  safety_flag: z.boolean(),
});
export type CoachReply = z.infer<typeof CoachReplySchema>;

/** Extracts and validates a JSON object from model text (tolerates ```json fences / prose around it). */
export function parseCoachReply(text: string): { ok: true; value: CoachReply } | { ok: false; error: string } {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "no JSON object found" };
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return { ok: false, error: "invalid JSON" }; }
  const r = CoachReplySchema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

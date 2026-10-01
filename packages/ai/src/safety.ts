import type { CoachReply } from "./schema";

/**
 * Safety layer. Pre-check runs on the user's message BEFORE any model call; high-risk topics get a
 * fixed, vetted reply and the model is never invoked. Post-check validates the model's reply.
 * This is a defence-in-depth heuristic, not a clinical classifier — keep humans reviewing flagged chats.
 */
export type SafetyCategory = "self_harm" | "eating_disorder" | "extreme_diet" | "medical";

const RULES: { cat: SafetyCategory; re: RegExp }[] = [
  { cat: "self_harm", re: /\b(kill myself|suicid\w*|end my life|want to die|self[- ]?harm|hurt myself)\b/i },
  { cat: "eating_disorder", re: /\b(purg\w*|mak\w* myself (throw up|vomit|sick)|(vomit\w*|throw\w* up) (after (every |each |my )?(meal|eating)s?|on purpose|to (lose|burn))|starv\w* myself|starve|anorex\w*|bulimi\w*|laxatives? (to|for) (lose|weight)|punish myself (for|after) eating|stop eating (completely|altogether)|not eat(ing)? for (days|\d+ days))\b/i },
  { cat: "extreme_diet", re: /\b(lose|drop) \d{2,} ?(kg|kgs|pounds|lbs) in (a|one|1|2|two|3|three) (week|weeks|month)\b|\b(under|below|less than|only) (\d{2,3}|1[01]\d\d|[5-9]\d\d) (kcal|calories|cals)\b|\b(\d{3}) (kcal|calories|cals) (a|per) day\b|\bfast(ing)? for \d+ days\b|\bwater fast\b/i },
  { cat: "medical", re: /\b(chest pain|shortness of breath|short of breath|fainted|passed out|diagnos\w*|prescri\w*|medication|insulin|blood pressure|pregnan\w*|am i (sick|ill))\b/i },
];

export function preCheck(message: string): SafetyCategory | null {
  for (const r of RULES) if (r.re.test(message)) return r.cat;
  return null;
}

const DISCLAIMER = "I'm a fitness tracking assistant, not a medical professional.";
export const SAFETY_REPLIES: Record<SafetyCategory, CoachReply> = {
  self_harm: {
    status: "unknown", safety_flag: true, confidence: 1, priority: "Your safety comes first",
    summary: "I'm really sorry you're going through this. I can't help with this safely, but you deserve support right now. If you're in immediate danger, please contact your local emergency number. In India you can call Tele-MANAS on 14416, or reach out to someone you trust.",
    recommendations: ["Contact a local helpline or emergency services if you may act on these thoughts", "Talk to a trusted friend or family member today"],
  },
  eating_disorder: {
    status: "unknown", safety_flag: true, confidence: 1, priority: "Please talk to a professional",
    summary: `${DISCLAIMER} What you describe can be a sign that food or exercise is feeling hard right now, and I don't want to give targets or tips that could make that worse. A doctor, registered dietitian or counsellor can help, and you don't have to handle this alone.`,
    recommendations: ["Speak with a doctor or registered dietitian about how you're eating", "Reach out to someone you trust"],
  },
  extreme_diet: {
    status: "unknown", safety_flag: true, confidence: 1, priority: "Keep your plan in a safe range",
    summary: `${DISCLAIMER} Very fast weight loss or very low calorie intake can be unsafe, so I won't build a plan around it. Your targets in the app are set to a safe rate of loss. If you have a specific medical or event goal, please check with a doctor or registered dietitian first.`,
    recommendations: ["Stick to the calorie and protein targets shown in the app", "Check with a doctor or dietitian before any large change"],
  },
  medical: {
    status: "unknown", safety_flag: true, confidence: 1, priority: "Please check with a medical professional",
    summary: `${DISCLAIMER} I can't diagnose, advise on medication or assess symptoms. If you have chest pain, trouble breathing, or you've fainted, seek urgent medical care. For anything else about your health, please talk to a doctor.`,
    recommendations: ["Consult a doctor for symptoms or medical questions", "Come back to me for questions about your food, workouts and progress"],
  },
};

const BANNED = [
  /\byou (have|probably have|likely have|may have) (diabetes|pcos|thyroid|hypertension|an eating disorder|anemia|anaemia)\b/i,
  /\b(take|start|stop|increase|reduce) (your )?(medication|insulin|tablets?|pills?|metformin)\b/i,
  /\bskip (your )?(dinner|lunch|breakfast|meals?)\b/i,
  /\b(burn off|work off|make up for|compensate for) (the|that|your|those|extra) (food|calories|meal|binge)\b/i,
  /\b(fast|fasting) for \d+ (days|hours)\b/i,
];
const UNITS = "kcal|calories|cal|kg|steps|%|g|km|min";
const NUM_UNIT = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNITS})\\b`, "gi");

export interface PostCheck { ok: boolean; reasons: string[] }

/** Validates a model reply against safety rules and numeric grounding. */
export function postCheck(reply: CoachReply, allowed: number[], userMessage = ""): PostCheck {
  const reasons: string[] = [];
  const text = [reply.summary, reply.priority, ...reply.recommendations].join("\n");
  for (const b of BANNED) if (b.test(text)) reasons.push(`banned content: ${b.source.slice(0, 40)}`);

  const pool = [...allowed, ...(userMessage.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)];
  const near = (n: number) => pool.some((a) => Math.abs(a - n) <= Math.max(1, Math.abs(a) * 0.03));
  for (const m of text.matchAll(NUM_UNIT)) {
    const n = Number(m[1]!.replace(/,/g, "")), unit = m[2]!.toLowerCase();
    // Small counts of grams/minutes/km ("a 20 g scoop") are portions, not claims about the user's data.
    if (["g", "km", "min"].includes(unit) && n <= 10) continue;
    if (!near(n)) reasons.push(`ungrounded number: ${m[0]}`);
    if (["kcal", "calories", "cal"].includes(unit) && n < 1200 && /(per day|a day|daily|each day|total)/i.test(text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 60)) && n >= 500)
      reasons.push(`unsafe daily calorie figure: ${m[0]}`);
  }
  return { ok: reasons.length === 0, reasons };
}

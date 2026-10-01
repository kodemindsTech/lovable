import { normaliseUnit } from "./nutrition";

export interface ParsedItem {
  raw: string;
  quantity: number;
  /** Normalised unit, or "" when the user gave a bare count ("2 eggs"). */
  unit: string;
  /** Food phrase to search for, e.g. "chicken". */
  query: string;
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5,
};
const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
const UNITS = "g|gm|gms|grams?|kg|ml|l|litres?|liters?|katoris?|bowls?|cups?|plates?|pieces?|pcs?|tbsp|tablespoons?|tsp|teaspoons?|glass(?:es)?|scoops?|slices?|servings?";
const FILLER = /^(of|x)\s+/i;

/**
 * Deterministic natural-language meal parser. Does not look up foods and never
 * invents quantities: items without a recognisable quantity default to 1 so the
 * UI can show them for confirmation.
 */
export function parseMealText(text: string): ParsedItem[] {
  const parts = text
    .replace(/[½¼¾]/g, (c) => ` ${FRACTIONS[c]} `)
    .split(/,|;|\n|\band\b|\bwith\b|\+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: ParsedItem[] = [];
  for (const raw of parts) {
    const m = new RegExp(`^(\\d+(?:\\.\\d+)?(?:\\s*/\\s*\\d+)?|${Object.keys(WORDS).join("|")})\\s*(${UNITS})?\\b\\s*(.*)$`, "i").exec(raw);
    let quantity = 1, unit = "", rest = raw;
    if (m) {
      const q = m[1]!.toLowerCase();
      quantity = q in WORDS ? WORDS[q]! : q.includes("/") ? Number(q.split("/")[0]) / Number(q.split("/")[1]) : Number(q);
      unit = m[2] ? normaliseUnit(m[2]) : "";
      rest = m[3] ?? "";
    }
    const query = rest.replace(FILLER, "").replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (query && Number.isFinite(quantity) && quantity > 0) out.push({ raw, quantity, unit, query });
  }
  return out;
}

/** Singularise trivially so "rotis"/"eggs" match catalog names. */
export function searchTerm(q: string): string {
  return q
    .split(/\s+/)
    .map((w) =>
      w.endsWith("ies") && w.length > 4 ? `${w.slice(0, -3)}y`
      : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)
    .join(" ");
}

import type { Food } from "../lib/nutrition";

const LABEL: Record<Food["verification_status"], string | null> = {
  verified: null, admin_reviewed: null, user_entered: "User-entered", ai_estimated: "Estimate",
};
/** Shows provenance for anything that is not verified/reviewed (PRD: label estimates). */
export function EstimateChip({ status }: { status: Food["verification_status"] }) {
  const l = LABEL[status];
  return l ? <span className="chip" title="Nutrition values are approximate">{l}</span> : null;
}

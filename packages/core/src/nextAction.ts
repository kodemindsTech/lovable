import type { Goal } from "./types";
import type { DayInput } from "./score";
import { dayFraction } from "./score";

/**
 * "What should I do now?" — deterministic rules engine returning 1–3 prioritised actions.
 * All numbers come from the day's data; food suggestions come from the supplied catalog
 * (never invented), scaled to fit the remaining calories. The AI layer may rephrase, not alter.
 *
 * Safety: never advises skipping meals, crash dieting, or exercising to "burn off" food.
 */
export type Diet = "vegetarian" | "eggetarian" | "non_vegetarian" | "vegan" | "other";

export interface FoodCandidate {
  id: string; name: string; category: string | null;
  servingLabel: string; calories: number; proteinG: number; fibreG: number;
  status: "verified" | "user_entered" | "ai_estimated" | "admin_reviewed";
}

/** Conservative diet filter on catalog category/name. `other` = no filtering. */
export function isDietCompatible(diet: Diet | null | undefined, f: Pick<FoodCandidate, "name" | "category">): boolean {
  if (!diet || diet === "other") return true;
  const n = f.name.toLowerCase();
  const meat = f.category === "Meat & Fish" || /chicken|fish|mutton|meat|prawn|keema/.test(n);
  const egg = /\begg|omelet/.test(n);
  const dairy = f.category === "Dairy & Eggs" && !egg && !/tofu/.test(n) || /paneer|whey|curd|dahi|yogurt|raita|milk|chaas|butter|ghee/.test(n);
  if (meat) return diet === "non_vegetarian";
  if (diet === "vegetarian" && egg) return false;
  if (diet === "vegan") return !egg && !dairy;
  return true;
}

export interface NextActionInput extends DayInput {
  diet?: Diet | null;
  foods: FoodCandidate[];
}
export interface FoodSuggestion { foodId: string; name: string; servings: number; servingLabel: string; calories: number; proteinG: number; fibreG: number; status: FoodCandidate["status"] }
export type ActionKind = "log" | "nutrition" | "activity" | "workout" | "safety" | "on_track";
export interface NextAction {
  id: string; kind: ActionKind; priority: number; title: string; detail: string; why: string;
  suggestions: FoodSuggestion[];
}

const STEPS_PER_MIN = 100;
const round5 = (n: number) => Math.round(n / 5) * 5;

export function nextMealLabel(hour: number): string {
  return hour < 11 ? "breakfast" : hour < 16 ? "lunch" : hour < 18.5 ? "snack" : "dinner";
}

/** Picks foods that cover a nutrient gap within a calorie budget. Servings in 0.5 steps, max 2. */
export function suggestFoods(foods: FoodCandidate[], need: { nutrient: "proteinG" | "fibreG"; amount: number; maxKcal: number }, n = 3): FoodSuggestion[] {
  const out: (FoodSuggestion & { value: number })[] = [];
  for (const f of foods) {
    const per = f[need.nutrient];
    if (per <= 0 || f.calories <= 0) continue;
    let best: number | null = null;
    for (const s of [0.5, 1, 1.5, 2]) if (f.calories * s <= need.maxKcal && per * s <= need.amount * 1.35) best = s;
    if (best === null) continue;
    const covered = Math.min(1, (per * best) / need.amount);
    out.push({
      foodId: f.id, name: f.name, servings: best, servingLabel: f.servingLabel,
      calories: Math.round(f.calories * best), proteinG: Math.round(f.proteinG * best * 10) / 10,
      fibreG: Math.round(f.fibreG * best * 10) / 10, status: f.status,
      value: covered * (per / f.calories),
    });
  }
  return out.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, n).map(({ value: _v, ...s }) => s);
}

export function nextActions(i: NextActionInput): NextAction[] {
  const frac = dayFraction(i.hour, i.dayComplete);
  const partial = !i.dayComplete && frac < 1;
  const t = i.targets, tot = i.totals;
  const foods = i.foods.filter((f) => isDietCompatible(i.diet, f));
  const remKcal = t.calories - tot.calories;
  const acts: NextAction[] = [];
  const push = (a: Omit<NextAction, "suggestions"> & { suggestions?: FoodSuggestion[] }) => acts.push({ suggestions: [], ...a });

  if (i.mealsLogged === 0) {
    push({ id: "log_meal", kind: "log", priority: 100, title: "Log your first meal",
      detail: `Nothing logged yet today. Add what you've eaten so I can work out what you need next.`,
      why: "Recommendations need today's food data — I won't guess." });
    // activity/steps prompts can still follow
  } else {
    const over = tot.calories - t.calories;
    const surplusGoal: Goal[] = ["build_muscle", "gain_weight"];
    if (over > t.calories * 0.1 && !surplusGoal.includes(i.goal)) {
      push({ id: "calories_over", kind: "nutrition", priority: 85, title: `You're about ${round5(over)} kcal over today's target`,
        detail: "Keep the rest of the day light and protein-forward if you eat again. There's no need to skip meals or add extra exercise to make up for it — just return to your plan tomorrow.",
        why: `${Math.round(tot.calories)} of ${t.calories} kcal eaten.` });
    }
    if (i.dayComplete || i.hour >= 20) {
      if (tot.calories < t.calories * 0.5 && i.mealsLogged >= 1 && (i.dayComplete || i.hour >= 20)) {
        push({ id: "under_eating", kind: "safety", priority: 90, title: "You've eaten well below your target today",
          detail: "If you can, have a balanced meal or snack with protein and carbs. If you're regularly eating this little, consider speaking with a doctor or registered dietitian.",
          why: `${Math.round(tot.calories)} of ${t.calories} kcal logged (under 50%). If you haven't logged everything, add it for a more accurate picture.` });
      }
    }

    const remP = t.proteinG - tot.proteinG;
    const gapP = partial ? t.proteinG * frac - tot.proteinG : remP;
    // Late in the day, any meaningful remaining protein is worth acting on, regardless of earlier pace.
    if (remP > 0 && (gapP > t.proteinG * 0.05 || ((!partial || i.hour >= 16) && remP > 5))) {
      const budget = Math.max(remKcal, 0);
      const sugg = budget >= 40 ? suggestFoods(foods, { nutrient: "proteinG", amount: remP, maxKcal: Math.min(budget, 600) }) : [];
      push({ id: "protein", kind: "nutrition", priority: 40 + (remP / t.proteinG) * 60 * (0.5 + frac / 2),
        title: `Your next priority is protein — about ${Math.round(remP)} g to go`,
        detail: sugg.length ? `Options that fit your remaining calories:` : budget < 40 ? "You're at your calorie target, so choose the leanest protein you can at your next meal." : "Add a protein source to your next meal.",
        why: `${Math.round(tot.proteinG)} of ${t.proteinG} g protein so far.`, suggestions: sugg });
    }

    const remF = t.fibreG - tot.fibreG;
    if (remF >= 5 && (!partial || frac > 0.5)) {
      const sugg = remKcal >= 40 ? suggestFoods(foods, { nutrient: "fibreG", amount: remF, maxKcal: Math.min(Math.max(remKcal, 0), 400) }, 2) : [];
      push({ id: "fibre", kind: "nutrition", priority: 25 + (remF / t.fibreG) * 40 * frac,
        title: `Add about ${Math.round(remF)} g more fibre`, detail: sugg.length ? "Good options:" : "Vegetables, dal, fruit or whole grains at your next meal will help.",
        why: `${Math.round(tot.fibreG)} of ${t.fibreG} g fibre so far.`, suggestions: sugg });
    }

    if (remKcal > 150 && !i.dayComplete) {
      const meal = nextMealLabel(i.hour);
      const lo = round5(Math.max(100, remKcal * 0.8)), hi = round5(remKcal);
      push({ id: "calories_left", kind: "nutrition", priority: 20 + (remKcal / t.calories) * 30,
        title: `About ${round5(remKcal)} kcal left today`,
        detail: `Aim for roughly ${lo}–${hi} kcal at ${meal === "snack" ? "your next snack or meal" : meal}, keeping it high in protein.`,
        why: `${Math.round(tot.calories)} of ${t.calories} kcal eaten.` });
    }
  }

  // ---- activity ----
  const stepsDone = i.stepsToday !== null && i.stepsToday >= t.steps;
  const activeDone = (i.activeMinutes ?? 0) >= 30;
  if (i.stepsToday === null && i.activeMinutes === null) {
    push({ id: "add_activity", kind: "activity", priority: 18, title: "Add today's steps or activity",
      detail: "Connect an activity source or add activity manually so I can tell whether you've hit your movement target.",
      why: "No activity recorded today — I don't assume any." });
  } else if (!stepsDone && !activeDone && i.stepsToday !== null && !i.dayComplete && i.stepsToday < t.steps * frac) {
    const left = t.steps - i.stepsToday;
    push({ id: "walk", kind: "activity", priority: 30 + (left / t.steps) * 20,
      title: `Aim for about ${round5(left).toLocaleString()} more steps`,
      detail: `That's roughly ${Math.max(5, round5(left / STEPS_PER_MIN))} minutes of brisk walking — an easy way to close the gap.`,
      why: `${i.stepsToday.toLocaleString()} of ${t.steps.toLocaleString()} steps.` });
  }

  // ---- workouts ----
  if (i.trainingDays > 0 && i.workoutsLast7 >= i.trainingDays + 2) {
    push({ id: "rest", kind: "workout", priority: 22, title: "Consider a rest or light day",
      detail: `You've trained ${i.workoutsLast7} times in the last 7 days, above your plan of ${i.trainingDays}. Recovery is part of progress.`,
      why: "Based on your logged workouts." });
  } else if (i.trainingDays > 0 && i.workoutsLast7 < i.trainingDays && !i.dayComplete && i.hour < 20) {
    push({ id: "workout", kind: "workout", priority: 28, title: "A workout is still due this week",
      detail: `${i.workoutsLast7} of ${i.trainingDays} planned sessions done in the last 7 days.`,
      why: "Compared with your planned training days." });
  }

  if (!acts.length || (acts.every((a) => a.kind === "activity" || a.kind === "workout") && i.mealsLogged > 0 && stepsDone)) {
    push({ id: "on_track", kind: "on_track", priority: 5, title: "You're on track",
      detail: `${stepsDone || activeDone ? "Your activity target is done, so extra cardio isn't necessary. " : ""}Keep your remaining meals balanced and you're set.`,
      why: "Calories, protein and fibre are within range for this point in the day." });
  }

  return acts.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, 3);
}

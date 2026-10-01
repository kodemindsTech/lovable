import { useState, type FormEvent } from "react";
import { calcTargets, type ActivityLevel, type Goal, type Sex } from "@fitness-os/core";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

const goals: [Goal, string][] = [
  ["lose_weight", "Lose weight"], ["lose_fat", "Lose fat"], ["maintain", "Maintain"],
  ["build_muscle", "Build muscle"], ["gain_weight", "Gain weight"],
  ["improve_fitness", "Improve fitness"], ["improve_running", "Improve running"],
];
const levels: [ActivityLevel, string][] = [
  ["sedentary", "Sedentary"], ["light", "Light"], ["moderate", "Moderate"],
  ["very_active", "Very active"], ["extremely_active", "Extremely active"],
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { session } = useAuth();
  const [f, setF] = useState({
    name: "", age: "", sex: "male" as Sex, heightCm: "", weightKg: "", targetWeightKg: "",
    goal: "lose_fat" as Goal, activityLevel: "moderate" as ActivityLevel,
    diet: "non_vegetarian", trainingDays: "3", consent: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    setErr(null); setBusy(true);
    try {
      const input = {
        sex: f.sex, age: Number(f.age), heightCm: Number(f.heightCm), weightKg: Number(f.weightKg),
        goal: f.goal, activityLevel: f.activityLevel,
      };
      const t = calcTargets(input); // throws RangeError on invalid input
      const { error } = await supabase.rpc("complete_onboarding", {
        p: {
          name: f.name, age: input.age, sex: f.sex, height_cm: input.heightCm, weight_kg: input.weightKg,
          target_weight_kg: f.targetWeightKg, goal: f.goal, activity_level: f.activityLevel,
          diet: f.diet, training_days: Number(f.trainingDays), policy_version: "draft-1", inputs: input,
          targets: {
            calories: t.calories, protein_g: t.proteinG, carbs_g: t.carbsG, fat_g: t.fatG,
            fibre_g: t.fibreG, steps: t.steps, formula_version: t.formulaVersion,
          },
        },
      });
      if (error) throw error;
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : (e as { message?: string }).message ?? "Failed to save");
    } finally { setBusy(false); }
  }

  return (
    <form className="card auth" onSubmit={submit}>
      <h1>Set up your plan</h1>
      <label>Name<input value={f.name} onChange={set("name")} /></label>
      <label>Age (18+)<input type="number" required min={18} max={100} value={f.age} onChange={set("age")} /></label>
      <label>Sex
        <select value={f.sex} onChange={set("sex")}><option value="male">Male</option><option value="female">Female</option></select>
      </label>
      <label>Height (cm)<input type="number" required min={120} max={230} value={f.heightCm} onChange={set("heightCm")} /></label>
      <label>Current weight (kg)<input type="number" step="0.1" required min={30} max={300} value={f.weightKg} onChange={set("weightKg")} /></label>
      <label>Target weight (kg)<input type="number" step="0.1" min={30} max={300} value={f.targetWeightKg} onChange={set("targetWeightKg")} /></label>
      <label>Goal<select value={f.goal} onChange={set("goal")}>{goals.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Activity level<select value={f.activityLevel} onChange={set("activityLevel")}>{levels.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Diet
        <select value={f.diet} onChange={set("diet")}>
          <option value="vegetarian">Vegetarian</option><option value="eggetarian">Eggetarian</option>
          <option value="non_vegetarian">Non-vegetarian</option><option value="vegan">Vegan</option><option value="other">Other</option>
        </select>
      </label>
      <label>Training days per week<input type="number" min={0} max={7} value={f.trainingDays} onChange={set("trainingDays")} /></label>
      <label className="check">
        <input type="checkbox" required checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
        I consent to this app storing my health and fitness data to calculate targets. This is not medical advice.
      </label>
      {err && <p role="alert">{err}</p>}
      <button disabled={busy}>{busy ? "Saving…" : "Calculate my targets"}</button>
    </form>
  );
}

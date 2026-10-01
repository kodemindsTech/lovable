import { supabase } from "./supabase";
import type { SessionSets } from "@fitness-os/core";
import { track } from "./analytics";

export interface Exercise { id: string; name: string; muscle_group: string; equipment: string; difficulty: string; instructions: string | null; tracks: "weight_reps" | "reps" | "duration" }
export interface Session { id: string; local_date: string; workout_name: string; duration_min: number | null; notes: string | null; completed: boolean; started_at: string }
export interface SetRow { id: string; session_id: string; exercise_id: string; set_number: number; weight_kg: number | null; reps: number | null; duration_s: number | null }
export interface Template { id: string; name: string }

const must = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export const searchExercises = async (q: string): Promise<Exercise[]> =>
  must(await supabase.rpc("search_exercises", { q, lim: 12 })) ?? [];
export const startSession = async (date: string, name: string, template: string | null): Promise<Session> => {
  const s = must(await supabase.rpc("start_session", { p_date: date, p_name: name, p_template: template })) as Session;
  track("workout_started");
  return s;
};
export const listSessions = async (): Promise<Session[]> =>
  must(await supabase.from("workout_sessions").select("*").order("local_date", { ascending: false }).order("started_at", { ascending: false }).limit(50)) ?? [];
export const listTemplates = async (): Promise<Template[]> =>
  must(await supabase.from("workout_templates").select("id,name").order("created_at", { ascending: false })) ?? [];
export const deleteSession = async (id: string) => { must(await supabase.from("workout_sessions").delete().eq("id", id)); };
export const saveTemplate = async (sessionId: string, name: string) => { must(await supabase.rpc("save_template_from_session", { p_session: sessionId, p_name: name })); };

export async function loadSession(id: string) {
  const [s, ex, sets] = await Promise.all([
    supabase.from("workout_sessions").select("*").eq("id", id).single(),
    supabase.from("session_exercises").select("exercise_id, position, exercises(*)").eq("session_id", id).order("position"),
    supabase.from("workout_sets").select("*").eq("session_id", id).order("set_number"),
  ]);
  return {
    session: must(s) as Session,
    exercises: (must(ex) ?? []).map((r: unknown) => (r as { exercises: Exercise }).exercises),
    sets: (must(sets) ?? []).map((r: SetRow) => ({ ...r, weight_kg: numOrNull(r.weight_kg) })) as SetRow[],
  };
}

export async function addExerciseToSession(session: string, exercise: string, position: number) {
  const { data: u } = await supabase.auth.getUser();
  must(await supabase.from("session_exercises").insert({ user_id: u.user!.id, session_id: session, exercise_id: exercise, position }));
}
export async function removeExerciseFromSession(session: string, exercise: string) {
  must(await supabase.from("workout_sets").delete().eq("session_id", session).eq("exercise_id", exercise));
  must(await supabase.from("session_exercises").delete().eq("session_id", session).eq("exercise_id", exercise));
}
export async function addSet(s: { session: string; exercise: string; setNumber: number; weightKg: number | null; reps: number | null; durationS: number | null }) {
  const { data: u } = await supabase.auth.getUser();
  must(await supabase.from("workout_sets").insert({
    user_id: u.user!.id, session_id: s.session, exercise_id: s.exercise, set_number: s.setNumber,
    weight_kg: s.weightKg, reps: s.reps, duration_s: s.durationS,
  }));
}
export const deleteSet = async (id: string) => { must(await supabase.from("workout_sets").delete().eq("id", id)); };
export const updateSession = async (id: string, patch: Partial<Pick<Session, "completed" | "duration_min" | "notes" | "workout_name">>) => {
  must(await supabase.from("workout_sessions").update(patch).eq("id", id));
  if (patch.completed === true) track("workout_completed");
};

/** Previous sessions' sets for an exercise, newest first (excludes the open session). */
export async function history(exerciseId: string, excludeSession: string): Promise<{ date: string; sets: SessionSets }[]> {
  const rows = (must(await supabase.rpc("exercise_history", { p_exercise: exerciseId, p_limit: 5, p_exclude_session: excludeSession })) ?? []) as
    { local_date: string; sets: { weight_kg: number | null; reps: number | null }[] }[];
  return rows.map((r) => ({ date: r.local_date, sets: r.sets.map((s) => ({ weightKg: numOrNull(s.weight_kg), reps: s.reps })) }));
}

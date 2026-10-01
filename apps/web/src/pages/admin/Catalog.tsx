import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useLoad, must } from "../../lib/admin";
import { ScreenState } from "../../components/ScreenState";

type Rec = Record<string, string | number | null>;
interface Field { key: string; label: string; type: "text" | "number" | "select"; options?: string[]; wide?: boolean }

const FOOD_FIELDS: Field[] = [
  { key: "name", label: "Name", type: "text", wide: true }, { key: "serving_size", label: "Serving size", type: "number" }, { key: "serving_unit", label: "Unit", type: "text" },
  { key: "calories", label: "kcal", type: "number" }, { key: "protein_g", label: "Protein g", type: "number" }, { key: "carbs_g", label: "Carbs g", type: "number" },
  { key: "fat_g", label: "Fat g", type: "number" }, { key: "fibre_g", label: "Fibre g", type: "number" },
  { key: "verification_status", label: "Verification", type: "select", options: ["ai_estimated", "admin_reviewed", "verified"] },
];
const EX_FIELDS: Field[] = [
  { key: "name", label: "Name", type: "text", wide: true }, { key: "muscle_group", label: "Muscle group", type: "text" }, { key: "equipment", label: "Equipment", type: "text" },
  { key: "difficulty", label: "Difficulty", type: "select", options: ["beginner", "intermediate", "advanced"] },
  { key: "tracks", label: "Tracks", type: "select", options: ["weight_reps", "reps", "duration"] }, { key: "instructions", label: "Instructions", type: "text", wide: true },
];

export const FoodsAdmin = () => <Catalog table="foods" fields={FOOD_FIELDS} defaults={{ serving_size: 1, serving_unit: "piece", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, source: "admin", verification_status: "ai_estimated" }} note="Shared catalog only. Marking a food 'admin_reviewed' or 'verified' should follow an actual review against a trusted source — statuses are never mixed." />;
export const ExercisesAdmin = () => <Catalog table="exercises" fields={EX_FIELDS} defaults={{ muscle_group: "", equipment: "", difficulty: "beginner", tracks: "weight_reps" }} note="Shared catalog only. Keep instructions to general technique cues and have a qualified trainer review them." />;

function Catalog({ table, fields, defaults, note }: { table: "foods" | "exercises"; fields: Field[]; defaults: Rec; note: string }) {
  const [q, setQ] = useState(""); const [term, setTerm] = useState("");
  const [edit, setEdit] = useState<Rec | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const l = useLoad(async () => {
    let query = supabase.from(table).select("*").is("owner_id", null).order("name").limit(100);
    if (term) query = query.ilike("name", `%${term}%`);
    return (must(await query) ?? []) as Rec[];
  }, [table, term]);

  async function save() {
    if (!edit) return;
    setMsg(null);
    const body: Rec = {};
    for (const f of fields) body[f.key] = f.type === "number" ? Number(edit[f.key] ?? 0) : (edit[f.key] as string) ?? "";
    if (!String(body.name).trim()) return setMsg("Name is required.");
    try {
      must(edit.id ? await supabase.from(table).update(body).eq("id", edit.id as string) : await supabase.from(table).insert({ ...defaults, ...body, owner_id: null }));
      setEdit(null); await l.reload();
    } catch (e) { setMsg((e as Error).message); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this item from the shared catalog?")) return;
    try { must(await supabase.from(table).delete().eq("id", id)); await l.reload(); } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <>
      <p className="muted small">{note} Every change is audited.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <input aria-label="Search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /><button>Search</button>
        <button type="button" className="ghost" onClick={() => setEdit({ ...defaults })}>+ New</button>
      </form>
      {msg && <p role="alert" className="warn">{msg}</p>}
      {edit && (
        <section className="card stack" aria-label="Editor">
          {fields.map((f) => (
            <label key={f.key}>{f.label}
              {f.type === "select"
                ? <select value={String(edit[f.key] ?? "")} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                : <input type={f.type} step="any" value={edit[f.key] ?? ""} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />}
            </label>
          ))}
          <div className="row"><button onClick={save}>Save</button><button className="ghost" onClick={() => setEdit(null)}>Cancel</button></div>
        </section>
      )}
      <ScreenState loading={l.loading} error={l.error} onRetry={l.reload}>
        {l.data && !l.data.length ? <p className="muted">Nothing found.</p> : (
          <ul className="list">{l.data?.map((r) => (
            <li key={String(r.id)} className="logrow">
              <div><strong>{r.name}</strong> <span className="chip">{String(r.verification_status ?? r.difficulty ?? "")}</span>
                <div className="muted small">{table === "foods" ? `${r.calories} kcal · P ${r.protein_g} · C ${r.carbs_g} · F ${r.fat_g} · Fibre ${r.fibre_g} per ${r.serving_size} ${r.serving_unit}` : `${r.muscle_group} · ${r.equipment}`}</div></div>
              <div><button className="ghost" onClick={() => setEdit({ ...r })}>Edit</button><button className="ghost" onClick={() => remove(String(r.id))}>Delete</button></div>
            </li>))}</ul>
        )}
      </ScreenState>
    </>
  );
}

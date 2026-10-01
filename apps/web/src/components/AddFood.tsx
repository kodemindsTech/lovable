import { useEffect, useState } from "react";
import { parseMealText, scale, searchTerm, toServings } from "@fitness-os/core";
import { logFood, searchFoods, type Food, type MealType } from "../lib/nutrition";
import { EstimateChip } from "./EstimateChip";

const foodMacros = (f: Food) => ({ calories: f.calories, proteinG: f.protein_g, carbsG: f.carbs_g, fatG: f.fat_g, fibreG: f.fibre_g });

interface Resolved { raw: string; food: Food | null; servings: number | null; note?: string }

export function AddFood({ date, meal, onDone, onClose }: { date: string; meal: MealType; onDone: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<"search" | "describe">("search");
  return (
    <div className="card" role="dialog" aria-label="Add food">
      <div className="row">
        <div className="tabs">
          <button className={tab === "search" ? "" : "ghost"} onClick={() => setTab("search")}>Search</button>
          <button className={tab === "describe" ? "" : "ghost"} onClick={() => setTab("describe")}>Describe meal</button>
        </div>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      {tab === "search" ? <Search date={date} meal={meal} onDone={onDone} /> : <Describe date={date} meal={meal} onDone={onDone} />}
    </div>
  );
}

function Search({ date, meal, onDone }: { date: string; meal: MealType; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [picked, setPicked] = useState<Food | null>(null);
  const [qty, setQty] = useState("1");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => { searchFoods(q).then(setResults).catch((e: Error) => setErr(e.message)); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function add() {
    if (!picked) return;
    const n = Number(qty);
    if (!(n > 0)) { setErr("Enter a quantity greater than 0."); return; }
    setBusy(true); setErr(null);
    try { await logFood(picked.id, date, meal, n); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (picked) {
    const m = scale(foodMacros(picked), Number(qty) > 0 ? Number(qty) : 0);
    return (
      <div className="stack">
        <strong>{picked.name}</strong> <EstimateChip status={picked.verification_status} />
        <label>Servings (1 = {picked.serving_size} {picked.serving_unit})
          <input type="number" min="0.25" step="0.25" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <p className="muted">{Math.round(m.calories)} kcal · P {m.proteinG.toFixed(1)}g · C {m.carbsG.toFixed(1)}g · F {m.fatG.toFixed(1)}g · Fibre {m.fibreG.toFixed(1)}g</p>
        {err && <p role="alert">{err}</p>}
        <div className="row"><button disabled={busy} onClick={add}>Add to log</button><button className="link" onClick={() => setPicked(null)}>Back</button></div>
      </div>
    );
  }
  return (
    <div className="stack">
      <input autoFocus placeholder="Search foods (e.g. roti, dal, biryani)" aria-label="Search foods" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p role="alert">{err}</p>}
      {q.trim() && !results.length && <p className="muted">No foods found.</p>}
      <ul className="list">
        {results.map((f) => (
          <li key={f.id}><button className="item" onClick={() => setPicked(f)}>
            <span>{f.name} <EstimateChip status={f.verification_status} /></span>
            <span className="muted">{Math.round(f.calories)} kcal / {f.serving_size} {f.serving_unit}</span>
          </button></li>
        ))}
      </ul>
    </div>
  );
}

function Describe({ date, meal, onDone }: { date: string; meal: MealType; onDone: () => void }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Resolved[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true); setErr(null);
    try {
      const parsed = parseMealText(text);
      if (!parsed.length) { setErr("Couldn't find any foods in that text."); setItems(null); return; }
      const out: Resolved[] = [];
      for (const p of parsed) {
        const [food] = await searchFoods(searchTerm(p.query), 1);
        if (!food) { out.push({ raw: p.raw, food: null, servings: null, note: "No match — try Search." }); continue; }
        const s = toServings({ servingSize: food.serving_size, servingUnit: food.serving_unit, servingGrams: food.serving_grams }, p.quantity, p.unit);
        out.push({ raw: p.raw, food, servings: s, note: s == null ? `Unsure how much "${p.raw}" is — set servings.` : undefined });
      }
      setItems(out);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function confirm() {
    if (!items) return;
    setBusy(true); setErr(null);
    try {
      for (const it of items) if (it.food && it.servings && it.servings > 0) await logFood(it.food.id, date, meal, it.servings);
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const loggable = items?.filter((i) => i.food && i.servings && i.servings > 0).length ?? 0;
  return (
    <div className="stack">
      <textarea rows={3} aria-label="Describe your meal" placeholder="2 eggs, 3 egg whites, 2 rotis and 150g chicken" value={text} onChange={(e) => { setText(e.target.value); setItems(null); }} />
      <button disabled={busy || !text.trim()} onClick={resolve}>Find foods</button>
      {err && <p role="alert">{err}</p>}
      {items && (
        <>
          <p className="muted">Please confirm — matches are suggestions, values are estimates.</p>
          <ul className="list">
            {items.map((it, i) => (
              <li key={i} className="resolved">
                <div><strong>{it.food?.name ?? it.raw}</strong> {it.food && <EstimateChip status={it.food.verification_status} />}
                  {it.note && <div className="warn">{it.note}</div>}</div>
                {it.food && (
                  <label className="inline">servings
                    <input type="number" min="0" step="0.25" value={it.servings ?? ""} aria-label={`Servings of ${it.food.name}`}
                      onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, servings: e.target.value === "" ? null : Number(e.target.value), note: undefined } : x))} />
                  </label>
                )}
              </li>
            ))}
          </ul>
          <button disabled={busy || !loggable} onClick={confirm}>Log {loggable} item{loggable === 1 ? "" : "s"}</button>
        </>
      )}
    </div>
  );
}

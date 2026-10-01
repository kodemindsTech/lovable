import { useState } from "react";
import { addDays, localDate } from "../lib/date";
import { useProfile } from "../lib/profile";
import { MEALS, addWater, deleteLog, updateQuantity, useDay, type FoodLog, type MealType } from "../lib/nutrition";
import { ScreenState } from "../components/ScreenState";
import { MacroBar } from "../components/MacroBars";
import { AddFood } from "../components/AddFood";
import { EstimateChip } from "../components/EstimateChip";

export default function Nutrition() {
  const today = localDate();
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState<MealType | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const { targets } = useProfile();
  const { logs, totals, loading, error, reload } = useDay(date);

  async function run(fn: () => Promise<void>) {
    setActionErr(null);
    try { await fn(); await reload(); } catch (e) { setActionErr((e as Error).message); }
  }

  return (
    <>
      <div className="row">
        <button className="ghost" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>‹</button>
        <h1>{date === today ? "Today" : date}</h1>
        <button className="ghost" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>›</button>
      </div>
      <ScreenState loading={loading && !totals} error={error} onRetry={reload}>
        {actionErr && <p role="alert" className="warn">{actionErr}</p>}
        {totals && targets && (
          <section className="card">
            <MacroBar label="Calories" current={totals.calories} target={targets.calories} unit=" kcal" />
            <MacroBar label="Protein" current={totals.protein_g} target={targets.protein_g} unit="g" />
            <MacroBar label="Carbohydrates" current={totals.carbs_g} target={targets.carbs_g} unit="g" />
            <MacroBar label="Fat" current={totals.fat_g} target={targets.fat_g} unit="g" />
            <MacroBar label="Fibre" current={totals.fibre_g} target={targets.fibre_g} unit="g" />
            <div className="row">
              <span>Water: {totals.water_ml} ml</span>
              <span>{[250, 500].map((ml) => (
                <button key={ml} className="ghost" onClick={() => run(() => addWater(date, ml))}>+{ml} ml</button>
              ))}</span>
            </div>
          </section>
        )}
        {!logs.length && !loading && <p className="muted">No meals logged {date === today ? "today" : "this day"}.</p>}
        {MEALS.map((m) => {
          const items = logs.filter((l) => l.meal_type === m.key);
          return (
            <section key={m.key} className="card">
              <div className="row">
                <h2>{m.label}</h2>
                <button onClick={() => setAdding(adding === m.key ? null : m.key)}>+ Add</button>
              </div>
              {adding === m.key && (
                <AddFood date={date} meal={m.key} onClose={() => setAdding(null)} onDone={() => { setAdding(null); void reload(); }} />
              )}
              <ul className="list">{items.map((l) => <LogRow key={l.id} log={l} onEdit={(q) => run(() => updateQuantity(l.id, q))} onDelete={() => run(() => deleteLog(l.id))} />)}</ul>
            </section>
          );
        })}
      </ScreenState>
    </>
  );
}

function LogRow({ log, onEdit, onDelete }: { log: FoodLog; onEdit: (q: number) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState(String(log.quantity));
  return (
    <li className="logrow">
      <div>
        <div>{log.name} <EstimateChip status={log.source_status} /></div>
        <div className="muted">
          {log.quantity} × {log.serving_label} · {Math.round(log.calories)} kcal · P {log.protein_g.toFixed(1)}g · Fibre {log.fibre_g.toFixed(1)}g
        </div>
      </div>
      <div>
        {editing ? (
          <>
            <input type="number" min="0.25" step="0.25" value={q} aria-label={`Servings of ${log.name}`} onChange={(e) => setQ(e.target.value)} />
            <button onClick={() => { const n = Number(q); if (n > 0) { onEdit(n); setEditing(false); } }}>Save</button>
          </>
        ) : (
          <button className="ghost" onClick={() => setEditing(true)}>Edit</button>
        )}
        <button className="ghost" aria-label={`Delete ${log.name}`} onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}

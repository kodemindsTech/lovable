import type { Change } from "@fitness-os/core";

const sentimentClass = (c: Change) => (c.sentiment === "better" ? "good" : c.sentiment === "worse" ? "bad" : "");

export function ChangeList({ items, empty }: { items: Change[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return <ul className="list">{items.map((c) => <li key={c.key} className={`change ${sentimentClass(c)}`}>{c.direction === "up" ? "▲" : "▼"} {c.text}</li>)}</ul>;
}

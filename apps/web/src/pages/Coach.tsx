import { useEffect, useRef, useState } from "react";
import { CoachError, SUGGESTED, hasAiConsent, latestConversation, sendMessage, setAiConsent, type CoachReply, type CoachResponse, type StoredMessage } from "../lib/coach";
import { ScreenState } from "../components/ScreenState";
import { FeatureGate } from "../components/FeatureGate";
import { track } from "../lib/analytics";

interface Turn { id: string; role: "user" | "assistant"; text: string; reply?: CoachReply; source?: CoachResponse["source"] | null; fallback?: CoachResponse["fallback_reason"] }

const FALLBACK_TEXT: Record<NonNullable<CoachResponse["fallback_reason"]>, string> = {
  ai_not_configured: "AI isn't enabled on this server, so this is a rules-based summary of your data.",
  ai_unavailable: "AI is temporarily unavailable, so this is a rules-based summary of your data.",
  invalid_output: "The AI answer couldn't be verified, so this is a rules-based summary of your data.",
  failed_validation: "The AI answer didn't pass our safety and accuracy checks, so this is a rules-based summary of your data.",
  quota_exceeded: "You've reached today's AI limit, so this is a rules-based summary of your data.",
};

export default function Coach() {
  return <FeatureGate feature="ai_coach"><CoachInner /></FeatureGate>;
}

function CoachInner() {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conv, setConv] = useState<string | undefined>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<{ msg: string; retry?: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const c = await hasAiConsent(); setConsent(c);
      if (c) {
        const l = await latestConversation();
        if (l) { setConv(l.id); setTurns(l.messages.map(fromStored)); }
      }
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); track("ai_opened"); }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [turns.length]);

  async function send(message: string) {
    const m = message.trim(); if (!m || busy) return;
    setBusy(true); setSendErr(null); setText("");
    const mine: Turn = { id: `u${Date.now()}`, role: "user", text: m };
    setTurns((t) => [...t, mine]);
    try {
      const r = await sendMessage(m, conv);
      setConv(r.conversation_id);
      setTurns((t) => [...t, { id: `a${Date.now()}`, role: "assistant", text: r.reply.summary, reply: r.reply, source: r.source, fallback: r.fallback_reason }]);
    } catch (e) {
      setTurns((t) => t.filter((x) => x.id !== mine.id));
      if (e instanceof CoachError && e.code === "consent_required") setConsent(false);
      setSendErr({ msg: (e as Error).message, retry: (e as CoachError).retryable ? m : undefined });
    } finally { setBusy(false); }
  }

  if (loading || error) return <><h1>AI Coach</h1><ScreenState loading={loading} error={error} onRetry={load} /></>;
  if (!consent)
    return (
      <>
        <h1>AI Coach</h1>
        <section className="card stack">
          <h2>Before you start</h2>
          <p>To answer, the coach sends a summary of your logged data (goal, targets, today's totals, weight trend, weekly averages) and your question to an AI provider. Your name, email and account details are not sent. Answers are generated from your data and are not medical advice.</p>
          <button onClick={async () => { try { await setAiConsent(true); setConsent(true); } catch (e) { setSendErr({ msg: (e as Error).message }); } }}>I agree — enable the coach</button>
          {sendErr && <p role="alert" className="warn">{sendErr.msg}</p>}
        </section>
      </>
    );

  return (
    <>
      <h1>AI Coach</h1>
      {!turns.length && (
        <section className="card stack">
          <p className="muted">Ask about your food, training or progress. Answers use your real logged data.</p>
          <div className="row" style={{ justifyContent: "flex-start" }}>{SUGGESTED.map((q) => <button key={q} className="ghost" disabled={busy} onClick={() => send(q)}>{q}</button>)}</div>
        </section>
      )}
      <div className="stack" aria-live="polite">
        {turns.map((t) => t.role === "user"
          ? <div key={t.id} className="bubble me">{t.text}</div>
          : <Answer key={t.id} t={t} />)}
        {busy && <p role="status" className="muted">Thinking…</p>}
        <div ref={end} />
      </div>
      {sendErr && (
        <div role="alert" className="card">
          <p>{sendErr.msg}</p>
          {sendErr.retry && <button onClick={() => send(sendErr.retry!)}>Retry</button>}
        </div>
      )}
      <form className="row composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <input aria-label="Ask the coach" placeholder="Ask about your day, food or training…" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        <button disabled={busy || !text.trim()}>Send</button>
      </form>
      <p className="muted small">AI-generated from your logged data. Not medical advice.</p>
    </>
  );
}

function fromStored(m: StoredMessage): Turn {
  return { id: m.id, role: m.role, text: m.content, reply: m.structured ?? undefined, source: m.source };
}

function Answer({ t }: { t: Turn }) {
  const r = t.reply;
  return (
    <div className={`bubble bot ${r?.safety_flag ? "safety" : ""}`}>
      {t.source === "rules" && t.fallback && <p className="muted small">{FALLBACK_TEXT[t.fallback]}</p>}
      {t.source === "safety" && <p className="muted small">This topic needs a professional, so here is a fixed, safe response.</p>}
      {r?.priority && <strong>{r.priority}</strong>}
      <p>{t.text}</p>
      {r && r.recommendations.length > 0 && <ul>{r.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {t.source === "ai" && <span className="chip">AI</span>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";

type Benchmark = { id: string; statement: string; completed_at?: string | null };
type Step = { id: string; step_text: string; target_date?: string | null; status: string; benchmark_id?: string | null };
type Progress = {
  walk?: { current: number; longest: number };
  semester?: { week: number; totalWeeks: number } | null;
  benchmarks?: Benchmark[];
  actionSteps?: { active: Step[]; completed: Step[]; did_not_happen: Step[] };
};
type Knowledge = { items: string[]; count: number };

function Stat({ value, label, onClick }: { value: string | number; label: string; onClick?: () => void }) {
  const cls = "rounded-2xl border border-line bg-card px-3 py-3 text-center shadow-sm";
  const inner = (
    <>
      <div className="font-display text-2xl font-bold leading-none text-ink2">{value}</div>
      <div className="mt-1 font-data text-[0.56rem] uppercase tracking-[0.1em] text-muted">{label}</div>
    </>
  );
  return onClick ? (
    <button onClick={onClick} className={cls + " transition hover:border-gold"}>{inner}</button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function StepRow({ s, onManage }: { s: Step; onManage: (s: Step) => void }) {
  const overdue = s.target_date && new Date(s.target_date) < new Date();
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-ink2" />
      <div className="flex-1">
        <div className="text-[0.92rem] leading-snug text-ink2">{s.step_text}</div>
        {s.target_date && (
          <div className={"mt-0.5 font-data text-[0.58rem] uppercase tracking-[0.08em] " + (overdue ? "text-[#c0503f]" : "text-muted")}>
            {overdue ? "Past the date you set" : "By " + new Date(s.target_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        )}
      </div>
      <button onClick={() => onManage(s)} aria-label="Manage step" className="flex-none rounded-md px-2 py-1 text-muted transition hover:bg-earl/60 hover:text-ink2">
        {/* pencil */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      </button>
    </div>
  );
}

function StepMenu({ step, onClose, onComplete, onDelete, onEdit }: {
  step: Step; onClose: () => void;
  onComplete: () => void; onDelete: () => void; onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(step.step_text);
  const calUrl = step.target_date
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(step.step_text)}&dates=${cal(step.target_date)}`
    : `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(step.step_text)}`;

  const Item = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
    <button onClick={onClick} className={"w-full rounded-xl border border-line px-4 py-3 text-left font-medium transition hover:border-gold " + (danger ? "text-[#c0503f] hover:border-[#c0503f]" : "text-ink2")}>{label}</button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink2/40 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl border border-line bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="text-[0.95rem] font-medium leading-snug text-ink2">{step.step_text}</div>
          <button onClick={onClose} aria-label="Close" className="flex-none text-xl leading-none text-muted hover:text-ink2">×</button>
        </div>
        {editing ? (
          <div className="space-y-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-[0.9rem] outline-none focus:border-gold" />
            <div className="flex gap-2">
              <button onClick={() => { if (text.trim()) onEdit(text.trim()); }} className="flex-1 rounded-xl bg-gold px-4 py-2.5 font-data text-xs uppercase tracking-[0.08em] text-dark">Save</button>
              <button onClick={() => setEditing(false)} className="rounded-xl border border-line px-4 py-2.5 text-ink2">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Item label="Mark complete" onClick={onComplete} />
            <Item label="Edit" onClick={() => setEditing(true)} />
            <a href={calUrl} target="_blank" rel="noopener noreferrer" onClick={onClose} className="block w-full rounded-xl border border-line px-4 py-3 text-left font-medium text-ink2 transition hover:border-gold">Add to calendar</a>
            <Item label="Delete" onClick={onDelete} danger />
          </div>
        )}
      </div>
    </div>
  );
}

function cal(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, "0"), day = String(d.getUTCDate()).padStart(2, "0");
  const next = new Date(d.getTime() + 86400000);
  const ny = next.getUTCFullYear(), nm = String(next.getUTCMonth() + 1).padStart(2, "0"), nd = String(next.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}/${ny}${nm}${nd}`;
}

function KnowledgeModal({ items, onClose }: { items: string[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink2/40 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="flex max-h-[80dvh] w-full max-w-md flex-col rounded-3xl border border-line bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink2">What Earl knows about you</h2>
          <button onClick={onClose} aria-label="Close" className="text-xl leading-none text-muted hover:text-ink2">×</button>
        </div>
        {items.length === 0 ? (
          <p className="text-muted">As you talk with Earl, what he learns about you shows up here.</p>
        ) : (
          <ul className="space-y-2.5 overflow-y-auto">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[0.92rem] leading-snug text-ink2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-gold" />
                <span>{it}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddStep({ onAdd }: { onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return <button onClick={() => setOpen(true)} className="mt-3 font-data text-[0.6rem] uppercase tracking-[0.08em] text-golddark hover:text-gold">+ Add a step</button>;
  }
  return (
    <div className="mt-3 flex gap-2">
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { if (text.trim()) onAdd(text.trim()); setText(""); setOpen(false); } if (e.key === "Escape") setOpen(false); }}
        placeholder="What will you do?" className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[0.88rem] outline-none focus:border-gold" />
      <button onClick={() => { if (text.trim()) onAdd(text.trim()); setText(""); setOpen(false); }} className="rounded-lg bg-gold px-3 font-data text-[0.62rem] uppercase tracking-[0.08em] text-dark">Add</button>
    </div>
  );
}

export default function ProgressView() {
  const { get, post, del } = useApi();
  const [prog, setProg] = useState<Progress | null>(null);
  const [knowledge, setKnowledge] = useState<Knowledge>({ items: [], count: 0 });
  const [ready, setReady] = useState(false);
  const [menuStep, setMenuStep] = useState<Step | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, k] = await Promise.all([
        get<Progress>("/api/member/progress").catch(() => null),
        get<Knowledge>("/api/member/knowledge").catch(() => ({ items: [], count: 0 })),
      ]);
      if (p) setProg(p);
      if (k) setKnowledge(k);
      setReady(true);
    })();
  }, [get]);

  function setActive(fn: (a: Step[]) => Step[]) {
    setProg((p) => (p ? { ...p, actionSteps: { ...(p.actionSteps || { active: [], completed: [], did_not_happen: [] }), active: fn(p.actionSteps?.active || []) } } : p));
  }
  async function complete(id: string) {
    setMenuStep(null);
    setActive((a) => a.filter((s) => s.id !== id));
    try { await post(`/api/member/action-steps/${id}/complete`, {}); } catch { /* best effort */ }
  }
  async function remove(id: string) {
    if (!confirm("Delete this step? This can't be undone.")) return;
    setMenuStep(null);
    setActive((a) => a.filter((s) => s.id !== id));
    try { await del(`/api/member/action-steps/${id}`); } catch { /* best effort */ }
  }
  async function edit(id: string, text: string) {
    setMenuStep(null);
    setActive((a) => a.map((s) => (s.id === id ? { ...s, step_text: text } : s)));
    try { await post(`/api/member/action-steps/${id}`, { step_text: text }); } catch { /* best effort */ }
  }
  async function add(text: string, benchmark_id: string | null) {
    try {
      const r = await post<{ step?: Step }>("/api/member/action-steps", { step_text: text, benchmark_id });
      if (r.step) setActive((a) => [...a, r.step as Step]);
    } catch { /* best effort */ }
  }

  if (!ready) return <div className="grid flex-1 place-items-center text-muted">Loading…</div>;

  const goals = (prog?.benchmarks || []).filter((b) => !b.completed_at);
  const active = prog?.actionSteps?.active || [];
  const stepsFor = (gid: string) => active.filter((s) => s.benchmark_id === gid);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6">
      <div className="mx-auto max-w-xl space-y-8">
        <div className="grid grid-cols-3 gap-3">
          <Stat value={prog?.walk?.current ?? 0} label="Day walk" />
          <Stat value={prog?.semester ? `${prog.semester.week}/${prog.semester.totalWeeks}` : "—"} label="Week" />
          <Stat value={knowledge.count} label="Earl knows" onClick={() => setKnowledgeOpen(true)} />
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold text-ink2">What you're working toward</h2>
          {goals.length === 0 && <p className="text-muted">No goals set yet. Talk with Earl to name what thriving looks like.</p>}
          <div className="space-y-4">
            {goals.map((b) => {
              const steps = stepsFor(b.id);
              return (
                <div key={b.id} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
                  <h3 className="text-[1.05rem] font-semibold leading-snug text-ink2">{b.statement}</h3>
                  {steps.length > 0 && (
                    <div className="mt-4 space-y-3 border-l-2 border-earl pl-4">
                      {steps.map((s) => <StepRow key={s.id} s={s} onManage={setMenuStep} />)}
                    </div>
                  )}
                  <AddStep onAdd={(t) => add(t, b.id)} />
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {menuStep && (
        <StepMenu
          step={menuStep}
          onClose={() => setMenuStep(null)}
          onComplete={() => complete(menuStep.id)}
          onDelete={() => remove(menuStep.id)}
          onEdit={(t) => edit(menuStep.id, t)}
        />
      )}
      {knowledgeOpen && <KnowledgeModal items={knowledge.items} onClose={() => setKnowledgeOpen(false)} />}
    </div>
  );
}

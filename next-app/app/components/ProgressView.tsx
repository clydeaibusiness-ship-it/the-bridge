"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";

type Benchmark = { id: string; statement: string; completed_at?: string | null };
type Step = { id: string; step_text: string; target_date?: string | null; status: string; benchmark_id?: string | null };
type Progress = {
  walk?: { current: number; longest: number };
  semester?: { week: number; totalWeeks: number } | null;
  knowledgeCount?: number;
  benchmarks?: Benchmark[];
  actionSteps?: { active: Step[]; completed: Step[]; did_not_happen: Step[] };
};

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-3 py-3 text-center shadow-sm">
      <div className="font-display text-2xl font-bold leading-none text-ink2">{value}</div>
      <div className="mt-1 font-data text-[0.56rem] uppercase tracking-[0.1em] text-muted">{label}</div>
    </div>
  );
}

function StepRow({ s, onDone, onDelete }: { s: Step; onDone: (id: string) => void; onDelete: (id: string) => void }) {
  const overdue = s.target_date && new Date(s.target_date) < new Date();
  return (
    <div className="flex items-start gap-2.5">
      <button
        onClick={() => onDone(s.id)}
        aria-label="Mark done"
        title="Mark done"
        className="mt-[3px] h-4 w-4 flex-none rounded-full border-2 border-line transition hover:border-gold hover:bg-gold/25"
      />
      <div className="flex-1">
        <div className="text-[0.92rem] leading-snug text-ink2">{s.step_text}</div>
        {s.target_date && (
          <div className={"mt-0.5 font-data text-[0.58rem] uppercase tracking-[0.08em] " + (overdue ? "text-[#c0503f]" : "text-muted")}>
            {overdue ? "Past the date you set" : "By " + new Date(s.target_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        )}
      </div>
      <button
        onClick={() => onDelete(s.id)}
        aria-label="Delete"
        title="Delete"
        className="flex-none px-1 text-lg leading-none text-muted/50 transition hover:text-[#c0503f]"
      >
        ×
      </button>
    </div>
  );
}

function AddStep({ onAdd }: { onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 font-data text-[0.6rem] uppercase tracking-[0.08em] text-golddark hover:text-gold">
        + Add a step
      </button>
    );
  }
  return (
    <div className="mt-3 flex gap-2">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { if (text.trim()) onAdd(text.trim()); setText(""); setOpen(false); } if (e.key === "Escape") setOpen(false); }}
        placeholder="What will you do?"
        className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[0.88rem] outline-none focus:border-gold"
      />
      <button
        onClick={() => { if (text.trim()) onAdd(text.trim()); setText(""); setOpen(false); }}
        className="rounded-lg bg-gold px-3 font-data text-[0.62rem] uppercase tracking-[0.08em] text-dark"
      >
        Add
      </button>
    </div>
  );
}

export default function ProgressView() {
  const { get, post, del } = useApi();
  const [prog, setProg] = useState<Progress | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try { setProg(await get<Progress>("/api/member/progress")); } catch { /* empty */ }
      setReady(true);
    })();
  }, [get]);

  function setActive(fn: (a: Step[]) => Step[]) {
    setProg((p) => (p ? { ...p, actionSteps: { ...(p.actionSteps || { active: [], completed: [], did_not_happen: [] }), active: fn(p.actionSteps?.active || []) } } : p));
  }

  async function done(id: string) {
    setActive((a) => a.filter((s) => s.id !== id)); // optimistic
    try { await post(`/api/member/action-steps/${id}/complete`, {}); } catch { /* best effort */ }
  }
  async function remove(id: string) {
    if (!confirm("Delete this step?")) return;
    setActive((a) => a.filter((s) => s.id !== id));
    try { await del(`/api/member/action-steps/${id}`); } catch { /* best effort */ }
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
  const completed = prog?.actionSteps?.completed || [];
  const goalIds = new Set(goals.map((g) => g.id));
  const stepsFor = (gid: string) => active.filter((s) => s.benchmark_id === gid);
  const doneFor = (gid: string) => completed.filter((s) => s.benchmark_id === gid).length;
  const ungrouped = active.filter((s) => !s.benchmark_id || !goalIds.has(s.benchmark_id));

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6">
      <div className="mx-auto max-w-xl space-y-8">
        <div className="grid grid-cols-3 gap-3">
          <Stat value={prog?.walk?.current ?? 0} label="Day walk" />
          <Stat value={prog?.semester ? `${prog.semester.week}/${prog.semester.totalWeeks}` : "—"} label="Week" />
          <Stat value={prog?.knowledgeCount ?? 0} label="Earl knows" />
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold text-ink2">What you're working toward</h2>
          {goals.length === 0 && <p className="text-muted">No goals set yet. Talk with Earl to name what thriving looks like.</p>}
          <div className="space-y-4">
            {goals.map((b) => {
              const steps = stepsFor(b.id);
              const doneN = doneFor(b.id);
              return (
                <div key={b.id} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[1.05rem] font-semibold leading-snug text-ink2">{b.statement}</h3>
                    {doneN > 0 && (
                      <span className="flex-none whitespace-nowrap font-data text-[0.58rem] uppercase tracking-[0.08em] text-golddark">{doneN} done</span>
                    )}
                  </div>
                  {steps.length > 0 && (
                    <div className="mt-4 space-y-3 border-l-2 border-earl pl-4">
                      {steps.map((s) => <StepRow key={s.id} s={s} onDone={done} onDelete={remove} />)}
                    </div>
                  )}
                  <AddStep onAdd={(t) => add(t, b.id)} />
                </div>
              );
            })}
          </div>
        </section>

        {ungrouped.length > 0 && (
          <section>
            <h2 className="mb-4 text-xl font-bold text-ink2">Also on your plate</h2>
            <div className="space-y-3 rounded-2xl border border-line bg-card p-5 shadow-sm">
              {ungrouped.map((s) => <StepRow key={s.id} s={s} onDone={done} onDelete={remove} />)}
            </div>
          </section>
        )}

        <p className="text-center font-data text-[0.6rem] uppercase tracking-[0.1em] text-muted">
          Tap the circle to mark a step done. Earl follows up in chat.
        </p>
      </div>
    </div>
  );
}

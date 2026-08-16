"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";

type Benchmark = { id: string; statement: string; starting_rating: number; current_rating: number; completed_at?: string | null };
type Step = { id: string; step_text: string; target_date?: string | null; status: string };
type Progress = {
  walk?: { current: number; longest: number };
  semester?: { week: number; totalWeeks: number } | null;
  knowledgeCount?: number;
  benchmarks?: Benchmark[];
  actionSteps?: { active: Step[]; completed: Step[]; did_not_happen: Step[] };
};

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3 text-center shadow-sm">
      <div className="font-display text-2xl font-bold leading-none text-ink2">{value}</div>
      <div className="mt-1 font-data text-[0.6rem] uppercase tracking-[0.1em] text-muted">{label}</div>
    </div>
  );
}

export default function ProgressView() {
  const { get } = useApi();
  const [data, setData] = useState<Progress | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try { setData(await get<Progress>("/api/member/progress")); } catch { /* empty */ }
      setReady(true);
    })();
  }, [get]);

  if (!ready) return <div className="grid flex-1 place-items-center text-muted">Loading…</div>;

  const goals = (data?.benchmarks || []).filter((b) => !b.completed_at);
  const active = data?.actionSteps?.active || [];
  const completedCount = data?.actionSteps?.completed?.length || 0;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6">
      <div className="mx-auto max-w-xl space-y-8">
        {/* Snapshot */}
        <div className="grid grid-cols-3 gap-3">
          <Stat value={data?.walk?.current ?? 0} label="Day walk" />
          <Stat value={data?.semester ? `${data.semester.week}/${data.semester.totalWeeks}` : "—"} label="Week" />
          <Stat value={data?.knowledgeCount ?? 0} label="Earl knows" />
        </div>

        {/* Goals */}
        <section>
          <h2 className="mb-4 text-xl font-bold text-ink2">What you're working toward</h2>
          {goals.length === 0 && <p className="text-muted">No goals set yet. Talk with Earl to name what thriving looks like.</p>}
          <div className="space-y-4">
            {goals.map((b) => {
              const pct = Math.max(0, Math.min(100, ((b.current_rating || 0) / 10) * 100));
              return (
                <div key={b.id} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
                  <div className="mb-3 text-[0.98rem] font-medium leading-snug text-ink2">{b.statement}</div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-earl">
                    <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between font-data text-[0.62rem] uppercase tracking-[0.08em] text-muted">
                    <span>Started at {b.starting_rating}/10</span>
                    <span>Now {b.current_rating}/10</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Action steps */}
        <section>
          <h2 className="mb-4 text-xl font-bold text-ink2">
            What you're carrying
            {completedCount > 0 && <span className="ml-2 font-data text-[0.62rem] font-normal uppercase tracking-[0.08em] text-golddark">{completedCount} done</span>}
          </h2>
          {active.length === 0 && <p className="text-muted">Nothing open right now.</p>}
          <div className="space-y-3">
            {active.map((s) => {
              const overdue = s.target_date && new Date(s.target_date) < new Date();
              return (
                <div key={s.id} className="flex items-start gap-3 rounded-2xl border border-line bg-card p-4 shadow-sm">
                  <span className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full bg-ink2" />
                  <div className="flex-1">
                    <div className="text-[0.95rem] leading-snug text-ink2">{s.step_text}</div>
                    {s.target_date && (
                      <div className={"mt-1 font-data text-[0.62rem] uppercase tracking-[0.08em] " + (overdue ? "text-[#c0503f]" : "text-muted")}>
                        {overdue ? "Past the date you set" : "By " + new Date(s.target_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

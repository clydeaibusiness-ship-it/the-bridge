"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";

type Benchmark = { id: string; statement: string; starting_rating: number; current_rating: number; completed_at?: string | null };
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

function StepRow({ s }: { s: Step }) {
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
  const goalIds = new Set(goals.map((g) => g.id));
  const stepsFor = (gid: string) => active.filter((s) => s.benchmark_id === gid);
  const ungrouped = active.filter((s) => !s.benchmark_id || !goalIds.has(s.benchmark_id));

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6">
      <div className="mx-auto max-w-xl space-y-8">
        <div className="grid grid-cols-3 gap-3">
          <Stat value={data?.walk?.current ?? 0} label="Day walk" />
          <Stat value={data?.semester ? `${data.semester.week}/${data.semester.totalWeeks}` : "—"} label="Week" />
          <Stat value={data?.knowledgeCount ?? 0} label="Earl knows" />
        </div>

        <section>
          <h2 className="mb-4 text-xl font-bold text-ink2">What you're working toward</h2>
          {goals.length === 0 && <p className="text-muted">No goals set yet. Talk with Earl to name what thriving looks like.</p>}
          <div className="space-y-4">
            {goals.map((b) => {
              const steps = stepsFor(b.id);
              const moved = b.current_rating !== b.starting_rating;
              return (
                <div key={b.id} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[1.05rem] font-semibold leading-snug text-ink2">{b.statement}</h3>
                    <span className="flex-none whitespace-nowrap rounded-full bg-earl px-2.5 py-1 font-data text-[0.6rem] tracking-[0.04em] text-golddark">
                      {b.starting_rating} → {b.current_rating}
                    </span>
                  </div>
                  {steps.length > 0 ? (
                    <div className="mt-4 space-y-3 border-l-2 border-earl pl-4">
                      {steps.map((s) => <StepRow key={s.id} s={s} />)}
                    </div>
                  ) : (
                    <p className="mt-3 text-[0.85rem] text-muted">
                      {moved ? "Moving, no open step right now." : "No open step toward this yet."}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {ungrouped.length > 0 && (
          <section>
            <h2 className="mb-4 text-xl font-bold text-ink2">Also on your plate</h2>
            <div className="space-y-3 rounded-2xl border border-line bg-card p-5 shadow-sm">
              {ungrouped.map((s) => <StepRow key={s.id} s={s} />)}
            </div>
          </section>
        )}

        {completedCount > 0 && (
          <p className="text-center font-data text-[0.62rem] uppercase tracking-[0.1em] text-golddark">
            {completedCount} step{completedCount === 1 ? "" : "s"} completed so far
          </p>
        )}
      </div>
    </div>
  );
}

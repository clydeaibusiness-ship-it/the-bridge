"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";

type Section = { title: string; body: string };
type IntakeResp = { session?: { chartSections?: Section[] | string | null } | null };

export default function ChartView() {
  const { get } = useApi();
  const [sections, setSections] = useState<Section[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await get<IntakeResp>("/api/intake/data");
        let cs = data?.session?.chartSections ?? [];
        if (typeof cs === "string") { try { cs = JSON.parse(cs); } catch { cs = []; } }
        setSections(Array.isArray(cs) ? cs : []);
      } catch { /* empty */ }
      setReady(true);
    })();
  }, [get]);

  if (!ready) return <div className="grid flex-1 place-items-center text-muted">Loading…</div>;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6">
      <div className="mx-auto max-w-xl">
        <h2 className="mb-1 text-xl font-bold text-ink2">Your Navigation Chart</h2>
        <p className="mb-6 text-muted">Earl's strategic read of your business.</p>
        {sections.length === 0 ? (
          <p className="text-muted">Your chart isn't ready yet. Finish the interview with Earl and it appears here.</p>
        ) : (
          <div className="space-y-4">
            {sections.map((s, i) => (
              <div key={i} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
                <div className="mb-2 font-data text-[0.62rem] uppercase tracking-[0.14em] text-golddark">{s.title}</div>
                <p className="text-[0.98rem] leading-relaxed text-ink/85">{s.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

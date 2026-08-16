"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/useApi";

type Section = { title: string; body: string };
type IntakeResp = { session?: { chartSections?: Section[] | string | null; chartUpdatedAt?: string | null } | null };
type RefreshResp = { sections?: Section[]; updatedAt?: string };

const STALE_MS = 7 * 24 * 60 * 60 * 1000; // redraw itself after a week

function ago(iso?: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "updated today";
  if (days === 1) return "updated yesterday";
  if (days < 14) return `updated ${days} days ago`;
  if (days < 60) return `updated ${Math.round(days / 7)} weeks ago`;
  return `updated ${Math.round(days / 30)} months ago`;
}

export default function ChartView() {
  const { get, post } = useApi();
  const [sections, setSections] = useState<Section[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const didAuto = useRef(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await post<RefreshResp>("/api/member/chart/refresh", {});
      if (r.sections?.length) { setSections(r.sections); setUpdatedAt(r.updatedAt || new Date().toISOString()); }
    } catch { /* keep what we have */ }
    setRefreshing(false);
  }, [post]);

  useEffect(() => {
    (async () => {
      try {
        const data = await get<IntakeResp>("/api/intake/data");
        let cs = data?.session?.chartSections ?? [];
        if (typeof cs === "string") { try { cs = JSON.parse(cs); } catch { cs = []; } }
        const arr = Array.isArray(cs) ? cs : [];
        setSections(arr);
        const u = data?.session?.chartUpdatedAt ?? null;
        setUpdatedAt(u);
        // Evolve on its own: if there's a chart and it's over a week old, redraw
        // it from the member's current context in the background.
        if (!didAuto.current && arr.length > 0 && (!u || Date.now() - new Date(u).getTime() > STALE_MS)) {
          didAuto.current = true;
          refresh();
        }
      } catch { /* empty */ }
      setReady(true);
    })();
  }, [get, refresh]);

  if (!ready) return <div className="grid flex-1 place-items-center text-muted">Loading…</div>;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink2">Your Navigation Chart</h2>
            <p className="text-muted">
              Earl's read of your business{updatedAt ? `, ${ago(updatedAt)}` : ""}.
            </p>
          </div>
          {sections.length > 0 && (
            <button
              onClick={refresh}
              disabled={refreshing}
              className="flex-none rounded-full border border-line px-3 py-1.5 font-data text-[0.6rem] uppercase tracking-[0.08em] text-golddark transition hover:border-gold disabled:opacity-50"
            >
              {refreshing ? "Redrawing…" : "Refresh"}
            </button>
          )}
        </div>

        {refreshing && sections.length === 0 ? (
          <p className="text-muted">Earl is drawing your chart…</p>
        ) : sections.length === 0 ? (
          <p className="text-muted">Your chart isn't ready yet. Finish the interview with Earl and it appears here.</p>
        ) : (
          <div className={"space-y-4 transition-opacity " + (refreshing ? "opacity-50" : "opacity-100")}>
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

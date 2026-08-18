"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/useApi";

type Section = { title: string; body: string };
type Financials = {
  revenue: number | null;
  expenses: number | null;
  cash: number | null;
  debt: number | null;
  updatedAt: string | null;
};
type IntakeResp = {
  session?: {
    chartSections?: Section[] | string | null;
    chartUpdatedAt?: string | null;
    financials?: Financials | null;
    financialsRemark?: string | null;
  } | null;
};
type RefreshResp = { sections?: Section[]; updatedAt?: string };
type SaveFinResp = { financials?: Financials; remark?: string };

const STALE_MS = 7 * 24 * 60 * 60 * 1000; // redraw itself after a week

const FIELDS: { key: keyof Omit<Financials, "updatedAt">; label: string }[] = [
  { key: "revenue", label: "Monthly income" },
  { key: "expenses", label: "Monthly expenses" },
  { key: "cash", label: "Cash on hand" },
  { key: "debt", label: "Debt owed" },
];

const EMPTY: Financials = { revenue: null, expenses: null, cash: null, debt: null, updatedAt: null };

function ago(iso?: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "updated today";
  if (days === 1) return "updated yesterday";
  if (days < 14) return `updated ${days} days ago`;
  if (days < 60) return `updated ${Math.round(days / 7)} weeks ago`;
  return `updated ${Math.round(days / 30)} months ago`;
}

function money(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** The pinned "Your Numbers" block: friendly, inline-editable, one remark below. */
function YourNumbers() {
  const { get, post } = useApi();
  const [fin, setFin] = useState<Financials>(EMPTY);
  const [remark, setRemark] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const data = await get<IntakeResp>("/api/intake/data");
        setFin(data?.session?.financials || EMPTY);
        setRemark(data?.session?.financialsRemark || "");
      } catch {
        /* leave empty */
      }
      setReady(true);
    })();
  }, [get]);

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = fin[f.key];
      d[f.key] = v === null || v === undefined ? "" : String(v);
    }
    setDraft(d);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      for (const f of FIELDS) body[f.key] = draft[f.key] ?? "";
      const r = await post<SaveFinResp>("/api/member/financials", body);
      if (r.financials) setFin(r.financials);
      if (typeof r.remark === "string") setRemark(r.remark);
      setEditing(false);
    } catch {
      /* keep editing so nothing is lost */
    }
    setSaving(false);
  };

  if (!ready) return null;

  return (
    <div className="mb-4 rounded-2xl border border-gold/40 bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-data text-[0.62rem] uppercase tracking-[0.14em] text-golddark">Your Numbers</div>
        {!editing && (
          <button
            onClick={startEdit}
            aria-label="Edit your numbers"
            className="flex-none rounded-full border border-line px-3 py-1 font-data text-[0.58rem] uppercase tracking-[0.08em] text-golddark transition hover:border-gold"
          >
            {fin.updatedAt ? "Edit" : "Add"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2.5">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 text-[0.95rem] text-ink/85">
              <span>{f.label}</span>
              <span className="flex items-center gap-1">
                <span className="text-muted">$</span>
                <input
                  inputMode="numeric"
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  placeholder="—"
                  className="w-28 rounded-lg border border-line bg-bg px-2 py-1 text-right text-ink focus:border-gold focus:outline-none"
                />
              </span>
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-full bg-gold px-4 py-1.5 font-data text-[0.6rem] uppercase tracking-[0.08em] text-ink transition hover:brightness-105 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-full border border-line px-4 py-1.5 font-data text-[0.6rem] uppercase tracking-[0.08em] text-muted transition hover:border-gold disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-3 text-[0.95rem]">
              <span className="text-ink/70">{f.label}</span>
              <span className="font-data text-ink">{money(fin[f.key])}</span>
            </div>
          ))}
        </div>
      )}

      {remark && !editing && (
        <p className="mt-3 border-t border-line pt-3 text-[0.92rem] leading-relaxed text-ink/85">{remark}</p>
      )}
    </div>
  );
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
        {/* Your Numbers, pinned at the very top */}
        <YourNumbers />

        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink2">Status Report</h2>
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
          <p className="text-muted">Earl is drawing your read…</p>
        ) : sections.length === 0 ? (
          <p className="text-muted">Your read isn't ready yet. Finish the interview with Earl and it appears here.</p>
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

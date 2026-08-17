"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";
import AppShell from "./AppShell";
import InterviewFlow from "./InterviewFlow";

type StateResp = { done?: boolean; paywall?: boolean; question?: { field: string } | null };
type ProgResp = { benchmarks?: unknown[] };

// Decides what a signed-in member sees: the onboarding interview (new users with
// an unanswered question or sitting at the paywall) or the app itself
// (established members). An established member — anyone who already has goals —
// ALWAYS gets the app, so the interview can never trap someone who's onboarded.
// Fails open to the app.
export default function Gate() {
  const { get } = useApi();
  const [view, setView] = useState<"loading" | "app" | "interview">("loading");

  useEffect(() => {
    (async () => {
      try {
        const [s, prog] = await Promise.all([
          get<StateResp>("/api/member/interview/state"),
          get<ProgResp>("/api/member/progress").catch(() => ({} as ProgResp)),
        ]);
        const established = (prog?.benchmarks?.length || 0) > 0;
        if (!established && !s.done && (s.question || s.paywall)) setView("interview");
        else setView("app");
      } catch {
        setView("app");
      }
    })();
  }, [get]);

  if (view === "loading") return <div className="grid min-h-[100dvh] place-items-center text-muted">Loading…</div>;
  if (view === "interview") return <InterviewFlow onComplete={() => setView("app")} />;
  return <AppShell />;
}

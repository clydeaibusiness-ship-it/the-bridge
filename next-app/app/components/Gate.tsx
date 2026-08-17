"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";
import AppShell from "./AppShell";
import InterviewFlow from "./InterviewFlow";

type StateResp = { done?: boolean; paywall?: boolean; question?: { field: string } | null };

// Decides what a signed-in member sees: the onboarding interview (new users with
// an unanswered question or sitting at the paywall) or the app itself
// (established members). Fails open to the app so nobody gets trapped.
export default function Gate() {
  const { get } = useApi();
  const [view, setView] = useState<"loading" | "app" | "interview">("loading");

  useEffect(() => {
    (async () => {
      try {
        const s = await get<StateResp>("/api/member/interview/state");
        if (!s.done && (s.question || s.paywall)) setView("interview");
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

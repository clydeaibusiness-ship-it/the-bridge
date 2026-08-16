"use client";

import Image from "next/image";
import { useState } from "react";
import EarlChat from "./EarlChat";
import ProgressView from "./ProgressView";
import ChartView from "./ChartView";
import SettingsSheet from "./SettingsSheet";

type Tab = "chart" | "earl" | "progress";
const TABS: { id: Tab; label: string }[] = [
  { id: "chart", label: "Chart" },
  { id: "earl", label: "Earl" },
  { id: "progress", label: "Progress" },
];

export default function AppShell() {
  const [tab, setTab] = useState<Tab>("earl");
  const [settings, setSettings] = useState(false);

  return (
    <div className="mx-auto flex h-[100dvh] max-w-2xl flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button onClick={() => setSettings(true)} aria-label="Settings" className="flex-none rounded-full transition hover:ring-2 hover:ring-gold/50">
            <Image src="/assets/earl.png" alt="Earl" width={36} height={36} className="h-9 w-9 rounded-full border border-line object-cover object-top" />
          </button>
          <nav className="mx-auto flex rounded-full border border-line bg-card p-1 font-data text-[0.68rem] uppercase tracking-[0.08em]">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "rounded-full px-5 py-1.5 transition " +
                  (tab === t.id ? "bg-ink2 text-bg" : "text-muted hover:text-ink2")
                }
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="w-9 flex-none" aria-hidden />
        </div>
      </header>

      {tab === "earl" && <EarlChat />}
      {tab === "progress" && <ProgressView />}
      {tab === "chart" && <ChartView />}

      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  );
}

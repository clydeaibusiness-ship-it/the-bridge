"use client";

import { useEffect, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { useApi } from "@/lib/useApi";
import { enablePush, pushState } from "@/lib/push";

export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const { get, post } = useApi();
  const email = user?.primaryEmailAddress?.emailAddress || "";

  const [notif, setNotif] = useState<"on" | "off" | "denied" | "unsupported" | "working">("off");
  useEffect(() => { setNotif(pushState()); }, []);

  async function turnOnNotifications() {
    setNotif("working");
    const result = await enablePush(
      () => get<{ key: string }>("/api/member/push/vapid-public-key").then((r) => r.key),
      (sub) => post("/api/member/push/subscribe", { subscription: sub }).then(() => undefined)
    );
    setNotif(result === "on" ? "on" : result === "denied" ? "denied" : result === "unsupported" ? "unsupported" : "off");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink2/40 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-line bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink2">Settings</h2>
            {email && <p className="text-xs text-muted">{email}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-xl leading-none text-muted transition hover:text-ink2">×</button>
        </div>

        <div className="space-y-2">
          {notif === "on" ? (
            <div className="rounded-xl border border-line bg-earl/40 px-4 py-3">
              <div className="font-medium text-ink2">Notifications on</div>
              <div className="text-xs text-muted">Turn them off in your phone's settings.</div>
            </div>
          ) : notif === "denied" ? (
            <div className="rounded-xl border border-line px-4 py-3">
              <div className="font-medium text-ink2">Notifications blocked</div>
              <div className="text-xs text-muted">Allow them for this site in your phone's settings.</div>
            </div>
          ) : notif === "unsupported" ? null : (
            <button
              onClick={turnOnNotifications}
              disabled={notif === "working"}
              className="w-full rounded-xl border border-line px-4 py-3 text-left transition hover:border-gold disabled:opacity-60"
            >
              <div className="font-medium text-ink2">{notif === "working" ? "Turning on…" : "Turn on notifications"}</div>
              <div className="text-xs text-muted">Earl reaches out with a morning line.</div>
            </button>
          )}

          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-xl border border-line px-4 py-3 text-left transition hover:border-gold"
          >
            <div className="font-medium text-ink2">Refresh app</div>
            <div className="text-xs text-muted">Reload to pull the latest.</div>
          </button>

          <button
            onClick={() => signOut({ redirectUrl: window.location.origin + "/" })}
            className="w-full rounded-xl border border-line px-4 py-3 text-left transition hover:border-[#c0503f]"
          >
            <div className="font-medium text-ink2">Sign out</div>
            <div className="text-xs text-muted">You'll sign back in to return.</div>
          </button>
        </div>
      </div>
    </div>
  );
}

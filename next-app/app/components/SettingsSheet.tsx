"use client";

import { useClerk, useUser } from "@clerk/nextjs";

export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress || "";

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

        <p className="mt-4 text-center font-data text-[0.58rem] uppercase tracking-[0.1em] text-muted">
          Notifications live in your phone's settings
        </p>
      </div>
    </div>
  );
}

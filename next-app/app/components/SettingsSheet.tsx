"use client";

import { useEffect, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { useApi } from "@/lib/useApi";
import { enablePush, pushState } from "@/lib/push";

type MemberImage = { id: string; url: string | null; createdAt: string };

export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const { get, post, del } = useApi();
  const email = user?.primaryEmailAddress?.emailAddress || "";

  const [notif, setNotif] = useState<"on" | "off" | "denied" | "unsupported" | "working">("off");
  useEffect(() => { setNotif(pushState()); }, []);

  const [view, setView] = useState<"main" | "images">("main");
  const [images, setImages] = useState<MemberImage[]>([]);
  const [imagesReady, setImagesReady] = useState(false);

  async function openImages() {
    setView("images");
    setImagesReady(false);
    try {
      const r = await get<{ images: MemberImage[] }>("/api/member/images");
      setImages(r.images || []);
    } catch {
      setImages([]);
    }
    setImagesReady(true);
  }

  async function removeImage(id: string) {
    setImages((cur) => cur.filter((im) => im.id !== id)); // optimistic
    try {
      await del(`/api/member/images/${id}`);
    } catch {
      openImages(); // reload the true state if it failed
    }
  }

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
          <div className="flex items-center gap-2">
            {view === "images" && (
              <button onClick={() => setView("main")} aria-label="Back" className="text-lg leading-none text-muted transition hover:text-ink2">‹</button>
            )}
            <div>
              <h2 className="text-lg font-bold text-ink2">{view === "images" ? "Your uploads" : "Settings"}</h2>
              {view === "main" && email && <p className="text-xs text-muted">{email}</p>}
              {view === "images" && <p className="text-xs text-muted">Photos you've shared with Earl.</p>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-xl leading-none text-muted transition hover:text-ink2">×</button>
        </div>

        {view === "images" ? (
          <div className="max-h-[60vh] overflow-y-auto">
            {!imagesReady ? (
              <p className="py-8 text-center text-muted">Loading…</p>
            ) : images.length === 0 ? (
              <p className="py-8 text-center text-muted">No uploads yet. Share a photo in your chat with Earl.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {images.map((im) => (
                  <div key={im.id} className="group relative overflow-hidden rounded-xl border border-line">
                    {im.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={im.url} alt="upload" className="aspect-square w-full object-cover" />
                    )}
                    <button
                      onClick={() => removeImage(im.id)}
                      aria-label="Delete image"
                      className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-ink2/70 text-sm leading-none text-white transition hover:bg-[#c0503f]"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
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
            onClick={openImages}
            className="w-full rounded-xl border border-line px-4 py-3 text-left transition hover:border-gold"
          >
            <div className="font-medium text-ink2">Your uploads</div>
            <div className="text-xs text-muted">See and manage photos you've shared with Earl.</div>
          </button>

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
        )}
      </div>
    </div>
  );
}

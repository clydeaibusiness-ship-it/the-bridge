"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/useApi";

type Suggestion = { revenue?: number; expenses?: number; cash?: number; debt?: number; label?: string };
type Msg = { role: "user" | "earl" | "suggest"; text?: string; image?: string; suggestion?: Suggestion };
type HistoryResp = { messages?: { role: string; content: string }[]; preConversation?: string | null; historyError?: boolean };
type SendResp = { response?: string; financialSuggestion?: Suggestion | null };

type Pending = { dataUrl: string; base64: string; media_type: string };

const SUG_LABELS: { key: keyof Suggestion; label: string }[] = [
  { key: "revenue", label: "Monthly income" },
  { key: "expenses", label: "Monthly expenses" },
  { key: "cash", label: "Cash on hand" },
  { key: "debt", label: "Debt owed" },
];

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
function hasNumber(s: Suggestion): boolean {
  return (["revenue", "expenses", "cash", "debt"] as (keyof Suggestion)[]).some((k) => typeof s[k] === "number");
}

/** Downscale + re-encode to JPEG in the browser so uploads stay small and cheap. */
async function toDownscaledJpeg(file: File, maxDim = 1600, quality = 0.82): Promise<Pending> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  let { width, height } = img;
  if (Math.max(width, height) > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(img, 0, 0, width, height);
  const out = canvas.toDataURL("image/jpeg", quality);
  return { dataUrl: out, base64: out.split(",")[1] || "", media_type: "image/jpeg" };
}

export default function EarlChat() {
  const { get, post } = useApi();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pre, setPre] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    setReady(false);
    try {
      const data = await get<HistoryResp>("/api/member/commander/history");
      // A real failure to load history is surfaced, not silently shown as an
      // empty chat (which reads as if the whole conversation vanished).
      if (data.historyError) {
        setLoadError(true);
      } else {
        setMessages(
          (data.messages || []).map((m) => ({
            role: m.role === "user" ? "user" : "earl",
            text: m.content,
          }))
        );
        setPre(data.preConversation || null);
      }
    } catch {
      setLoadError(true);
    }
    setReady(true);
  }, [get]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    try {
      setPending(await toDownscaledJpeg(file));
    } catch {
      /* ignore a bad image */
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && !pending) || sending) return;
    const img = pending;
    setInput("");
    setPending(null);
    setMessages((m) => [...m, { role: "user", text: text || undefined, image: img?.dataUrl }]);
    setSending(true);
    try {
      const body: { message: string; image?: { data: string; media_type: string } } = { message: text };
      if (img) body.image = { data: img.base64, media_type: img.media_type };
      const data = await post<SendResp>("/api/member/commander/message", body);
      setMessages((m) => [...m, { role: "earl", text: data.response || "" }]);
      if (data.financialSuggestion && hasNumber(data.financialSuggestion)) {
        setMessages((m) => [...m, { role: "suggest", suggestion: data.financialSuggestion! }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "earl", text: "Earl is temporarily unavailable. Try again shortly." }]);
    } finally {
      setSending(false);
    }
  }

  async function accept(idx: number, s: Suggestion) {
    try {
      await post("/api/member/financials", {
        revenue: s.revenue,
        expenses: s.expenses,
        cash: s.cash,
        debt: s.debt,
        merge: true,
      });
      setMessages((m) => m.map((msg, i) => (i === idx ? { role: "earl", text: "Added to Your Numbers." } : msg)));
    } catch {
      setMessages((m) => m.map((msg, i) => (i === idx ? { role: "earl", text: "I couldn't save that just now." } : msg)));
    }
  }
  function decline(idx: number) {
    setMessages((m) => m.map((msg, i) => (i === idx ? { role: "earl", text: "No problem. I left your numbers as they are." } : msg)));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-6">
        {ready && loadError && (
          <div className="m-auto max-w-sm text-center">
            <h2 className="mb-2 text-xl font-bold text-ink2">Couldn't load your history.</h2>
            <p className="mb-4 text-muted">Your conversation is safe. This is just a hiccup reaching it.</p>
            <button
              onClick={load}
              className="rounded-xl bg-gold px-6 py-2.5 font-data text-xs uppercase tracking-[0.08em] text-dark transition hover:bg-golddark"
            >
              Retry
            </button>
          </div>
        )}
        {ready && !loadError && messages.length === 0 && (
          <div className="m-auto max-w-sm text-center">
            <h2 className="mb-2 text-2xl font-bold text-ink2">Good to see you.</h2>
            <p className="text-muted">Tell Earl what is on your mind, or share a photo of something you are looking at.</p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "suggest" && m.suggestion ? (
            <div key={i} className="max-w-[82%] self-start rounded-2xl rounded-bl-sm border border-gold/50 bg-card px-4 py-3">
              <div className="mb-2 font-data text-[0.58rem] uppercase tracking-[0.12em] text-golddark">
                Add to Your Numbers{m.suggestion.label ? ` · ${m.suggestion.label}` : ""}?
              </div>
              <div className="mb-3 space-y-1">
                {SUG_LABELS.filter((f) => typeof m.suggestion![f.key] === "number").map((f) => (
                  <div key={f.key} className="flex justify-between gap-4 text-[0.9rem]">
                    <span className="text-ink/70">{f.label}</span>
                    <span className="font-data text-ink">{money(m.suggestion![f.key] as number)}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => accept(i, m.suggestion!)}
                  className="rounded-full bg-gold px-4 py-1.5 font-data text-[0.58rem] uppercase tracking-[0.08em] text-dark transition hover:bg-golddark"
                >
                  Add
                </button>
                <button
                  onClick={() => decline(i)}
                  className="rounded-full border border-line px-4 py-1.5 font-data text-[0.58rem] uppercase tracking-[0.08em] text-muted transition hover:border-gold"
                >
                  Not now
                </button>
              </div>
            </div>
          ) : (
            <div
              key={i}
              className={
                "max-w-[82%] overflow-hidden whitespace-pre-wrap rounded-2xl text-[0.95rem] leading-relaxed " +
                (m.role === "user"
                  ? "self-end rounded-br-sm bg-gold text-dark"
                  : "self-start rounded-bl-sm bg-earl text-ink")
              }
            >
              {m.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.image} alt="shared" className="block max-h-64 w-full object-cover" />
              )}
              {m.text && <div className="px-4 py-3">{m.text}</div>}
            </div>
          )
        )}
        {pre && !sending && (
          <div className="mx-auto max-w-md px-2 py-2 text-center text-[0.85rem] italic leading-relaxed text-golddark">
            Last time, this was left open: {pre}
          </div>
        )}
        {sending && (
          <div className="max-w-[82%] self-start rounded-2xl rounded-bl-sm bg-earl px-4 py-3 text-[0.95rem] italic text-muted">
            Earl is thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 border-t border-line bg-bg/90 px-5 py-3 backdrop-blur">
        {pending && (
          <div className="mb-2 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pending.dataUrl} alt="attachment" className="h-14 w-14 rounded-lg border border-line object-cover" />
            <button onClick={() => setPending(null)} className="font-data text-[0.6rem] uppercase tracking-[0.08em] text-muted transition hover:text-ink2">
              Remove
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Add a photo"
            className="flex-none rounded-xl border border-line bg-card px-3 py-3 text-lg leading-none text-golddark transition hover:border-gold"
          >
            +
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="flex-1 rounded-xl border border-line bg-card px-4 py-3 text-[0.95rem] outline-none focus:border-gold"
            placeholder="Tell Earl what's on your mind…"
          />
          <button
            onClick={send}
            disabled={sending}
            className="rounded-xl bg-gold px-5 py-3 font-data text-xs uppercase tracking-[0.08em] text-dark transition hover:bg-golddark disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

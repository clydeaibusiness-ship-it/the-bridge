"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/useApi";

type Q = { n: number; field: string; text: string };
type StateResp = {
  done?: boolean;
  paywall?: boolean;
  stage?: number;
  framing?: string | null;
  question?: Q | null;
};
type AnswerResp = {
  followUp?: string;
  paywall?: boolean;
  done?: boolean;
  stageComplete?: string | null;
  framing?: string | null;
  stage?: number;
  question?: Q | null;
};
type Turn = { role: "earl" | "you"; text: string };

const SUBSCRIBE_URL =
  process.env.NEXT_PUBLIC_SUBSCRIBE_URL || "https://captainsbridge.io/login?action=subscribe";

export default function InterviewFlow({ onComplete }: { onComplete: () => void }) {
  const { get, post } = useApi();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [field, setField] = useState<string | null>(null);
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [firstRead, setFirstRead] = useState<string>("");
  const endRef = useRef<HTMLDivElement>(null);

  const pushEarl = (text?: string | null) => { if (text) setTurns((t) => [...t, { role: "earl", text }]); };

  // Present a question (with its stage framing) and arm the input for its field.
  function present(s: { framing?: string | null; question?: Q | null }) {
    pushEarl(s.framing);
    if (s.question) { pushEarl(s.question.text); setField(s.question.field); setIsFollowUp(false); }
  }

  async function toPaywall() {
    setPaywall(true);
    try { const r = await get<{ read?: string }>("/api/member/first-read"); setFirstRead(r.read || ""); }
    catch { setFirstRead(""); }
  }

  useEffect(() => {
    (async () => {
      try {
        const s = await get<StateResp>("/api/member/interview/state");
        if (s.done) { onComplete(); return; }
        if (s.paywall) { await toPaywall(); }
        else { present(s); }
      } catch { /* fail open below */ }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  async function submit() {
    const answer = input.trim();
    if (!answer || busy || !field) return;
    setInput("");
    setTurns((t) => [...t, { role: "you", text: answer }]);
    setBusy(true);
    try {
      const r = await post<AnswerResp>("/api/member/interview/answer", { field, answer, isFollowUp, round: 1 });
      if (r.followUp) { pushEarl(r.followUp); setIsFollowUp(true); }
      else if (r.paywall) { pushEarl(r.stageComplete); await toPaywall(); }
      else if (r.done) { onComplete(); }
      else { pushEarl(r.stageComplete); present(r); }
    } catch {
      pushEarl("Something went wrong saving that. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <div className="grid min-h-[100dvh] place-items-center text-muted">Loading…</div>;

  if (paywall) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col justify-center px-6 py-10 text-center">
        <Image src="/assets/earl.png" alt="Earl" width={72} height={72} className="mx-auto mb-5 h-18 w-18 rounded-full border border-line object-cover object-top" />
        <div className="mb-2 font-data text-[0.6rem] uppercase tracking-[0.16em] text-golddark">Earl's first read</div>
        <p className="mb-8 text-fluid-lg leading-relaxed text-ink2">{firstRead || "Earl is forming his read…"}</p>
        <a href={SUBSCRIBE_URL} className="mx-auto inline-block rounded-xl bg-gold px-8 py-4 font-data text-sm tracking-[0.06em] text-dark shadow-lg shadow-gold/25 transition hover:-translate-y-0.5 hover:bg-golddark">
          Get access
        </a>
        <p className="mt-4 font-data text-[0.62rem] uppercase tracking-[0.06em] text-muted">One price. Six months. Full access.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[100dvh] max-w-xl flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Image src="/assets/earl.png" alt="Earl" width={36} height={36} className="h-9 w-9 rounded-full border border-line object-cover object-top" />
        <div>
          <div className="font-data text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink2">Earl</div>
          <div className="text-xs text-muted">Getting to know your business</div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-6">
        {turns.map((t, i) => (
          <div
            key={i}
            className={
              "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[0.95rem] leading-relaxed " +
              (t.role === "you" ? "self-end rounded-br-sm bg-gold text-dark" : "self-start rounded-bl-sm bg-earl text-ink")
            }
          >
            {t.text}
          </div>
        ))}
        {busy && <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-earl px-4 py-3 text-[0.95rem] italic text-muted">…</div>}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 flex gap-2 border-t border-line bg-bg/90 px-5 py-3 backdrop-blur">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={1}
          className="min-h-[46px] flex-1 resize-none rounded-xl border border-line bg-card px-4 py-3 text-[0.95rem] outline-none focus:border-gold"
          placeholder="Type your answer…"
        />
        <button onClick={submit} disabled={busy} className="rounded-xl bg-gold px-5 font-data text-xs uppercase tracking-[0.08em] text-dark transition hover:bg-golddark disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}

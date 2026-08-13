"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

type Msg = { role: "user" | "earl"; text: string };
type HistoryResp = { messages?: { message_role: string; message_content: string }[] };
type SendResp = { response?: string };

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiGet<HistoryResp>("/api/member/commander/history");
        setMessages(
          (data.messages || []).map((m) => ({
            role: m.message_role === "user" ? "user" : "earl",
            text: m.message_content,
          }))
        );
      } catch {
        /* not signed in or API unreachable — show the empty state */
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setSending(true);
    try {
      const data = await apiPost<SendResp>("/api/member/commander/message", { message: text });
      setMessages((m) => [...m, { role: "earl", text: data.response || "" }]);
    } catch {
      setMessages((m) => [...m, { role: "earl", text: "Earl is temporarily unavailable. Try again shortly." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur">
        <Image src="/assets/earl.png" alt="Earl" width={40} height={40} className="h-10 w-10 rounded-full border border-line object-cover object-top" />
        <div className="flex-1">
          <div className="font-data text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink2">Earl</div>
          <div className="text-xs text-muted">Knows your business</div>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-5 py-6">
        {ready && messages.length === 0 && (
          <div className="m-auto max-w-sm text-center">
            <h1 className="mb-2 text-2xl font-bold text-ink2">Good to see you.</h1>
            <p className="text-muted">Tell Earl what is on your mind, or the one call weighing on you most today.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              "max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[0.95rem] leading-relaxed " +
              (m.role === "user"
                ? "self-end rounded-br-sm bg-gold text-dark"
                : "self-start rounded-bl-sm bg-earl text-ink")
            }
          >
            {m.text}
          </div>
        ))}
        {sending && (
          <div className="max-w-[82%] self-start rounded-2xl rounded-bl-sm bg-earl px-4 py-3 text-[0.95rem] italic text-muted">
            Earl is thinking…
          </div>
        )}
        <div ref={endRef} />
      </main>

      <footer className="sticky bottom-0 flex gap-2 border-t border-line bg-bg/90 px-5 py-3 backdrop-blur">
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
          className="rounded-xl bg-gold px-5 font-data text-xs uppercase tracking-[0.08em] text-dark transition hover:bg-golddark disabled:opacity-50"
        >
          Send
        </button>
      </footer>
    </div>
  );
}

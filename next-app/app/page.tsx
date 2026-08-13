import Image from "next/image";

// Phase 3 foundation: a static, brand-styled version of the app's chat shell.
// Proves the Next.js + Tailwind v4 + brand stack renders. Real data, Clerk auth,
// and interactivity come next, screen by screen, reusing the Express API.

const thread = [
  { from: "earl", text: "Morning. You said the endocrinologist lead was settled, so I've let that go. What's the one call weighing on you most today?" },
  { from: "you", text: "Cash. We look profitable but we're always short at the end of the month." },
  { from: "earl", text: "Then we start with the gap between what you bill and what you bank. Before we touch pricing, walk me through what actually happens between a job finishing and the money landing." },
];

export default function Page() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur">
        <Image src="/assets/earl.png" alt="Earl" width={40} height={40} className="h-10 w-10 rounded-full border border-line object-cover object-top" />
        <div className="flex-1">
          <div className="font-data text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink2">Earl</div>
          <div className="text-xs text-muted">Knows your business</div>
        </div>
        <span className="rounded-full bg-earl px-3 py-1 font-data text-[0.6rem] uppercase tracking-[0.1em] text-golddark">12 day walk</span>
      </header>

      {/* Thread */}
      <main className="flex flex-1 flex-col gap-4 px-5 py-6">
        {thread.map((m, i) => (
          <div
            key={i}
            className={
              "max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[0.95rem] leading-relaxed " +
              (m.from === "you"
                ? "self-end rounded-br-sm bg-gold text-dark"
                : "self-start rounded-bl-sm bg-earl text-ink")
            }
          >
            {m.text}
          </div>
        ))}
      </main>

      {/* Composer */}
      <footer className="sticky bottom-0 flex gap-2 border-t border-line bg-bg/90 px-5 py-3 backdrop-blur">
        <input
          className="flex-1 rounded-xl border border-line bg-card px-4 py-3 text-[0.95rem] outline-none focus:border-gold"
          placeholder="Tell Earl what's on your mind…"
        />
        <button className="rounded-xl bg-gold px-5 font-data text-xs uppercase tracking-[0.08em] text-dark transition hover:bg-golddark">
          Send
        </button>
      </footer>
    </div>
  );
}

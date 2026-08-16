"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import AppShell from "./components/AppShell";

export default function Page() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return <div className="grid min-h-screen place-items-center text-muted">Loading…</div>;
  }
  return isSignedIn ? <AppShell /> : <SignInPrompt />;
}

function SignInPrompt() {
  const base = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in";
  const [href, setHref] = useState(base);
  useEffect(() => {
    setHref(`${base}?redirect_url=${encodeURIComponent(window.location.origin + "/")}`);
  }, [base]);
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div className="max-w-sm">
        <Image src="/assets/earl.png" alt="Earl" width={88} height={88} className="mx-auto mb-5 h-20 w-20 rounded-full border border-line object-cover object-top" />
        <h1 className="mb-2 text-2xl font-bold text-ink2">Welcome back.</h1>
        <p className="mb-6 text-muted">Sign in and pick up where you left off.</p>
        <a href={href} className="inline-block rounded-xl bg-gold px-7 py-3 font-data text-xs uppercase tracking-[0.08em] text-dark transition hover:bg-golddark">
          Sign in
        </a>
      </div>
    </div>
  );
}

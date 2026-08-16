import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Earl",
  description: "Your AI business mentor.",
};

// Fonts load via a stylesheet link (Playfair Display, Epilogue, Space Mono), so
// the build never depends on a network fetch. ClerkProvider reads its config
// from env (publishable key + the subdomain sign-in URLs). See .env.example.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Epilogue:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap"
            rel="stylesheet"
          />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}

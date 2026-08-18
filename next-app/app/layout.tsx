import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Earl",
  description: "An AI-powered survival guide for small business owners.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Earl", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport = {
  themeColor: "#f5f0e8",
};

// Fonts load via a stylesheet link (Playfair Display, Epilogue, Space Mono), so
// the build never depends on a network fetch. ClerkProvider reads its config
// from env (publishable key + the subdomain sign-in URLs). See .env.example.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          {/* iOS only launches a home-screen app standalone (no URL bar / dots)
              when THIS exact meta is present. Next's appleWebApp metadata emits
              the title + status-bar but not this one, so set it explicitly. */}
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="default" />
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

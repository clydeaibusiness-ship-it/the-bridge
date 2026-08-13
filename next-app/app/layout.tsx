import type { Metadata } from "next";
import { Playfair_Display, Epilogue, Space_Mono } from "next/font/google";
import "./globals.css";

const display = Playfair_Display({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--f-display" });
const ui = Epilogue({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--f-ui" });
const mono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--f-data" });

export const metadata: Metadata = {
  title: "Earl",
  description: "Your AI business mentor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

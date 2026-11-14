import type { Metadata, Viewport } from "next";
import { Hind_Siliguri, Inter } from "next/font/google";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { Header } from "@/components/layout/Header";
import { PrefsBoundary } from "@/components/layout/PrefsBoundary";
import { StaleBanner } from "@/components/layout/Refresh";
import { Sidebar } from "@/components/layout/Sidebar";
import { UrlSync } from "@/components/layout/UrlSync";
import { Toaster } from "@/components/ui/Toast";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const hind = Hind_Siliguri({ subsets: ["bengali", "latin"], weight: ["400", "500", "600"], variable: "--font-hind", display: "swap" });

export const metadata: Metadata = {
  title: "AquaGuard — Water Intelligence for Bangladesh",
  description: "Predict Water Risks. Optimize Water Resources. Protect Every Drop. A decision-support prototype.",
};

export const viewport: Viewport = { themeColor: "#0868CC" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${hind.variable}`}>
      <body className="antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-primary">
          Skip to content
        </a>
        <UrlSync />
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <StaleBanner />
            <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
              <PrefsBoundary>{children}</PrefsBoundary>
            </main>
          </div>
        </div>
        <CopilotPanel />
        <CommandPalette />
        <Toaster />
      </body>
    </html>
  );
}

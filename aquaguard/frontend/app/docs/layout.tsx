import type { Metadata } from "next";
import "./docs.css";

export const metadata: Metadata = {
  title: "BlueSense Docs — pitch deck, technical documentation and live system status",
  description:
    "BlueSense: water intelligence for Bangladesh. YC-style pitch, architecture, data and AI layers, API documentation and live system status.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1240px]">{children}</div>;
}

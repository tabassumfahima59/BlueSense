import Link from "next/link";
import { ArrowRight, Droplets } from "lucide-react";
import { MODULES } from "@/components/layout/nav";

export default function Landing() {
  return (
    <div className="mx-auto max-w-4xl py-6">
      <div className="card p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-white">
            <Droplets size={24} aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AquaGuard</h1>
            <p className="text-[13.5px] text-muted">AI-Powered Water Intelligence, Prediction & Resource Optimization Platform</p>
          </div>
        </div>
        <p className="mt-5 text-lg font-medium text-primary">Predict Water Risks. Optimize Water Resources. Protect Every Drop.</p>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
          A decision-support prototype for Bangladesh — national, 8 divisions and 64 districts — built on public data (ERA5 reanalysis via
          Open-Meteo, FAO AQUASTAT, GRACE/GRACE-FO, geoBoundaries, HDX). Every number is labelled Observed, Historical, Predicted,
          Estimated or Simulated. Flow: Predict → Analyze → Visualize → Optimize → Recommend.
        </p>
        <Link href="/command-center" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[14px] font-medium text-white hover:bg-primary-dark">
          Open the Command Center <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href} className="card flex items-start gap-3 p-4 transition hover:border-primary">
            <m.icon size={20} className="mt-0.5 text-primary" aria-hidden />
            <span>
              <span className="block text-[14px] font-semibold">{m.label}</span>
              <span className="block text-[12.5px] text-muted">{m.desc}</span>
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-5 text-[12px] text-muted">
        No IoT sensors, no real-time pipe pressure, no pump or valve control. AquaGuard supports decisions; it does not replace field
        monitoring, laboratory testing or government water systems.
      </p>
    </div>
  );
}

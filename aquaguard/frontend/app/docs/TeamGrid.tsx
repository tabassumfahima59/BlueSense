import { Mail } from "lucide-react";
import type { TeamMember } from "@/lib/docs/types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Uniform member cards: 1:1 photo (stored at 512×512, shown at 128×128) or an initials avatar. */
export function TeamGrid({ name, members }: { name: string; members: TeamMember[] }) {
  if (!members.length) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-white/60 p-4 text-[14px] text-muted">
        Team details coming soon.
      </p>
    );
  }
  return (
    <div>
      {name && <p className="mb-3 text-[14px] font-semibold text-ink">Team {name}</p>}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => (
          <li key={m.id} className="flex flex-col items-center rounded-2xl border border-border bg-white/80 p-5 text-center shadow-sm">
            {m.photoVersion ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already 512×512 WebP
              <img
                src={`/api/docs/media/${encodeURIComponent(m.id)}?v=${m.photoVersion}`}
                alt={`Photo of ${m.fullName}`}
                width={128}
                height={128}
                loading="lazy"
                className="h-32 w-32 rounded-2xl border-4 border-white object-cover shadow-md ring-1 ring-border"
              />
            ) : (
              <div aria-hidden className="grid h-32 w-32 place-items-center rounded-2xl border-4 border-white bg-gradient-to-br from-primary to-sky text-3xl font-semibold text-white shadow-md ring-1 ring-border">
                {initials(m.fullName)}
              </div>
            )}
            <p className="mt-3 text-[15px] font-semibold text-ink">{m.fullName}</p>
            {m.role && <p className="mt-0.5 text-[13.5px] text-muted">{m.role}</p>}
            {m.showEmail && m.email && (
              <a href={`mailto:${m.email}`} className="mt-2 inline-flex items-center gap-1.5 break-all text-[13px] text-primary underline-offset-2 hover:underline">
                <Mail size={14} aria-hidden /> {m.email}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

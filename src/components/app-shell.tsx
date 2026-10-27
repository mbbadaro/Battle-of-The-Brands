"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Profile } from "@/lib/types";
import { LiveProvider, useLive } from "@/hooks/live";
import { ProfileProvider } from "@/hooks/profile";
import { getSupabase } from "@/lib/supabase/client";
import { BrandMark } from "./brand";

const NAV = [
  { href: "/", label: "Sell" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/history", label: "History" },
  { href: "/report", label: "Report" },
  { href: "/admin", label: "Admin", admin: true },
];

function LiveDot() {
  const { status } = useLive();
  const map = {
    live: { color: "bg-[#3ddc97]", label: "Live" },
    connecting: { color: "bg-[#f5c451]", label: "Connecting" },
    offline: { color: "bg-[#ff6b5e]", label: "Offline · polling" },
  } as const;
  const s = map[status];
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-bold text-white/80" title={`Realtime: ${s.label}`}>
      <span className={`h-2 w-2 rounded-full ${s.color} ${status === "live" ? "animate-pulse" : ""}`} />
      <span className="hidden sm:inline">{s.label}</span>
    </span>
  );
}

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.admin || profile.role === "admin");

  return (
    <ProfileProvider profile={profile}>
      <LiveProvider>
        <header className="no-print sky sticky top-0 z-30 text-white shadow-[0_2px_0_0_#0a2463]">
          <div className="mx-auto flex h-13 max-w-6xl items-center gap-3 px-3">
            <Link href="/" className="shrink-0" aria-label="Sell">
              <BrandMark compact />
            </Link>
            <nav className="-mr-1 ml-auto flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none]">
              {items.map((n) => {
                const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`shrink-0 rounded-lg px-1.5 py-1.5 text-[13px] font-bold transition sm:px-3 ${
                      active ? "bg-white text-navy" : "text-white/80 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <LiveDot />
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-3 pb-10 pt-3 sm:px-4">{children}</div>
        <footer className="no-print mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 pb-6 text-xs text-muted">
          <span>
            Signed in as <b className="text-navy">{profile.display_name}</b> · {profile.role}
          </span>
          <button
            className="font-bold text-blue"
            onClick={async () => {
              await getSupabase().auth.signOut();
              window.location.assign("/login");
            }}
          >
            Sign out
          </button>
        </footer>
      </LiveProvider>
    </ProfileProvider>
  );
}

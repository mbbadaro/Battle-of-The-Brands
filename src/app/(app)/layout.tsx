import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import type { Profile } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { PendingScreen } from "@/components/pending-screen";
import { NotConfigured, SetupProblem } from "@/components/setup-problem";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured) return <NotConfigured />;

  const supabase = await getServerSupabase();
  const user = await supabase.auth
    .getUser()
    .then((r) => r.data.user)
    .catch(() => null);
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase.rpc("get_my_profile");
  if (error || !profile) {
    return (
      <SetupProblem title="Database setup incomplete">
        <p>You are signed in, but the database did not return your team profile.</p>
        <p>
          Make sure <code>supabase/setup.sql</code> was run in the Supabase SQL Editor <b>before</b> anyone created an account. If accounts were
          created first, delete them in Supabase → Authentication → Users and sign up again.
        </p>
        {error && <p className="font-mono text-xs text-muted">{error.message}</p>}
      </SetupProblem>
    );
  }
  if ((profile as Profile).role === "pending") return <PendingScreen profile={profile as Profile} />;

  return <AppShell profile={profile as Profile}>{children}</AppShell>;
}

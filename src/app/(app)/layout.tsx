import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { PendingScreen } from "@/components/pending-screen";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.rpc("get_my_profile");
  if (!profile) redirect("/login");
  if ((profile as Profile).role === "pending") return <PendingScreen profile={profile as Profile} />;

  return <AppShell profile={profile as Profile}>{children}</AppShell>;
}

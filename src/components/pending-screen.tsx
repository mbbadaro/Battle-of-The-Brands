"use client";

import type { Profile } from "@/lib/types";
import { HeroBanner } from "./brand";
import { Button } from "./ui";
import { getSupabase } from "@/lib/supabase/client";

export function PendingScreen({ profile }: { profile: Profile }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-8">
      <HeroBanner />
      <div className="rounded-3xl border border-line bg-paper p-5">
        <h1 className="display text-2xl text-navy">Almost there, {profile.display_name}</h1>
        <p className="mt-2 text-sm text-muted">
          Your account ({profile.email}) is waiting for an admin to approve it. Ask your team admin to open <b>Admin → Team</b> and make
          you a seller.
        </p>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={() => window.location.reload()}>
            Check again
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await getSupabase().auth.signOut();
              window.location.assign("/login");
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}

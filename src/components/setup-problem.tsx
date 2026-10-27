// Shown instead of a crash when the deployment can't reach a working database.
export function SetupProblem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <div className="rounded-3xl border border-line bg-paper p-6">
        <h1 className="display text-2xl text-navy">{title}</h1>
        <div className="mt-3 space-y-2 text-sm text-ink">{children}</div>
      </div>
    </main>
  );
}

export function NotConfigured() {
  return (
    <SetupProblem title="Database not connected yet">
      <p>
        This deployment was built without the Supabase settings. In Vercel, open <b>Settings → Environment Variables</b> and make sure these exist
        for Production:
      </p>
      <ul className="list-disc pl-5">
        <li>
          <code>NEXT_PUBLIC_SUPABASE_URL</code>
        </li>
        <li>
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (or <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>)
        </li>
      </ul>
      <p>
        Then open <b>Deployments</b>, use the ⋯ menu on the latest deployment and choose <b>Redeploy</b>. The values are read at build time.
      </p>
    </SetupProblem>
  );
}

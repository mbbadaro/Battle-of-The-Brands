import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL, supabaseConfigured } from "@/lib/supabase/env";

const NOT_CONFIGURED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Setup needed</title></head>
<body style="font-family:system-ui,sans-serif;background:#f4ecdc;color:#0a1633;max-width:560px;margin:48px auto;padding:0 16px">
<h1 style="color:#0a2463">Database not connected yet</h1>
<p>This deployment was built without the Supabase settings. In Vercel, open the project's <b>Settings → Environment Variables</b> and make sure these exist for Production:</p>
<ul><li><code>NEXT_PUBLIC_SUPABASE_URL</code></li><li><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (or <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>)</li></ul>
<p>Then go to <b>Deployments</b>, open the ⋯ menu on the latest deployment and choose <b>Redeploy</b>. The values are read at build time, so a redeploy is required.</p>
</body></html>`;

// Refreshes the Supabase session cookie and keeps signed-out visitors on /login.
export async function middleware(request: NextRequest) {
  if (!supabaseConfigured) {
    return new NextResponse(NOT_CONFIGURED, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // A Supabase outage must not take the whole site down; treat it as signed out.
  const user = await supabase.auth
    .getUser()
    .then((r) => r.data.user)
    .catch(() => null);

  const isLogin = request.nextUrl.pathname.startsWith("/login");
  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|webp)$).*)"],
};

"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NotConfigured } from "@/components/setup-problem";
import { HeroBanner } from "@/components/brand";
import { Button, Notice, Spinner, inputClass } from "@/components/ui";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Already signed in (getSession also refreshes an expired token): go straight to the app.
  useEffect(() => {
    if (!supabaseConfigured) return;
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) window.location.replace("/");
      });
  }, []);

  if (!supabaseConfigured) return <NotConfigured />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = getSupabase();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        window.location.assign("/");
      } else {
        if (name.trim().length < 1) throw new Error("Enter your name so teammates know who recorded each sale.");
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() } },
        });
        if (error) throw error;
        if (data.session) window.location.assign("/");
        else setInfo("Check your email to confirm your account, then sign in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-8">
      <HeroBanner />
      <form onSubmit={submit} className="rounded-3xl border border-line bg-paper p-5">
        <h1 className="display text-2xl text-navy">{mode === "signin" ? "Team sign in" : "Join the team"}</h1>
        <p className="mt-1 text-sm text-muted">
          {mode === "signin"
            ? "Sign in to record sales and see live inventory."
            : "New accounts wait for an admin to approve them. The first account created becomes the admin."}
        </p>
        <div className="mt-4 space-y-3">
          {mode === "signup" && (
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-navy">Your name</span>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} required />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-navy">Email</span>
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-navy">Password</span>
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </label>
          {error && <Notice tone="bad">{error}</Notice>}
          {info && <Notice tone="good">{info}</Notice>}
          <Button type="submit" className="h-12 w-full text-base" disabled={busy}>
            {busy && <Spinner />} {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </div>
        <button
          type="button"
          className="mt-4 w-full text-center text-sm font-bold text-blue"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
        >
          {mode === "signin" ? "New team member? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}

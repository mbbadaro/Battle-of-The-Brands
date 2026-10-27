"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { toAppError, type AppError } from "@/lib/errors";

type LinkStatus = "connecting" | "live" | "offline";

interface LiveContextValue {
  tick: number;
  status: LinkStatus;
  refreshAll: () => void;
}

const LiveContext = createContext<LiveContextValue>({ tick: 0, status: "connecting", refreshAll: () => {} });

const POLL_MS = 15_000;

// Subscribes once to the realtime ticker. Every sale, void or adjustment bumps it, and every
// mounted query refetches. Polling and focus/online refreshes cover dropped sockets.
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const refreshAll = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const supabase = getSupabase();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // Realtime applies row level security with the token it holds, so hand it the user's
    // session token before joining; otherwise the first join can happen as anonymous.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel("live-ticker")
        .on("postgres_changes", { event: "*", schema: "public", table: "live_ticker" }, refreshAll)
        .subscribe((s) => {
          if (s === "SUBSCRIBED") {
            setStatus("live");
            refreshAll();
          } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            setStatus("offline");
          }
        });
    })();

    const poll = setInterval(refreshAll, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refreshAll();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refreshAll);
    window.addEventListener("focus", refreshAll);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refreshAll);
      window.removeEventListener("focus", refreshAll);
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [refreshAll]);

  return <LiveContext.Provider value={{ tick, status, refreshAll }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);

// Calls a read-only RPC and keeps it fresh whenever the ticker moves.
export function useRpc<T>(fn: string, args?: Record<string, unknown>, enabled = true) {
  const { tick } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const argsKey = JSON.stringify(args ?? {});

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const { data, error } = await getSupabase().rpc(fn, JSON.parse(argsKey));
      if (id !== seq.current) return;
      if (error) throw error;
      setData(data as T);
      setError(null);
    } catch (e) {
      if (id === seq.current) setError(toAppError(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [fn, argsKey]);

  useEffect(() => {
    if (enabled) load();
  }, [load, tick, enabled]);

  return { data, error, loading, reload: load };
}

// Mutating RPC with a typed error.
export async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    const { data, error } = await getSupabase().rpc(fn, args);
    if (error) throw error;
    return data as T;
  } catch (e) {
    throw toAppError(e);
  }
}

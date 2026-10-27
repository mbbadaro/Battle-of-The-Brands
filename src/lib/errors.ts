// Database functions raise errors with a machine code in `message` and a human sentence in `details`.
export interface AppError {
  code: string;
  message: string;
  data?: Record<string, unknown>;
  network?: boolean;
}

interface PostgrestLikeError {
  message?: string;
  details?: string | null;
  code?: string;
}

const FRIENDLY: Record<string, string> = {
  NOT_AUTHENTICATED: "Your session expired. Please sign in again.",
  NOT_AUTHORIZED: "You don't have permission to do that.",
  INSUFFICIENT_STOCK: "Not enough bars left for this sale.",
  EMPTY_SALE: "Select at least one product.",
  INVALID_NETID: "Enter a valid Cornell NetID, for example abc123.",
};

export function toAppError(err: unknown): AppError {
  if (err instanceof TypeError || (err instanceof Error && /fetch|network/i.test(err.message))) {
    return { code: "NETWORK", message: "Network problem. Check your connection and try again.", network: true };
  }
  const e = (err ?? {}) as PostgrestLikeError;
  const code = e.message && /^[A-Z_]+$/.test(e.message) ? e.message : "UNKNOWN";
  let data: Record<string, unknown> | undefined;
  let message = e.details ?? "";
  if (message.startsWith("{")) {
    try {
      data = JSON.parse(message);
      message = String(data?.message ?? "");
    } catch {
      /* plain text */
    }
  }
  if (!message) message = FRIENDLY[code] ?? (code === "UNKNOWN" ? e.message ?? "Something went wrong." : code);
  if (/Failed to fetch|NetworkError|Load failed/i.test(e.message ?? "")) {
    return { code: "NETWORK", message: "Network problem. Check your connection and try again.", network: true };
  }
  return { code, message, data };
}

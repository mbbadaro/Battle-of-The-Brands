// Supabase connection settings. Accepts both the names in .env.example and the ones the
// Vercel ↔ Supabase integration creates (newer projects get a "publishable" key instead of "anon").
// Each process.env access is written out literally so Next.js can inline it at build time.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

export const supabaseConfigured = SUPABASE_URL !== "" && SUPABASE_KEY !== "";

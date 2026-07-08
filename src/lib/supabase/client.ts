import { createClient } from "@supabase/supabase-js";

// Client-side Supabase instance. Uses ONLY the anon key, which is safe to
// ship to the browser — RLS policies (see docs/supabase-schema.sql and
// docs/migrations/0002_hardening_and_scope.sql) are what actually restrict
// what this client can read/write, not secrecy of this key.
//
// Vite/TanStack Start requires client-exposed env vars to be prefixed
// VITE_ (see @lovable.dev/vite-tanstack-config in vite.config.ts, which
// injects VITE_* automatically). Never reference SUPABASE_SERVICE_ROLE_KEY
// from this file or any file it imports.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in your " +
      "environment (.env.local for dev, project secrets for deploy).",
  );
}

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

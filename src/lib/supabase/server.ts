import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// SERVER-ONLY. Do not import this file from any component, hook, or module
// that also gets bundled for the client — Vite will refuse to inline
// process.env.SUPABASE_SERVICE_ROLE_KEY into a client bundle as long as this
// file is only ever imported inside createServerFn handlers or the
// server-side `handlers` block of a file route (both of which TanStack
// Start tree-shakes out of the client build), but it's still your
// responsibility not to import it from a shared "utils" file that both
// sides use.
//
// This client bypasses RLS entirely (service_role). Every handler that uses
// it MUST perform its own authorization check before touching the
// database — see requireCompanyMember() below and its usage in
// audit-document.server.ts.

let cached: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY server env vars. " +
        "These must NOT be prefixed with VITE_ — set them as plain server " +
        "secrets in your deployment platform.",
    );
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * Verifies the caller (identified by a Supabase JWT from the request's
 * Authorization header) is a member of the given company, and returns
 * their role. Throws a 401/403-style error object if not — callers should
 * catch and translate to an HTTP response.
 *
 * This is the check that was MISSING from the original api/audit-document.ts
 * route, which accepted any supplierId with no verification the caller had
 * any relationship to that supplier's company.
 */
export async function requireCompanyMember(
  request: Request,
  companyId: string,
): Promise<{ userId: string; role: "owner" | "admin" | "analyst" | "auditor_readonly" }> {
  const admin = getSupabaseAdmin();
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new AuthError(401, "missing_token", "No Authorization header provided.");
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    throw new AuthError(401, "invalid_token", "Token could not be verified.");
  }

  const { data: membership, error: memberError } = await admin
    .from("company_members")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (memberError) {
    throw new AuthError(500, "membership_lookup_failed", memberError.message);
  }
  if (!membership) {
    throw new AuthError(403, "not_a_member", "Caller is not a member of this company.");
  }

  return { userId: userData.user.id, role: membership.role };
}

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Verifies the caller has a valid Supabase session, without requiring any
 * company membership. Used by createCompany, which necessarily runs before
 * the caller belongs to any company yet.
 */
export async function requireAuthenticatedUser(
  request: Request,
): Promise<{ userId: string; email: string | null }> {
  const admin = getSupabaseAdmin();
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new AuthError(401, "missing_token", "No Authorization header provided.");
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    throw new AuthError(401, "invalid_token", "Token could not be verified.");
  }

  return { userId: userData.user.id, email: userData.user.email ?? null };
}

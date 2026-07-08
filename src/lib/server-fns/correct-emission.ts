import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { correctEmissionSchema } from "@/lib/schemas/emissions";
import { getSupabaseAdmin, requireCompanyMember, AuthError } from "@/lib/supabase/server";
import { authMiddleware } from "@/lib/server-fns/auth-middleware";

/**
 * Lets an authenticated buyer-side user override an AI-extracted co2e_kg
 * value. Writes to override_co2e_kg (never mutates the original co2e_kg),
 * so the AI's original figure is always preserved for audit comparison.
 * The audit_emissions_data trigger (migration 0002) automatically records
 * the before/after JSON and actor_user_id — no manual audit_log insert
 * needed here.
 */
export const correctEmission = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(correctEmissionSchema)
  .handler(async ({ data }) => {
    const request = getRequest();

    let auth: Awaited<ReturnType<typeof requireCompanyMember>>;
    try {
      auth = await requireCompanyMember(request, data.companyId);
    } catch (err) {
      if (err instanceof AuthError) {
        throw new Response(JSON.stringify({ error: err.code, message: err.message }), {
          status: err.status,
          headers: { "content-type": "application/json" },
        });
      }
      throw err;
    }

    // auditor_readonly must never be able to reach this far — belt and
    // braces on top of the RLS policy, since this handler runs with the
    // service-role client and bypasses RLS.
    if (auth.role === "auditor_readonly") {
      throw new Response(
        JSON.stringify({
          error: "read_only_role",
          message: "Auditors cannot modify emissions data.",
        }),
        { status: 403 },
      );
    }

    const admin = getSupabaseAdmin();

    // Confirm the emission row's supplier belongs to the caller's company
    // before allowing the override — same cross-tenant check pattern as
    // audit-document.ts.
    const { data: existing, error: fetchError } = await admin
      .from("emissions_data")
      .select("id, supplier_id, suppliers!inner(company_id)")
      .eq("id", data.emissionId)
      .single();

    if (fetchError || !existing) {
      throw new Response(JSON.stringify({ error: "emission_not_found" }), { status: 404 });
    }
    // @ts-expect-error -- supabase-js nested select typing; company_id is
    // present at runtime via the suppliers!inner join.
    if (existing.suppliers.company_id !== data.companyId) {
      throw new Response(JSON.stringify({ error: "emission_company_mismatch" }), { status: 403 });
    }

    const { data: updated, error: updateError } = await admin
      .from("emissions_data")
      .update({
        override_co2e_kg: data.overrideCo2eKg,
        override_reason: data.overrideReason,
        reviewed_by: auth.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.emissionId)
      .select()
      .single();

    if (updateError) {
      throw new Response(JSON.stringify({ error: "update_failed", detail: updateError.message }), {
        status: 502,
      });
    }

    return { ok: true, row: updated };
  });

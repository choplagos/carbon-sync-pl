import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { generateReportSnapshotSchema } from "@/lib/schemas/emissions";
import { getSupabaseAdmin, requireCompanyMember, AuthError } from "@/lib/supabase/server";

/**
 * Computes the report snapshot server-side from suppliers + emissions_data
 * — the client never gets to submit its own aggregate numbers for
 * something that may end up frozen as an audit artifact. Upserts into the
 * existing 'draft' row for (company, fiscal year, standard) if one exists,
 * otherwise inserts a new draft. Never touches a 'final'/'submitted' row —
 * the DB trigger (lock_finalized_reports) would reject that anyway.
 */
export const generateReportSnapshot = createServerFn({ method: "POST" })
  .inputValidator(generateReportSnapshotSchema)
  .handler(async ({ data }) => {
    const request = getRequest();

    let role: string;
    try {
      const auth = await requireCompanyMember(request, data.companyId);
      role = auth.role;
    } catch (err) {
      if (err instanceof AuthError) {
        throw new Response(JSON.stringify({ error: err.code, message: err.message }), {
          status: err.status,
        });
      }
      throw err;
    }
    if (role === "auditor_readonly") {
      throw new Response(
        JSON.stringify({ error: "read_only_role", message: "Auditors cannot generate reports." }),
        { status: 403 },
      );
    }

    const admin = getSupabaseAdmin();

    const { data: suppliers, error: suppliersError } = await admin
      .from("suppliers")
      .select("id, name, category, country, status")
      .eq("company_id", data.companyId);
    if (suppliersError) {
      throw new Response(
        JSON.stringify({ error: "suppliers_fetch_failed", detail: suppliersError.message }),
        {
          status: 502,
        },
      );
    }

    const supplierIds = (suppliers ?? []).map((s) => s.id);
    const { data: emissions, error: emissionsError } =
      supplierIds.length > 0
        ? await admin
            .from("emissions_data")
            .select("supplier_id, co2e_kg, override_co2e_kg, scope, is_estimated, confidence_score")
            .in("supplier_id", supplierIds)
        : { data: [], error: null };
    if (emissionsError) {
      throw new Response(
        JSON.stringify({ error: "emissions_fetch_failed", detail: emissionsError.message }),
        {
          status: 502,
        },
      );
    }

    const effKg = (r: { co2e_kg: number; override_co2e_kg: number | null }) =>
      r.override_co2e_kg ?? r.co2e_kg;

    const rows = emissions ?? [];
    const totalCO2eKg = rows.reduce((a, r) => a + effKg(r), 0);
    const scope1Kg = rows.filter((r) => r.scope === "scope_1").reduce((a, r) => a + effKg(r), 0);
    const scope2Kg = rows.filter((r) => r.scope === "scope_2").reduce((a, r) => a + effKg(r), 0);
    const scope3Kg = rows.filter((r) => r.scope === "scope_3").reduce((a, r) => a + effKg(r), 0);
    const estimatedKg = rows.filter((r) => r.is_estimated).reduce((a, r) => a + effKg(r), 0);
    const avgConfidence =
      rows.length > 0 ? rows.reduce((a, r) => a + (r.confidence_score ?? 0), 0) / rows.length : 0;

    const kgBySupplier = new Map<string, number>();
    const docsBySupplier = new Map<string, number>();
    for (const r of rows) {
      kgBySupplier.set(r.supplier_id, (kgBySupplier.get(r.supplier_id) ?? 0) + effKg(r));
      docsBySupplier.set(r.supplier_id, (docsBySupplier.get(r.supplier_id) ?? 0) + 1);
    }

    const categoryMap = new Map<string, { kg: number; supplierCount: number }>();
    const countryMap = new Map<string, number>();
    for (const s of suppliers ?? []) {
      const kg = kgBySupplier.get(s.id) ?? 0;
      const cat = s.category ?? "Uncategorized";
      const c = categoryMap.get(cat) ?? { kg: 0, supplierCount: 0 };
      c.kg += kg;
      c.supplierCount += 1;
      categoryMap.set(cat, c);

      const country = s.country ?? "—";
      countryMap.set(country, (countryMap.get(country) ?? 0) + kg);
    }

    const categoryBreakdown = [...categoryMap.entries()]
      .map(([category, v]) => ({
        category,
        kg: v.kg,
        supplierCount: v.supplierCount,
        sharePct: totalCO2eKg > 0 ? (v.kg / totalCO2eKg) * 100 : 0,
      }))
      .sort((a, b) => b.kg - a.kg);

    const countryBreakdown = [...countryMap.entries()]
      .map(([country, kg]) => ({
        country,
        kg,
        sharePct: totalCO2eKg > 0 ? (kg / totalCO2eKg) * 100 : 0,
      }))
      .sort((a, b) => b.kg - a.kg);

    const supplierLedger = (suppliers ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      country: s.country,
      status: s.status,
      docs: docsBySupplier.get(s.id) ?? 0,
      kg: kgBySupplier.get(s.id) ?? 0,
    }));

    const snapshot = {
      totalCO2eKg,
      scope1Kg,
      scope2Kg,
      scope3Kg,
      supplierCount: suppliers?.length ?? 0,
      auditedCount: (suppliers ?? []).filter((s) => s.status === "AUDITED").length,
      uploadedCount: (suppliers ?? []).filter((s) => s.status === "UPLOADED").length,
      pendingCount: (suppliers ?? []).filter((s) => s.status === "PENDING").length,
      documentCount: rows.length,
      estimatedRatioPct: totalCO2eKg > 0 ? (estimatedKg / totalCO2eKg) * 100 : 0,
      avgConfidence,
      categoryBreakdown,
      countryBreakdown,
      supplierLedger,
      generatedAt: new Date().toISOString(),
    };

    // Look for an existing draft to update in place.
    const { data: existingDraft } = await admin
      .from("reports")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("fiscal_year", data.fiscalYear)
      .eq("reporting_standard", data.reportingStandard)
      .eq("status", "draft")
      .maybeSingle();

    if (existingDraft) {
      const { data: updated, error: updateError } = await admin
        .from("reports")
        .update({ snapshot, generated_at: new Date().toISOString() })
        .eq("id", existingDraft.id)
        .select()
        .single();
      if (updateError) {
        throw new Response(
          JSON.stringify({ error: "update_failed", detail: updateError.message }),
          {
            status: 502,
          },
        );
      }
      return { ok: true, report: updated };
    }

    const { data: inserted, error: insertError } = await admin
      .from("reports")
      .insert({
        company_id: data.companyId,
        fiscal_year: data.fiscalYear,
        reporting_standard: data.reportingStandard,
        status: "draft",
        snapshot,
      })
      .select()
      .single();
    if (insertError) {
      throw new Response(JSON.stringify({ error: "insert_failed", detail: insertError.message }), {
        status: 502,
      });
    }
    return { ok: true, report: inserted };
  });

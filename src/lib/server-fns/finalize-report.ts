import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { finalizeReportSchema } from "@/lib/schemas/emissions";
import { getSupabaseAdmin, requireCompanyMember, AuthError } from "@/lib/supabase/server";

export const finalizeReport = createServerFn({ method: "POST" })
  .inputValidator(finalizeReportSchema)
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
    if (role !== "owner" && role !== "admin") {
      throw new Response(
        JSON.stringify({
          error: "insufficient_role",
          message: "Only owner/admin can finalize a report.",
        }),
        { status: 403 },
      );
    }

    const admin = getSupabaseAdmin();

    const { data: report, error: fetchError } = await admin
      .from("reports")
      .select("id, company_id, status")
      .eq("id", data.reportId)
      .single();

    if (fetchError || !report) {
      throw new Response(JSON.stringify({ error: "report_not_found" }), { status: 404 });
    }
    if (report.company_id !== data.companyId) {
      throw new Response(JSON.stringify({ error: "report_company_mismatch" }), { status: 403 });
    }
    if (report.status !== "draft") {
      throw new Response(
        JSON.stringify({ error: "not_draft", message: `Report is already ${report.status}.` }),
        { status: 409 },
      );
    }

    const { data: updated, error: updateError } = await admin
      .from("reports")
      .update({ status: "final", finalized_at: new Date().toISOString() })
      .eq("id", data.reportId)
      .select()
      .single();

    if (updateError) {
      throw new Response(
        JSON.stringify({ error: "finalize_failed", detail: updateError.message }),
        {
          status: 502,
        },
      );
    }

    return { ok: true, report: updated };
  });

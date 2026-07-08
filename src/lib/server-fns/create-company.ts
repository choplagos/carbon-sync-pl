import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createCompanySchema } from "@/lib/schemas/emissions";
import { getSupabaseAdmin, requireAuthenticatedUser, AuthError } from "@/lib/supabase/server";
import { authMiddleware } from "@/lib/server-fns/auth-middleware";

export const createCompany = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(createCompanySchema)
  .handler(async ({ data }) => {
    const request = getRequest();

    let userId: string;
    try {
      const auth = await requireAuthenticatedUser(request);
      userId = auth.userId;
    } catch (err) {
      if (err instanceof AuthError) {
        throw new Response(JSON.stringify({ error: err.code, message: err.message }), {
          status: err.status,
        });
      }
      throw err;
    }

    const admin = getSupabaseAdmin();

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({
        name: data.name,
        domain: data.domain || null,
        vat: data.vat || null,
        fiscal_year: data.fiscalYear ?? new Date().getFullYear(),
        reporting_standard: data.reportingStandard,
      })
      .select()
      .single();

    if (companyError) {
      throw new Response(
        JSON.stringify({ error: "company_insert_failed", detail: companyError.message }),
        {
          status: 502,
        },
      );
    }

    const { error: memberError } = await admin
      .from("company_members")
      .insert({ company_id: company.id, user_id: userId, role: "owner" });

    if (memberError) {
      // Best-effort cleanup so a failed membership insert doesn't leave an
      // orphaned company nobody can access.
      await admin.from("companies").delete().eq("id", company.id);
      throw new Response(
        JSON.stringify({ error: "membership_insert_failed", detail: memberError.message }),
        {
          status: 502,
        },
      );
    }

    return { ok: true, company };
  });

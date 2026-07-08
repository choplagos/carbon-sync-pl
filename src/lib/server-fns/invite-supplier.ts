import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { inviteSupplierSchema } from "@/lib/schemas/emissions";
import { getSupabaseAdmin, requireCompanyMember, AuthError } from "@/lib/supabase/server";

export const inviteSupplier = createServerFn({ method: "POST" })
  .inputValidator(inviteSupplierSchema)
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

    if (auth.role === "auditor_readonly") {
      throw new Response(
        JSON.stringify({ error: "read_only_role", message: "Auditors cannot invite suppliers." }),
        { status: 403 },
      );
    }

    const admin = getSupabaseAdmin();

    // upload_token has a DB default (gen_random_bytes), so we don't set it
    // here — we just read it back after insert.
    const { data: inserted, error } = await admin
      .from("suppliers")
      .insert({
        company_id: data.companyId,
        name: data.name,
        contact_email: data.contactEmail,
        country: data.country.toUpperCase(),
        category: data.category,
      })
      .select("id, name, upload_token")
      .single();

    if (error) {
      throw new Response(JSON.stringify({ error: "insert_failed", detail: error.message }), {
        status: 502,
      });
    }

    return {
      ok: true,
      supplier: inserted,
      uploadUrl: `/upload?supplierId=${inserted.upload_token}`,
    };
  });

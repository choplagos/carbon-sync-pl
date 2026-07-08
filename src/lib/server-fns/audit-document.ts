import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auditDocumentSchema } from "@/lib/schemas/emissions";
import { getSupabaseAdmin, requireCompanyMember, AuthError } from "@/lib/supabase/server";
import { extractAndInsertEmissions, ExtractionError } from "@/lib/server/gemini-extraction";

/**
 * Buyer-side "re-audit this document" action — requires the caller to be an
 * authenticated member of the company that owns the target supplier. For
 * the actual supplier upload portal flow (anonymous, token-authenticated),
 * see submit-supplier-document.ts instead.
 */
export const auditDocument = createServerFn({ method: "POST" })
  .inputValidator(auditDocumentSchema)
  .handler(async ({ data }) => {
    const request = getRequest();

    try {
      await requireCompanyMember(request, data.companyId);
    } catch (err) {
      if (err instanceof AuthError) {
        throw new Response(JSON.stringify({ error: err.code, message: err.message }), {
          status: err.status,
          headers: { "content-type": "application/json" },
        });
      }
      throw err;
    }

    const admin = getSupabaseAdmin();
    const { data: supplier, error: supplierError } = await admin
      .from("suppliers")
      .select("id, company_id")
      .eq("id", data.supplierId)
      .single();

    if (supplierError || !supplier) {
      throw new Response(JSON.stringify({ error: "supplier_not_found" }), { status: 404 });
    }
    if (supplier.company_id !== data.companyId) {
      throw new Response(JSON.stringify({ error: "supplier_company_mismatch" }), { status: 403 });
    }

    try {
      const result = await extractAndInsertEmissions({
        supplierId: data.supplierId,
        storagePath: data.storagePath,
      });
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof ExtractionError) {
        throw new Response(JSON.stringify({ error: err.code, message: err.message }), {
          status: err.status,
        });
      }
      throw err;
    }
  });

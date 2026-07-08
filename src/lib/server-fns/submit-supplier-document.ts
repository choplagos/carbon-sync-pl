import { createServerFn } from "@tanstack/react-start";
import { submitSupplierDocumentSchema } from "@/lib/schemas/emissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { extractAndInsertEmissions, ExtractionError } from "@/lib/server/gemini-extraction";

/**
 * Called by the anonymous supplier upload portal (src/routes/upload.tsx).
 * The caller has no Supabase Auth session — the upload_token IS the
 * credential. Every check here exists because this endpoint is reachable
 * by anyone who has (or guesses) a token, so we can't lean on RLS/auth the
 * way the buyer-side dashboard can.
 */
export const submitSupplierDocument = createServerFn({ method: "POST" })
  .inputValidator(submitSupplierDocumentSchema)
  .handler(async ({ data }) => {
    const admin = getSupabaseAdmin();

    const { data: supplier, error: supplierError } = await admin
      .from("suppliers")
      .select("id, company_id, status")
      .eq("upload_token", data.uploadToken)
      .maybeSingle();

    if (supplierError || !supplier) {
      throw new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
    }

    // Enforce the storage path convention (supplier-documents/{supplierId}/...)
    // so a valid token for supplier A can never be used to trigger processing
    // of a path that was actually uploaded under supplier B's prefix.
    if (!data.storagePath.startsWith(`${supplier.id}/`)) {
      throw new Response(
        JSON.stringify({
          error: "path_mismatch",
          message: "storagePath does not belong to this supplier.",
        }),
        { status: 403 },
      );
    }

    // Lightweight abuse guard: cap documents processed per supplier per
    // rolling hour. Not a substitute for real rate limiting at the edge,
    // but stops a runaway client-side loop from burning Gemini spend.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("emissions_data")
      .select("id", { count: "exact", head: true })
      .eq("supplier_id", supplier.id)
      .gte("created_at", oneHourAgo);

    if ((count ?? 0) >= 50) {
      throw new Response(
        JSON.stringify({
          error: "rate_limited",
          message: "Too many documents processed in the last hour.",
        }),
        { status: 429 },
      );
    }

    try {
      const result = await extractAndInsertEmissions({
        supplierId: supplier.id,
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

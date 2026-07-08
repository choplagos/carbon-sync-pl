import { createServerFn } from "@tanstack/react-start";
import { getSupplierUploadUrlSchema } from "@/lib/schemas/emissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Mints a signed, path-scoped upload URL for an anonymous supplier holding
 * a valid upload_token. The returned path is always prefixed with the
 * supplier's own id, so submit-supplier-document.ts's path-prefix check
 * can trust it later.
 */
export const getSupplierUploadUrl = createServerFn({ method: "POST" })
  .inputValidator(getSupplierUploadUrlSchema)
  .handler(async ({ data }) => {
    const admin = getSupabaseAdmin();

    const { data: supplier, error } = await admin
      .from("suppliers")
      .select("id")
      .eq("upload_token", data.uploadToken)
      .maybeSingle();

    if (error || !supplier) {
      throw new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
    }

    const path = `${supplier.id}/${Date.now()}_${data.fileName}`;

    const { data: signed, error: signError } = await admin.storage
      .from("supplier-documents")
      .createSignedUploadUrl(path);

    if (signError || !signed) {
      throw new Response(JSON.stringify({ error: "sign_failed", message: signError?.message }), {
        status: 502,
      });
    }

    return { path: signed.path, token: signed.token };
  });

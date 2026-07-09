import { getSupabaseAdmin } from "@/lib/supabase/server";
import { computeCO2e, type ExtractedDocument } from "@/lib/carbon-factors";

export class ExtractionError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    energy: {
      type: "object",
      properties: {
        value: { type: "number" },
        unit: { type: "string" },
        type: { type: "string" },
      },
      required: ["value", "unit", "type"],
    },
    materials: {
      type: "object",
      properties: {
        weightKg: { type: "number" },
        type: { type: "string" },
      },
      required: ["weightKg", "type"],
    },
    scope: { type: "string", enum: ["scope_1", "scope_2", "scope_3"] },
    ghgCategory: { type: "number" },
    isEstimated: { type: "boolean" },
    confidenceScore: { type: "number" },
  },
  required: ["isEstimated", "confidenceScore", "scope"],
} as const;

/**
 * Downloads a file from Supabase Storage, sends it to Gemini for structured
 * extraction, resolves the matching versioned emission_factors row, and
 * inserts the resulting emissions_data row. Used by both:
 *   - server-fns/audit-document.ts (authenticated buyer re-triggering an audit)
 *   - server-fns/submit-supplier-document.ts (anon supplier, token-authenticated)
 *
 * Callers are responsible for authorizing the request BEFORE calling this —
 * this function trusts supplierId completely.
 */
export async function extractAndInsertEmissions(params: {
  supplierId: string;
  storagePath: string;
}) {
  const admin = getSupabaseAdmin();
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error("[gemini-extraction] missing GEMINI_API_KEY env var");
    throw new ExtractionError(500, "missing_credentials", "GEMINI_API_KEY not configured.");
  }

  const { data: fileBlob, error: downloadError } = await admin.storage
    .from("supplier-documents")
    .download(params.storagePath);

  if (downloadError || !fileBlob) {
    console.error("[gemini-extraction] storage download failed", {
      path: params.storagePath,
      error: downloadError,
    });
    throw new ExtractionError(
      502,
      "storage_fetch_failed",
      downloadError?.message ?? "download failed",
    );
  }

  const buffer = new Uint8Array(await fileBlob.arrayBuffer());
  const mimeType = fileBlob.type || "application/pdf";
  let binary = "";
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
  const base64 = btoa(binary);

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "You are a CSRD Scope 1/2/3 auditor. Extract emissions-relevant data from " +
                  "this document (utility bill, fuel receipt, shipping manifest or invoice). " +
                  "Classify it as scope_1 (direct combustion/fleet fuel owned by the reporting " +
                  "entity), scope_2 (purchased electricity/heat), or scope_3 (everything else " +
                  "in the value chain — most supplier documents are scope_3). If scope_3, set " +
                  "ghgCategory to the best-matching GHG Protocol category (1=purchased goods, " +
                  "4=upstream transport, 6=business travel, etc). Set isEstimated=true only " +
                  "when values are inferred rather than explicitly stated. confidenceScore is 0-1.",
              },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.1,
        },
      }),
    },
  );

  if (!geminiRes.ok) {
    const detail = await geminiRes.text();
    console.error("[gemini-extraction] Gemini API call failed", {
      status: geminiRes.status,
      statusText: geminiRes.statusText,
      detail,
    });
    throw new ExtractionError(502, "gemini_failed", detail);
  }

  const geminiJson = (await geminiRes.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

  let extracted: ExtractedDocument & {
    scope: "scope_1" | "scope_2" | "scope_3";
    ghgCategory?: number;
  };
  try {
    extracted = JSON.parse(text);
  } catch {
    console.error("[gemini-extraction] failed to parse Gemini JSON response", { text });
    throw new ExtractionError(502, "gemini_parse_failed", text);
  }

  const factorKey = extracted.energy
    ? `energy:${extracted.energy.type.toLowerCase().replace(/[^a-z0-9]/g, "_")}`
    : extracted.materials
      ? `material:${extracted.materials.type.toLowerCase().replace(/[^a-z0-9]/g, "_")}`
      : null;

  let emissionFactorId: string | null = null;
  if (factorKey) {
    const { data: factorRow } = await admin
      .from("emission_factors")
      .select("id")
      .eq("factor_key", factorKey)
      .is("valid_to", null)
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    emissionFactorId = factorRow?.id ?? null;
  }

  const co2e = computeCO2e(extracted);

  const { data: inserted, error: insertError } = await admin
    .from("emissions_data")
    .insert({
      supplier_id: params.supplierId,
      file_path: params.storagePath,
      extracted,
      co2e_kg: co2e.totalKg,
      factor_used: co2e.factorUsed,
      emission_factor_id: emissionFactorId,
      scope: extracted.scope ?? "scope_3",
      ghg_category: extracted.scope === "scope_3" ? (extracted.ghgCategory ?? 1) : null,
      confidence_score: extracted.confidenceScore ?? 0,
      is_estimated: extracted.isEstimated ?? false,
    })
    .select()
    .single();

  if (insertError) {
    console.error("[gemini-extraction] emissions_data insert failed", {
      supplierId: params.supplierId,
      error: insertError,
    });
    throw new ExtractionError(502, "insert_failed", insertError.message);
  }

  // First successful document flips the supplier out of PENDING.
  await admin
    .from("suppliers")
    .update({ status: "UPLOADED" })
    .eq("id", params.supplierId)
    .eq("status", "PENDING");

  return { extracted, co2e, row: inserted };
}

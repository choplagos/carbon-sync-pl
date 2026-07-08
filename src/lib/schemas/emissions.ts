import { z } from "zod";

// Shared between src/routes/api/*.server.ts (.inputValidator) and any
// React Hook Form resolver on the client — import this one file from both
// sides so validation rules never diverge.

export const auditDocumentSchema = z.object({
  companyId: z.string().uuid(),
  supplierId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
});
export type AuditDocumentInput = z.infer<typeof auditDocumentSchema>;

// Used by the anonymous supplier upload portal (src/routes/upload.tsx).
// Authenticated by possession of the supplier's upload_token, NOT by a
// Supabase Auth session — suppliers never sign in.
export const submitSupplierDocumentSchema = z.object({
  uploadToken: z.string().min(16).max(128),
  storagePath: z.string().min(1).max(500),
});
export type SubmitSupplierDocumentInput = z.infer<typeof submitSupplierDocumentSchema>;

export const getSupplierUploadUrlSchema = z.object({
  uploadToken: z.string().min(16).max(128),
  fileName: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9._-]+$/, "File name contains characters that aren't allowed."),
});
export type GetSupplierUploadUrlInput = z.infer<typeof getSupplierUploadUrlSchema>;

export const createCompanySchema = z.object({
  name: z.string().min(2).max(200),
  domain: z.string().max(255).optional(),
  vat: z.string().max(50).optional(),
  fiscalYear: z.number().int().min(2000).max(2100).optional(),
  reportingStandard: z.string().max(50).default("ESRS E1"),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const generateReportSnapshotSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int().min(2000).max(2100),
  reportingStandard: z.string().max(50).default("ESRS E1"),
});
export type GenerateReportSnapshotInput = z.infer<typeof generateReportSnapshotSchema>;

export const finalizeReportSchema = z.object({
  companyId: z.string().uuid(),
  reportId: z.string().uuid(),
});
export type FinalizeReportInput = z.infer<typeof finalizeReportSchema>;

export const correctEmissionSchema = z.object({
  companyId: z.string().uuid(),
  emissionId: z.string().uuid(),
  overrideCo2eKg: z
    .number()
    .positive()
    .max(10_000_000, "Value exceeds 10,000 t CO2e — check units before overriding."),
  overrideReason: z
    .string()
    .min(10, "Provide at least a short justification (min. 10 characters) for the audit trail.")
    .max(1000),
});
export type CorrectEmissionInput = z.infer<typeof correctEmissionSchema>;

export const inviteSupplierSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(2).max(200),
  contactEmail: z.string().email(),
  country: z.string().length(2, "Use ISO 3166-1 alpha-2, e.g. 'DE', 'NL'."),
  category: z.string().min(2).max(100),
});
export type InviteSupplierInput = z.infer<typeof inviteSupplierSchema>;

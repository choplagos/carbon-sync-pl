-- 0003_signed_upload_urls.sql
-- The original anon insert policy on storage.objects allowed ANY anonymous
-- request to write to ANY path in the supplier-documents bucket, with no
-- relationship to a real upload_token. Uploads now go through
-- POST /submitSupplierDocument's sibling getSupplierUploadUrl, which
-- generates a short-lived signed URL scoped to {supplierId}/... using the
-- service role — so storage.objects no longer needs a permissive anon
-- INSERT policy at all.

drop policy if exists "anon can upload supplier docs" on storage.objects;

-- No replacement anon INSERT policy is created. Uploads happen exclusively
-- via signed upload URLs minted server-side (bypasses RLS by design, same
-- trust boundary as any other service-role-issued credential).

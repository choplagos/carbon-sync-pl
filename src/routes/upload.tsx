import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import { z } from "zod";
import {
  UploadCloud,
  FileText,
  X,
  Check,
  ShieldCheck,
  Terminal,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getSupplierUploadUrl } from "@/lib/server-fns/get-supplier-upload-url";
import { submitSupplierDocument } from "@/lib/server-fns/submit-supplier-document";

const searchSchema = z.object({
  supplierId: z.string().optional(),
});

export const Route = createFileRoute("/upload")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Secure Document Upload · Carbon Terminal" },
      { name: "description", content: "Upload utility bills, receipts and manifests." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UploadPortal,
});

type SupplierInfo = {
  id: string;
  name: string;
  country: string | null;
  category: string | null;
  status: "PENDING" | "UPLOADED" | "AUDITED";
};

type FileItem = {
  id: string;
  file: File;
  progress: number;
  status: "uploading" | "processing" | "audited" | "error";
  co2eKg?: number;
  confidence?: number;
  errorMessage?: string;
};

function UploadPortal() {
  // supplierId in the URL is actually the upload_token, kept as a search
  // param name for backwards compatibility with existing invite links.
  const { supplierId: uploadToken } = Route.useSearch();

  const [supplier, setSupplier] = useState<SupplierInfo | null>(null);
  const [lookupState, setLookupState] = useState<"loading" | "found" | "invalid">(
    uploadToken ? "loading" : "invalid",
  );
  const [items, setItems] = useState<FileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!uploadToken) {
      setLookupState("invalid");
      return;
    }
    let cancelled = false;
    supabaseBrowser
      .rpc("get_supplier_by_token", { _token: uploadToken })
      .then(({ data, error }) => {
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        if (error || !row) {
          setLookupState("invalid");
          return;
        }
        setSupplier(row as SupplierInfo);
        setLookupState("found");
      });
    return () => {
      cancelled = true;
    };
  }, [uploadToken]);

  const processFile = useCallback(
    async (fileItemId: string, file: File) => {
      if (!uploadToken) return;
      try {
        // 1. Get a signed, path-scoped upload URL for this supplier.
        const { path, token } = await getSupplierUploadUrl({
          data: { uploadToken, fileName: file.name },
        });

        // 2. Upload directly to Storage using the signed URL.
        setItems((prev) => prev.map((x) => (x.id === fileItemId ? { ...x, progress: 25 } : x)));
        const { error: uploadError } = await supabaseBrowser.storage
          .from("supplier-documents")
          .uploadToSignedUrl(path, token, file);

        if (uploadError) throw new Error(uploadError.message);

        setItems((prev) =>
          prev.map((x) => (x.id === fileItemId ? { ...x, progress: 60, status: "processing" } : x)),
        );

        // 3. Trigger Gemini extraction + emissions_data insert.
        const result = await submitSupplierDocument({
          data: { uploadToken, storagePath: path },
        });

        // Validate BEFORE calling setItems — reading result.co2e.totalKg
        // inside the updater callback below would throw during React's
        // render phase, outside this try/catch, crashing the whole page
        // instead of being caught here.
        if (!result?.co2e || !result?.extracted) {
          throw new Error(
            "Unexpected response from server — document may not have processed correctly.",
          );
        }
        const co2eKg = result.co2e.totalKg;
        const confidence = result.extracted.confidenceScore;

        setItems((prev) =>
          prev.map((x) =>
            x.id === fileItemId
              ? { ...x, progress: 100, status: "audited", co2eKg, confidence }
              : x,
          ),
        );
        toast.success(`${file.name} audited`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        setItems((prev) =>
          prev.map((x) =>
            x.id === fileItemId ? { ...x, status: "error", errorMessage: message } : x,
          ),
        );
        toast.error(`${file.name}: ${message}`);
      }
    },
    [uploadToken],
  );

  const accept = useCallback(
    (fileList: FileList | File[]) => {
      const all = Array.from(fileList);
      const arr = all.filter(
        (f) =>
          /\.(pdf|jpe?g|png|webp|heic|heif|tiff?|csv|xlsx?)$/i.test(f.name) ||
          f.type === "application/pdf" ||
          f.type.startsWith("image/"),
      );
      const oversized = arr.filter((f) => f.size > 20 * 1024 * 1024);
      const rejected = all.length - arr.length + oversized.length;
      const accepted = arr.filter((f) => f.size <= 20 * 1024 * 1024);
      if (rejected > 0) {
        toast.error(
          `${rejected} file${rejected > 1 ? "s" : ""} skipped — PDF/image/spreadsheet, max 20MB`,
        );
      }
      if (accepted.length === 0) return;

      const stamp = Date.now();
      const next: FileItem[] = accepted.map((f, i) => ({
        id: `${stamp}_${i}_${f.name}_${Math.random().toString(16).slice(2, 6)}`,
        file: f,
        progress: 0,
        status: "uploading" as const,
      }));
      setItems((prev) => [...prev, ...next]);
      next.forEach((it) => processFile(it.id, it.file));
    },
    [processFile],
  );

  if (lookupState === "loading") {
    return (
      <div className="min-h-screen grid place-items-center bg-background bg-grid font-mono">
        <Loader2 className="h-6 w-6 text-amber animate-spin" />
      </div>
    );
  }

  if (lookupState === "invalid" || !supplier) {
    return (
      <div className="min-h-screen grid place-items-center bg-background bg-grid font-mono px-4">
        <div className="max-w-md border border-border bg-card p-6 text-center">
          <div className="text-red text-xs uppercase tracking-widest">ERR · 401 UNAUTHORIZED</div>
          <h1 className="mt-2 text-lg font-semibold">Invalid or missing invitation</h1>
          <p className="text-xs text-dim mt-2">
            This portal requires a signed invitation link generated by your corporate client. Please
            request a new link from your buyer contact.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background bg-grid font-mono">
      <header className="border-b border-border bg-surface-1">
        <div className="max-w-3xl mx-auto px-6 h-12 flex items-center gap-3">
          <Terminal className="h-4 w-4 text-amber" />
          <span className="text-amber font-bold tracking-wider text-sm">CARBON.TERMINAL</span>
          <span className="text-dim text-xs">/ SECURE UPLOAD PORTAL</span>
          <div className="ml-auto text-xs flex items-center gap-2 text-green">
            <ShieldCheck className="h-3.5 w-3.5" /> TLS 1.3 · AES-256
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div className="border border-border bg-card p-5">
          <div className="text-[10px] uppercase tracking-widest text-dim">
            Requesting evidence from
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-8 w-8 grid place-items-center bg-terminal-amber/15 border border-terminal-amber/40 text-amber font-bold">
              {supplier.name.slice(0, 1)}
            </div>
            <div>
              <div className="font-semibold">{supplier.name}</div>
              <div className="text-xs text-dim">
                {supplier.category ?? "Uncategorized"} · {supplier.country ?? "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="border border-border bg-card p-5">
          <h2 className="text-sm uppercase tracking-widest text-foreground mb-1">
            Upload documents
          </h2>
          <p className="text-xs text-dim">
            Utility bills, fuel receipts, shipping manifests or invoices. PDF or JPEG · Max 20MB per
            file · Files are encrypted and processed by AI to extract emissions data.
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) accept(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`mt-4 border-2 border-dashed p-10 grid place-items-center cursor-pointer transition-colors ${
              dragOver
                ? "border-terminal-amber bg-terminal-amber/5"
                : "border-border hover:border-terminal-amber/50 hover:bg-surface-1"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.tif,.tiff,.csv,.xls,.xlsx,application/pdf,image/*"
              multiple
              hidden
              onChange={(e) => e.target.files && accept(e.target.files)}
            />
            <div className="text-center">
              <UploadCloud className="h-10 w-10 text-amber mx-auto" />
              <div className="mt-3 text-sm">
                Drop files here or <span className="text-amber underline">browse</span>
              </div>
              <div className="text-[11px] text-dim mt-1">PDF · JPEG · encrypted upload</div>
            </div>
          </div>

          {items.length > 0 && (
            <ul className="mt-5 divide-y divide-border border border-border">
              {items.map((it) => (
                <li key={it.id} className="p-3 flex items-center gap-3 text-xs">
                  {it.status === "error" ? (
                    <AlertTriangle className="h-4 w-4 text-red shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-cyan shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="truncate text-foreground">{it.file.name}</span>
                      <span className="text-dim tabular-nums">
                        {(it.file.size / 1024).toFixed(0)} KB
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 bg-surface-2 relative overflow-hidden">
                      <div
                        className={`absolute inset-y-0 left-0 transition-all ${
                          it.status === "audited"
                            ? "bg-terminal-green"
                            : it.status === "error"
                              ? "bg-red"
                              : "bg-terminal-amber"
                        }`}
                        style={{ width: `${it.progress}%` }}
                      />
                    </div>
                    {it.status === "processing" && (
                      <div className="mt-1.5 text-[11px] text-amber flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> AI auditing document…
                      </div>
                    )}
                    {it.status === "audited" && it.co2eKg != null && (
                      <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                        <span className="text-green inline-flex items-center gap-1">
                          <Check className="h-3 w-3" /> Audited by Gemini 2.5 Pro
                        </span>
                        <span className="text-amber tabular-nums">
                          {new Intl.NumberFormat().format(Math.round(it.co2eKg))} kg CO₂e
                        </span>
                        <span className="text-dim tabular-nums">
                          conf {it.confidence?.toFixed(2)}
                        </span>
                      </div>
                    )}
                    {it.status === "error" && (
                      <div className="mt-1.5 text-[11px] text-red">{it.errorMessage}</div>
                    )}
                  </div>
                  <button
                    onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
                    className="text-dim hover:text-red"
                    aria-label="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="text-[10px] text-dim">
          By uploading, you confirm the documents relate to {supplier.name} and may be processed for
          CSRD compliance under Regulation (EU) 2022/2464. Data is retained only for the buyer's
          audit window.
        </div>
      </main>
    </div>
  );
}

import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCompany } from "@/lib/server-fns/create-company";

export function CreateCompanyForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [vat, setVat] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createCompany({
        data: { name, domain: domain || undefined, vat: vat || undefined },
      });
      toast.success("Company created");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background bg-grid font-mono px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md border border-border bg-card p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-amber">
          <Building2 className="h-4 w-4" />
          <span className="text-xs uppercase tracking-widest font-semibold">
            Set up your company
          </span>
        </div>
        <p className="text-xs text-dim">
          You're signed in but not yet linked to a company. Create one to get started — you'll be
          its owner.
        </p>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-dim">Company name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-9 bg-surface-1 border border-border px-3 text-sm outline-none focus:border-terminal-amber"
            placeholder="Aurelia Industrial Group SE"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-dim">
            Domain (optional)
          </label>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="w-full h-9 bg-surface-1 border border-border px-3 text-sm outline-none focus:border-terminal-amber"
            placeholder="aurelia-industrial.eu"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-dim">VAT (optional)</label>
          <input
            value={vat}
            onChange={(e) => setVat(e.target.value)}
            className="w-full h-9 bg-surface-1 border border-border px-3 text-sm outline-none focus:border-terminal-amber"
            placeholder="DE 812 415 990"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !name}
          className="w-full h-9 bg-terminal-amber text-primary-foreground text-xs font-bold uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create company"}
        </button>
      </form>
    </div>
  );
}

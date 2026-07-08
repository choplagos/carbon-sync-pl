import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Panel } from "@/components/layout/AppShell";
import { useCompany } from "@/lib/hooks/use-company";
import { supabaseBrowser } from "@/lib/supabase/client";
import { inviteSupplier } from "@/lib/server-fns/invite-supplier";
import { fmtNum } from "@/lib/format";
import { Copy, Send, Search, Plus, ExternalLink, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers · Carbon Terminal" },
      { name: "description", content: "Invite suppliers and track onboarding status." },
    ],
  }),
  component: () => (
    <AppShell>
      <SuppliersContent />
    </AppShell>
  ),
});

type SupplierStatus = "PENDING" | "UPLOADED" | "AUDITED";

type SupplierRow = {
  id: string;
  name: string;
  country: string | null;
  category: string | null;
  status: SupplierStatus;
  invited_at: string;
  upload_token: string;
};

const STATUS_TONE: Record<SupplierStatus, string> = {
  PENDING: "text-red bg-terminal-red/10 border-terminal-red/30",
  UPLOADED: "text-amber bg-terminal-amber/10 border-terminal-amber/30",
  AUDITED: "text-green bg-terminal-green/10 border-terminal-green/30",
};

function uploadUrl(token: string) {
  return typeof window === "undefined"
    ? `/upload?supplierId=${token}`
    : `${window.location.origin}/upload?supplierId=${token}`;
}

function SuppliersContent() {
  const { company } = useCompany();

  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"ALL" | SupplierStatus>("ALL");
  const [showInvite, setShowInvite] = useState(false);
  const [justInvited, setJustInvited] = useState<{ name: string; token: string } | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ["suppliers", company?.companyId],
    queryFn: async (): Promise<SupplierRow[]> => {
      const { data, error } = await supabaseBrowser
        .from("suppliers")
        .select("id, name, country, category, status, invited_at, upload_token")
        .eq("company_id", company!.companyId)
        .order("invited_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company,
  });

  const statsQuery = useQuery({
    queryKey: ["supplier-stats", company?.companyId],
    queryFn: async (): Promise<Record<string, { docs: number; kg: number }>> => {
      const { data, error } = await supabaseBrowser
        .from("emissions_data")
        .select("supplier_id, co2e_kg, override_co2e_kg");
      if (error) throw error;
      const stats: Record<string, { docs: number; kg: number }> = {};
      for (const row of data ?? []) {
        const s = (stats[row.supplier_id] ??= { docs: 0, kg: 0 });
        s.docs += 1;
        s.kg += row.override_co2e_kg ?? row.co2e_kg;
      }
      return stats;
    },
    enabled: !!company,
  });

  const suppliers = suppliersQuery.data ?? [];
  const stats = statsQuery.data ?? {};

  const rows = useMemo(() => {
    return (suppliersQuery.data ?? [])
      .filter((s) => (filter === "ALL" ? true : s.status === filter))
      .filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  }, [suppliersQuery.data, q, filter]);

  if (!company) return null; // AppShell already gates this; guard for TS only.

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Link copied to clipboard");
  };

  const handleInvite = async (
    name: string,
    contactEmail: string,
    country: string,
    category: string,
  ) => {
    try {
      const result = await inviteSupplier({
        data: { companyId: company.companyId, name, contactEmail, country, category },
      });
      setJustInvited({ name: result.supplier.name, token: result.supplier.upload_token });
      toast.success(`Invitation generated for ${name}`);
      queryClient.invalidateQueries({ queryKey: ["suppliers", company.companyId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to invite supplier");
    }
  };

  return (
    <>
      <div className="p-4 space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] text-dim uppercase tracking-widest">
              [F2] Supplier network
            </div>
            <h1 className="text-lg font-semibold mt-1">Onboarding & Emissions Ledger</h1>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-terminal-amber text-primary-foreground text-xs font-bold uppercase tracking-widest hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Invite supplier
          </button>
        </div>

        <Panel
          title="Suppliers"
          code="F2"
          right={
            <>
              <div className="flex items-center gap-1 border border-border px-2 h-6 bg-input">
                <Search className="h-3 w-3 text-dim" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="filter…"
                  className="bg-transparent outline-none text-xs w-40 text-foreground placeholder:text-dim"
                />
              </div>
              <div className="flex text-[10px] uppercase">
                {(["ALL", "PENDING", "UPLOADED", "AUDITED"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    className={`px-2 h-6 border border-border -ml-px tracking-widest ${
                      filter === s ? "bg-surface-2 text-amber" : "text-dim hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          }
        >
          {suppliersQuery.isLoading ? (
            <div className="p-6 grid place-items-center">
              <Loader2 className="h-4 w-4 text-amber animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-xs text-dim">
              {suppliers.length === 0
                ? 'No suppliers yet. Click "Invite supplier" to add your first one.'
                : "No suppliers match this filter."}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-dim uppercase text-[10px] tracking-widest">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 font-normal w-8">#</th>
                  <th className="text-left px-3 py-2 font-normal">Supplier</th>
                  <th className="text-left px-3 py-2 font-normal">Country</th>
                  <th className="text-left px-3 py-2 font-normal">Category</th>
                  <th className="text-left px-3 py-2 font-normal">Invited</th>
                  <th className="text-right px-3 py-2 font-normal">Docs</th>
                  <th className="text-right px-3 py-2 font-normal">CO₂e (kg)</th>
                  <th className="text-center px-3 py-2 font-normal">Status</th>
                  <th className="text-right px-3 py-2 font-normal">Upload link</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={s.id} className="border-b border-border hover:bg-surface-1">
                    <td className="px-3 py-2 text-dim tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-[10px] text-dim">{s.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-3 py-2 text-cyan">{s.country ?? "—"}</td>
                    <td className="px-3 py-2 text-dim">{s.category ?? "—"}</td>
                    <td className="px-3 py-2 text-dim tabular-nums">
                      {new Date(s.invited_at).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{stats[s.id]?.docs ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber">
                      {fmtNum(stats[s.id]?.kg ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-block px-1.5 py-0.5 border text-[10px] tracking-widest ${STATUS_TONE[s.status]}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => copy(uploadUrl(s.upload_token))}
                        className="inline-flex items-center gap-1 text-cyan hover:text-amber"
                      >
                        <Copy className="h-3 w-3" />
                        <span className="font-mono">{s.upload_token.slice(0, 14)}…</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {showInvite && (
        <InviteModal
          onClose={() => {
            setShowInvite(false);
            setJustInvited(null);
          }}
          invited={justInvited}
          onInvite={handleInvite}
        />
      )}
    </>
  );
}

function InviteModal({
  onClose,
  onInvite,
  invited,
}: {
  onClose: () => void;
  onInvite: (name: string, email: string, country: string, category: string) => Promise<void>;
  invited: { name: string; token: string } | null;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-border bg-card font-mono">
        <div className="h-8 border-b border-border bg-surface-1 flex items-center px-3">
          <span className="text-[10px] text-amber font-bold mr-3">M1</span>
          <span className="text-xs uppercase tracking-widest">Invite Supplier</span>
          <button onClick={onClose} className="ml-auto text-dim hover:text-foreground text-xs">
            ESC
          </button>
        </div>
        {!invited ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name || !email || country.length !== 2 || !category) return;
              setSubmitting(true);
              try {
                await onInvite(name, email, country.toUpperCase(), category);
              } finally {
                setSubmitting(false);
              }
            }}
            className="p-4 space-y-3 text-xs"
          >
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-dim">
                Supplier company
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-input border border-border px-2 h-8 outline-none focus:border-terminal-amber"
                placeholder="e.g. Provence Textiles SAS"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-dim">
                Contact email
              </label>
              <input
                value={email}
                type="email"
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-input border border-border px-2 h-8 outline-none focus:border-terminal-amber"
                placeholder="ops@supplier.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-dim">
                  Country (ISO-2)
                </label>
                <input
                  value={country}
                  maxLength={2}
                  onChange={(e) => setCountry(e.target.value.toUpperCase())}
                  className="w-full bg-input border border-border px-2 h-8 outline-none focus:border-terminal-amber uppercase"
                  placeholder="FR"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-dim">Category</label>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-input border border-border px-2 h-8 outline-none focus:border-terminal-amber"
                  placeholder="Textiles"
                />
              </div>
            </div>
            <div className="pt-2 flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-3 h-8 bg-terminal-amber text-primary-foreground text-[10px] font-bold uppercase tracking-widest disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <Send className="h-3 w-3" /> Generate secure link
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 h-8 border border-border text-[10px] uppercase tracking-widest text-dim hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="p-4 space-y-3 text-xs">
            <div className="flex items-center gap-2 text-green">
              <Check className="h-4 w-4" /> Invitation ready for {invited.name}
            </div>
            <div className="text-dim text-[11px]">
              Share this one-time URL with your supplier contact. It grants unauthenticated document
              upload access, scoped to this supplier only.
            </div>
            <div className="border border-border bg-surface-1 p-2 flex items-center gap-2 break-all">
              <ExternalLink className="h-3 w-3 text-cyan shrink-0" />
              <code className="text-cyan text-[11px]">{uploadUrl(invited.token)}</code>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(uploadUrl(invited.token));
                  toast.success("Link copied");
                }}
                className="inline-flex items-center gap-2 px-3 h-8 bg-terminal-amber text-primary-foreground text-[10px] font-bold uppercase tracking-widest"
              >
                <Copy className="h-3 w-3" /> Copy link
              </button>
              <a
                href={uploadUrl(invited.token)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 h-8 border border-border text-[10px] uppercase tracking-widest text-cyan hover:text-amber"
              >
                <ExternalLink className="h-3 w-3" /> Preview portal
              </a>
              <button
                onClick={onClose}
                className="ml-auto px-3 h-8 border border-border text-[10px] uppercase tracking-widest text-dim hover:text-foreground"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

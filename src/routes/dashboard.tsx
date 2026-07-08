import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Panel, Metric } from "@/components/layout/AppShell";
import { useCompany } from "@/lib/hooks/use-company";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtKg, fmtNum } from "@/lib/format";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Overview · Carbon Terminal" },
      { name: "description", content: "Aggregated Scope 3 CO2e across the supply chain." },
    ],
  }),
  component: () => (
    <AppShell>
      <DashboardContent />
    </AppShell>
  ),
});

type SupplierRow = {
  id: string;
  name: string;
  category: string | null;
  status: "PENDING" | "UPLOADED" | "AUDITED";
};

type EmissionRow = {
  id: string;
  supplier_id: string;
  file_path: string;
  extracted: { energy?: { type: string }; materials?: { type: string } } | null;
  co2e_kg: number;
  override_co2e_kg: number | null;
  confidence_score: number;
  is_estimated: boolean;
  scope: "scope_1" | "scope_2" | "scope_3";
  created_at: string;
};

function effectiveKg(r: Pick<EmissionRow, "co2e_kg" | "override_co2e_kg">) {
  return r.override_co2e_kg ?? r.co2e_kg;
}

function docType(r: EmissionRow) {
  return r.extracted?.energy
    ? `energy:${r.extracted.energy.type}`
    : r.extracted?.materials
      ? `material:${r.extracted.materials.type}`
      : "unclassified";
}

function fileName(path: string) {
  const parts = path.split("/");
  const last = parts[parts.length - 1] ?? path;
  // strip the "{timestamp}_" prefix added by getSupplierUploadUrl
  return last.replace(/^\d+_/, "");
}

function DashboardContent() {
  const { company } = useCompany();

  const suppliersQuery = useQuery({
    queryKey: ["dashboard-suppliers", company?.companyId],
    queryFn: async (): Promise<SupplierRow[]> => {
      const { data, error } = await supabaseBrowser
        .from("suppliers")
        .select("id, name, category, status")
        .eq("company_id", company!.companyId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company,
  });

  const emissionsQuery = useQuery({
    queryKey: ["dashboard-emissions", company?.companyId],
    queryFn: async (): Promise<EmissionRow[]> => {
      // RLS (members read emissions for their suppliers) already scopes
      // this to the caller's company — no explicit company_id filter needed
      // or possible, since emissions_data has no direct company_id column.
      const { data, error } = await supabaseBrowser
        .from("emissions_data")
        .select(
          "id, supplier_id, file_path, extracted, co2e_kg, override_co2e_kg, confidence_score, is_estimated, scope, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company,
  });

  if (!company) return null; // AppShell already gates this; guard for TS only.

  if (suppliersQuery.isLoading || emissionsQuery.isLoading) {
    return (
      <div className="p-4 grid place-items-center h-64">
        <Loader2 className="h-5 w-5 text-amber animate-spin" />
      </div>
    );
  }

  const suppliers = suppliersQuery.data ?? [];
  const emissions = emissionsQuery.data ?? [];
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const audited = suppliers.filter((s) => s.status === "AUDITED");
  const uploaded = suppliers.filter((s) => s.status === "UPLOADED");
  const auditedPct =
    suppliers.length > 0 ? Math.round((audited.length / suppliers.length) * 100) : 0;

  const scope3Total = emissions
    .filter((e) => e.scope === "scope_3")
    .reduce((a, e) => a + effectiveKg(e), 0);

  const estimatedKg = emissions.reduce((a, e) => a + (e.is_estimated ? effectiveKg(e) : 0), 0);
  const totalKg = emissions.reduce((a, e) => a + effectiveKg(e), 0);
  const estimatedRatio = totalKg > 0 ? (estimatedKg / totalKg) * 100 : 0;

  const avgConfidence =
    emissions.length > 0
      ? emissions.reduce((a, e) => a + (e.confidence_score ?? 0), 0) / emissions.length
      : 0;

  const byCategory = Object.entries(
    emissions.reduce<Record<string, number>>((acc, e) => {
      const cat = supplierById.get(e.supplier_id)?.category ?? "Uncategorized";
      acc[cat] = (acc[cat] ?? 0) + effectiveKg(e);
      return acc;
    }, {}),
  )
    .map(([category, kg]) => ({ category, kg }))
    .sort((a, b) => b.kg - a.kg)
    .slice(0, 8);

  const now = new Date();
  const monthlyTrend = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const label = d.toLocaleString("en-US", { month: "short" });
    const scope3 =
      emissions
        .filter((e) => {
          const ed = new Date(e.created_at);
          return (
            e.scope === "scope_3" &&
            ed.getFullYear() === d.getFullYear() &&
            ed.getMonth() === d.getMonth()
          );
        })
        .reduce((a, e) => a + effectiveKg(e), 0) / 1000; // display in tonnes
    return { month: label, scope3: Math.round(scope3 * 10) / 10 };
  });

  const recent = emissions.slice(0, 6);

  return (
    <div className="p-4 space-y-4">
      {/* Header row */}
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] text-dim uppercase tracking-widest">
            [F1] Supply-chain Scope 3 · FY {company.fiscalYear}
          </div>
          <h1 className="text-lg font-semibold text-foreground mt-1">Emissions Overview</h1>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-dim">Reporting standard</span>
          <span className="text-amber font-semibold">{company.reportingStandard}</span>
        </div>
      </div>

      {/* Metrics strip */}
      <div className="grid grid-cols-5 border border-border bg-card">
        <Metric label="Total Scope 3 CO₂e" value={fmtKg(scope3Total)} tone="amber" />
        <Metric
          label="Suppliers tracked"
          value={String(suppliers.length)}
          sub={`${audited.length} audited · ${uploaded.length} pending review`}
        />
        <Metric
          label="Audit coverage"
          value={`${auditedPct}%`}
          sub="Target 90% by Q4"
          tone="green"
        />
        <Metric
          label="Documents processed"
          value={fmtNum(emissions.length)}
          sub={`Gemini 2.5 Pro · avg ${avgConfidence.toFixed(2)} conf.`}
          tone="cyan"
        />
        <Metric
          label="Est. data ratio"
          value={`${estimatedRatio.toFixed(1)}%`}
          sub="Aim <20% for materiality"
          tone={estimatedRatio > 20 ? "red" : "default"}
        />
      </div>

      {suppliers.length === 0 ? (
        <Panel title="Get started" code="F1">
          <div className="p-6 text-xs text-dim">
            No suppliers yet. Head to <span className="text-amber">Suppliers</span> to invite your
            first one and start collecting Scope 3 evidence.
          </div>
        </Panel>
      ) : (
        <>
          {/* Chart row */}
          <div className="grid grid-cols-3 gap-4">
            <Panel
              title="Monthly Scope 3 emissions (t CO₂e)"
              code="C1"
              className="col-span-2"
              right={<span className="text-dim">6M trailing</span>}
            >
              <div className="h-56 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyTrend}>
                    <defs>
                      <linearGradient id="amberFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--terminal-amber)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--terminal-amber)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="2 2" vertical={false} />
                    <XAxis
                      dataKey="month"
                      stroke="var(--terminal-dim)"
                      tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--grid)" }}
                    />
                    <YAxis
                      stroke="var(--terminal-dim)"
                      tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--grid)" }}
                      width={36}
                    />
                    <Tooltip
                      cursor={{ stroke: "var(--terminal-amber)", strokeDasharray: "2 2" }}
                      contentStyle={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 3,
                        fontFamily: "JetBrains Mono",
                        fontSize: 11,
                      }}
                      labelStyle={{ color: "var(--terminal-dim)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="scope3"
                      stroke="var(--terminal-amber)"
                      strokeWidth={1.5}
                      fill="url(#amberFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Emissions by category" code="C2">
              <div className="h-56 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCategory} layout="vertical" margin={{ left: 4, right: 8 }}>
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="2 2" horizontal={false} />
                    <XAxis
                      type="number"
                      stroke="var(--terminal-dim)"
                      tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--grid)" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="category"
                      stroke="var(--terminal-dim)"
                      tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--grid)" }}
                      width={90}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--surface-2)" }}
                      contentStyle={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 3,
                        fontFamily: "JetBrains Mono",
                        fontSize: 11,
                      }}
                    />
                    <Bar dataKey="kg" radius={0}>
                      {byCategory.map((_, i) => (
                        <Cell
                          key={i}
                          fill={
                            i === 0
                              ? "var(--terminal-amber)"
                              : i === 1
                                ? "var(--terminal-green)"
                                : "var(--terminal-cyan)"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          {/* Activity feed */}
          <Panel
            title="Live document ingestion"
            code="F4"
            right={<span className="text-dim">last 6</span>}
          >
            {recent.length === 0 ? (
              <div className="p-4 text-xs text-dim">No documents processed yet.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-dim uppercase text-[10px] tracking-widest">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 font-normal">Timestamp</th>
                    <th className="text-left px-3 py-2 font-normal">Supplier</th>
                    <th className="text-left px-3 py-2 font-normal">Document</th>
                    <th className="text-left px-3 py-2 font-normal">Type</th>
                    <th className="text-right px-3 py-2 font-normal">CO₂e (kg)</th>
                    <th className="text-right px-3 py-2 font-normal">Conf.</th>
                    <th className="text-right px-3 py-2 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="border-b border-border hover:bg-surface-1">
                      <td className="px-3 py-1.5 text-dim tabular-nums">
                        {new Date(r.created_at).toISOString().slice(0, 10)}
                      </td>
                      <td className="px-3 py-1.5 text-foreground">
                        {supplierById.get(r.supplier_id)?.name ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-cyan">{fileName(r.file_path)}</td>
                      <td className="px-3 py-1.5 text-dim">{docType(r)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber">
                        {fmtNum(effectiveKg(r))}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        <span className={r.confidence_score > 0.85 ? "text-green" : "text-amber"}>
                          {r.confidence_score.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {r.is_estimated ? (
                          <span className="text-red">EST</span>
                        ) : (
                          <span className="text-green">VERIFIED</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

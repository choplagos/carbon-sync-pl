import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Panel } from "@/components/layout/AppShell";
import { useCompany } from "@/lib/hooks/use-company";
import { supabaseBrowser } from "@/lib/supabase/client";
import { generateReportSnapshot } from "@/lib/server-fns/generate-report-snapshot";
import { finalizeReport } from "@/lib/server-fns/finalize-report";
import { fmtKg, fmtNum } from "@/lib/format";
import {
  Download,
  Printer,
  FileCheck2,
  Loader2,
  Lock,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "CSRD Report · Carbon Terminal" },
      { name: "description", content: "Audit-ready ESRS E1 Scope 3 disclosure." },
    ],
  }),
  component: () => (
    <AppShell>
      <ReportsContent />
    </AppShell>
  ),
});

type ReportSnapshot = {
  totalCO2eKg: number;
  scope1Kg: number;
  scope2Kg: number;
  scope3Kg: number;
  supplierCount: number;
  auditedCount: number;
  uploadedCount: number;
  pendingCount: number;
  documentCount: number;
  estimatedRatioPct: number;
  avgConfidence: number;
  categoryBreakdown: { category: string; kg: number; supplierCount: number; sharePct: number }[];
  countryBreakdown: { country: string; kg: number; sharePct: number }[];
  supplierLedger: {
    id: string;
    name: string;
    category: string | null;
    country: string | null;
    status: "PENDING" | "UPLOADED" | "AUDITED";
    docs: number;
    kg: number;
  }[];
  generatedAt: string;
};

type ReportRow = {
  id: string;
  status: "draft" | "final" | "submitted";
  snapshot: ReportSnapshot;
  generated_at: string;
  finalized_at: string | null;
};

function ReportsContent() {
  const { company } = useCompany();

  const queryClient = useQueryClient();
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const reportsQuery = useQuery({
    queryKey: ["reports", company?.companyId, company?.fiscalYear, company?.reportingStandard],
    queryFn: async (): Promise<ReportRow[]> => {
      const { data, error } = await supabaseBrowser
        .from("reports")
        .select("id, status, snapshot, generated_at, finalized_at")
        .eq("company_id", company!.companyId)
        .eq("fiscal_year", company!.fiscalYear)
        .eq("reporting_standard", company!.reportingStandard)
        .order("generated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReportRow[];
    },
    enabled: !!company,
  });

  // Live source (suppliers + emissions_data) — used whenever there's no
  // finalized report yet, so the preview always reflects current data.
  const suppliersQuery = useQuery({
    queryKey: ["report-suppliers", company?.companyId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("suppliers")
        .select("id, name, category, country, status")
        .eq("company_id", company!.companyId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company,
  });
  const emissionsQuery = useQuery({
    queryKey: ["report-emissions", company?.companyId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("emissions_data")
        .select("supplier_id, co2e_kg, override_co2e_kg, scope, is_estimated, confidence_score");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company,
  });

  const reports = reportsQuery.data ?? [];
  const finalReport = reports.find((r) => r.status === "final" || r.status === "submitted") ?? null;
  const draftReport = reports.find((r) => r.status === "draft") ?? null;

  const liveSnapshot: ReportSnapshot | null = useMemo(() => {
    if (finalReport) return null; // frozen data takes precedence, no need to compute
    const suppliers = suppliersQuery.data;
    const emissions = emissionsQuery.data;
    if (!suppliers || !emissions) return null;

    const effKg = (r: { co2e_kg: number; override_co2e_kg: number | null }) =>
      r.override_co2e_kg ?? r.co2e_kg;
    const totalCO2eKg = emissions.reduce((a, r) => a + effKg(r), 0);
    const kgBySupplier = new Map<string, number>();
    const docsBySupplier = new Map<string, number>();
    for (const r of emissions) {
      kgBySupplier.set(r.supplier_id, (kgBySupplier.get(r.supplier_id) ?? 0) + effKg(r));
      docsBySupplier.set(r.supplier_id, (docsBySupplier.get(r.supplier_id) ?? 0) + 1);
    }
    const categoryMap = new Map<string, { kg: number; supplierCount: number }>();
    const countryMap = new Map<string, number>();
    for (const s of suppliers) {
      const kg = kgBySupplier.get(s.id) ?? 0;
      const cat = s.category ?? "Uncategorized";
      const c = categoryMap.get(cat) ?? { kg: 0, supplierCount: 0 };
      c.kg += kg;
      c.supplierCount += 1;
      categoryMap.set(cat, c);
      const country = s.country ?? "—";
      countryMap.set(country, (countryMap.get(country) ?? 0) + kg);
    }
    const estimatedKg = emissions.filter((r) => r.is_estimated).reduce((a, r) => a + effKg(r), 0);
    const avgConfidence =
      emissions.length > 0
        ? emissions.reduce((a, r) => a + (r.confidence_score ?? 0), 0) / emissions.length
        : 0;

    return {
      totalCO2eKg,
      scope1Kg: emissions.filter((r) => r.scope === "scope_1").reduce((a, r) => a + effKg(r), 0),
      scope2Kg: emissions.filter((r) => r.scope === "scope_2").reduce((a, r) => a + effKg(r), 0),
      scope3Kg: emissions.filter((r) => r.scope === "scope_3").reduce((a, r) => a + effKg(r), 0),
      supplierCount: suppliers.length,
      auditedCount: suppliers.filter((s) => s.status === "AUDITED").length,
      uploadedCount: suppliers.filter((s) => s.status === "UPLOADED").length,
      pendingCount: suppliers.filter((s) => s.status === "PENDING").length,
      documentCount: emissions.length,
      estimatedRatioPct: totalCO2eKg > 0 ? (estimatedKg / totalCO2eKg) * 100 : 0,
      avgConfidence,
      categoryBreakdown: [...categoryMap.entries()]
        .map(([category, v]) => ({
          category,
          kg: v.kg,
          supplierCount: v.supplierCount,
          sharePct: totalCO2eKg > 0 ? (v.kg / totalCO2eKg) * 100 : 0,
        }))
        .sort((a, b) => b.kg - a.kg),
      countryBreakdown: [...countryMap.entries()]
        .map(([country, kg]) => ({
          country,
          kg,
          sharePct: totalCO2eKg > 0 ? (kg / totalCO2eKg) * 100 : 0,
        }))
        .sort((a, b) => b.kg - a.kg),
      supplierLedger: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        country: s.country,
        status: s.status,
        docs: docsBySupplier.get(s.id) ?? 0,
        kg: kgBySupplier.get(s.id) ?? 0,
      })),
      generatedAt: new Date().toISOString(),
    };
  }, [finalReport, suppliersQuery.data, emissionsQuery.data]);

  if (!company) return null; // AppShell already gates this; guard for TS only.

  const isFrozen = !!finalReport;
  const snapshot: ReportSnapshot | null = isFrozen ? finalReport!.snapshot : liveSnapshot;
  const loading =
    reportsQuery.isLoading || (!isFrozen && (suppliersQuery.isLoading || emissionsQuery.isLoading));

  async function handleGenerateDraft() {
    setGenerating(true);
    try {
      await generateReportSnapshot({
        data: {
          companyId: company!.companyId,
          fiscalYear: company!.fiscalYear,
          reportingStandard: company!.reportingStandard,
        },
      });
      toast.success("Draft snapshot saved");
      queryClient.invalidateQueries({ queryKey: ["reports", company!.companyId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate snapshot");
    } finally {
      setGenerating(false);
    }
  }

  async function handleFinalize() {
    if (!draftReport) return;
    if (
      !window.confirm(
        "Finalizing locks this report permanently — it can never be edited again. Continue?",
      )
    ) {
      return;
    }
    setFinalizing(true);
    try {
      await finalizeReport({ data: { companyId: company!.companyId, reportId: draftReport.id } });
      toast.success("Report finalized and locked");
      queryClient.invalidateQueries({ queryKey: ["reports", company!.companyId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to finalize report");
    } finally {
      setFinalizing(false);
    }
  }

  async function exportPdf() {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: "#0a0a0a",
        scale: 2,
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgW, imgH);
        heightLeft -= pageH;
      }
      pdf.save(`CSRD-Scope3-Report-FY${company!.fiscalYear}.pdf`);
    } finally {
      setExporting(false);
    }
  }

  if (loading || !snapshot) {
    return (
      <div className="p-4 grid place-items-center h-64">
        <Loader2 className="h-5 w-5 text-amber animate-spin" />
      </div>
    );
  }

  return (
    <div ref={reportRef} className="p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] text-dim uppercase tracking-widest">
            [F3] Disclosure · ESRS E1 §44-51
          </div>
          <h1 className="text-lg font-semibold mt-1">
            CSRD Scope 3 Report — FY {company.fiscalYear}
          </h1>
        </div>
        <div className="flex gap-2">
          {isFrozen ? (
            <span className="inline-flex items-center gap-2 px-3 h-8 border border-terminal-green/40 bg-terminal-green/10 text-green text-[10px] uppercase tracking-widest">
              <Lock className="h-3.5 w-3.5" /> Finalized {finalReport!.finalized_at?.slice(0, 10)}
            </span>
          ) : (
            <>
              <button
                onClick={handleGenerateDraft}
                disabled={generating}
                className="inline-flex items-center gap-2 px-3 h-8 border border-border text-[10px] uppercase tracking-widest text-foreground hover:bg-surface-2 disabled:opacity-60"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="h-3.5 w-3.5" />
                )}
                Save draft snapshot
              </button>
              {draftReport && (
                <button
                  onClick={handleFinalize}
                  disabled={finalizing}
                  className="inline-flex items-center gap-2 px-3 h-8 border border-terminal-amber/50 text-amber text-[10px] uppercase tracking-widest hover:bg-terminal-amber/10 disabled:opacity-60"
                >
                  {finalizing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                  Finalize & lock
                </button>
              )}
            </>
          )}
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-3 h-8 border border-border text-[10px] uppercase tracking-widest text-foreground hover:bg-surface-2"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          <button
            onClick={exportPdf}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-3 h-8 bg-terminal-amber text-primary-foreground text-[10px] font-bold uppercase tracking-widest hover:opacity-90 disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {exporting ? "Generating…" : "Download PDF"}
          </button>
        </div>
      </div>

      {!isFrozen && (
        <div className="text-[11px] text-amber border border-terminal-amber/30 bg-terminal-amber/5 px-3 py-2">
          This is a live preview — figures update as new documents are audited. Save a draft
          snapshot to record a point-in-time version, then finalize to permanently lock it for
          assurance sign-off.
        </div>
      )}

      {/* Cover header */}
      <div className="border border-border bg-card">
        <div className="grid grid-cols-4 divide-x divide-border">
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-dim">Reporting entity</div>
            <div className="mt-1 font-semibold">{company.companyName}</div>
            <div className="text-xs text-dim">{company.domain ?? "—"}</div>
          </div>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-dim">VAT / LEI</div>
            <div className="mt-1 font-mono">{company.vat ?? "—"}</div>
          </div>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-dim">Standard</div>
            <div className="mt-1 font-semibold">{company.reportingStandard}</div>
            <div className="text-xs text-dim">Directive 2022/2464/EU</div>
          </div>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-dim">Assurance</div>
            <div className="mt-1 text-amber font-semibold flex items-center gap-1">
              <FileCheck2 className="h-3.5 w-3.5" />{" "}
              {isFrozen ? "Locked (Art. 34a)" : "Draft — not yet locked"}
            </div>
          </div>
        </div>
      </div>

      {/* Section 1 */}
      <Panel title="§1  Emissions summary (Scope 1, 2 & 3)" code="R1">
        <div className="p-4 grid grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-dim">Total CO₂e</div>
            <div className="text-3xl font-bold tabular-nums text-amber mt-1">
              {fmtKg(snapshot.totalCO2eKg)}
            </div>
            <div className="text-xs text-dim mt-1 space-x-3">
              <span>S1 {fmtNum(snapshot.scope1Kg)} kg</span>
              <span>S2 {fmtNum(snapshot.scope2Kg)} kg</span>
              <span>S3 {fmtNum(snapshot.scope3Kg)} kg</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-dim">Methodology</div>
            <p className="text-xs mt-1 leading-relaxed text-foreground">
              Activity-based; supplier-primary data cross-referenced with DEFRA 2023 v3.1 conversion
              factors. AI-extracted metrics via Gemini 2.5 Pro (structured output).
            </p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-dim">Data quality</div>
            <div className="mt-1 space-y-1 text-xs">
              <Row
                label="Primary data"
                value={`${(100 - snapshot.estimatedRatioPct).toFixed(1)}%`}
                tone="green"
              />
              <Row
                label="Estimated"
                value={`${snapshot.estimatedRatioPct.toFixed(1)}%`}
                tone="amber"
              />
              <Row
                label="Suppliers audited"
                value={`${snapshot.auditedCount}/${snapshot.supplierCount}`}
                tone="cyan"
              />
              <Row label="Avg confidence" value={snapshot.avgConfidence.toFixed(2)} tone="green" />
            </div>
          </div>
        </div>
      </Panel>

      {/* Section 2 */}
      <div className="grid grid-cols-2 gap-4">
        <Panel title="§2  Breakdown by activity category" code="R2">
          {snapshot.categoryBreakdown.length === 0 ? (
            <div className="p-4 text-xs text-dim">No data yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-dim uppercase text-[10px] tracking-widest">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 font-normal">Category</th>
                  <th className="text-right px-3 py-2 font-normal">Suppliers</th>
                  <th className="text-right px-3 py-2 font-normal">CO₂e (kg)</th>
                  <th className="text-right px-3 py-2 font-normal">Share</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.categoryBreakdown.map((c) => (
                  <tr key={c.category} className="border-b border-border">
                    <td className="px-3 py-1.5">{c.category}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{c.supplierCount}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-amber">
                      {fmtNum(c.kg)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-16 h-1 bg-surface-2 relative">
                          <div
                            className="absolute inset-y-0 left-0 bg-terminal-amber"
                            style={{ width: `${c.sharePct}%` }}
                          />
                        </div>
                        {c.sharePct.toFixed(1)}%
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="§3  Geographic distribution" code="R3">
          {snapshot.countryBreakdown.length === 0 ? (
            <div className="p-4 text-xs text-dim">No data yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-dim uppercase text-[10px] tracking-widest">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 font-normal">Country</th>
                  <th className="text-right px-3 py-2 font-normal">CO₂e (kg)</th>
                  <th className="text-right px-3 py-2 font-normal">Share</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.countryBreakdown.map((c) => (
                  <tr key={c.country} className="border-b border-border">
                    <td className="px-3 py-1.5 text-cyan font-mono">{c.country}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-amber">
                      {fmtNum(c.kg)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-20 h-1 bg-surface-2 relative">
                          <div
                            className="absolute inset-y-0 left-0 bg-terminal-green"
                            style={{ width: `${c.sharePct}%` }}
                          />
                        </div>
                        {c.sharePct.toFixed(1)}%
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {/* Section 4 — supplier ledger */}
      <Panel title="§4  Supplier-level ledger (auditable evidence)" code="R4">
        {snapshot.supplierLedger.length === 0 ? (
          <div className="p-4 text-xs text-dim">No suppliers yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-dim uppercase text-[10px] tracking-widest">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">Supplier</th>
                <th className="text-left px-3 py-2 font-normal">Cat.</th>
                <th className="text-left px-3 py-2 font-normal">Country</th>
                <th className="text-right px-3 py-2 font-normal">Docs</th>
                <th className="text-right px-3 py-2 font-normal">CO₂e (kg)</th>
                <th className="text-right px-3 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.supplierLedger.map((s) => (
                <tr key={s.id} className="border-b border-border">
                  <td className="px-3 py-1.5">{s.name}</td>
                  <td className="px-3 py-1.5 text-dim">{s.category ?? "—"}</td>
                  <td className="px-3 py-1.5 text-cyan">{s.country ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.docs}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-amber">{fmtNum(s.kg)}</td>
                  <td className="px-3 py-1.5 text-right text-[10px] tracking-widest">
                    {s.status === "AUDITED" && <span className="text-green">AUDITED</span>}
                    {s.status === "UPLOADED" && <span className="text-amber">REVIEW</span>}
                    {s.status === "PENDING" && <span className="text-red">PENDING</span>}
                  </td>
                </tr>
              ))}
              <tr className="bg-surface-1 font-bold">
                <td className="px-3 py-2" colSpan={3}>
                  TOTAL
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{snapshot.documentCount}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber">
                  {fmtNum(snapshot.totalCO2eKg)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </Panel>

      <div className="text-[10px] text-dim px-1 pb-6">
        {isFrozen
          ? `Locked ${finalReport!.finalized_at?.slice(0, 10)} · Snapshot generated ${finalReport!.generated_at.slice(0, 10)}`
          : `Live preview generated ${new Date().toISOString().slice(0, 10)}`}{" "}
        · Carbon.Terminal v2.4.1 · Prepared for limited assurance under Article 34a of Directive
        2013/34/EU as amended by CSRD.
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: string }) {
  const cls = tone === "green" ? "text-green" : tone === "amber" ? "text-amber" : "text-cyan";
  return (
    <div className="flex items-center justify-between">
      <span className="text-dim">{label}</span>
      <span className={`font-mono tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users2,
  FileBarChart2,
  Terminal,
  CircleUser,
  Activity,
  Loader2,
  LogOut,
} from "lucide-react";
import { CompanyProvider, useCompany } from "@/lib/hooks/use-company";
import { CreateCompanyForm } from "@/components/auth/CreateCompanyForm";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "OVERVIEW", icon: LayoutDashboard, code: "F1" },
  { to: "/suppliers", label: "SUPPLIERS", icon: Users2, code: "F2" },
  { to: "/reports", label: "CSRD REPORT", icon: FileBarChart2, code: "F3" },
] as const;

function FullScreenLoader() {
  return (
    <div className="min-h-screen grid place-items-center bg-background bg-grid font-mono">
      <Loader2 className="h-6 w-6 text-amber animate-spin" />
    </div>
  );
}

/** Handles session/company gating, then renders the real shell + nav. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <CompanyProvider>
      <AppShellGated>{children}</AppShellGated>
    </CompanyProvider>
  );
}

function AppShellGated({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { session, sessionLoading, company, companyLoading, refetchCompany, userEmail } =
    useCompany();

  useEffect(() => {
    if (!sessionLoading && !session) {
      navigate({ to: "/auth" });
    }
  }, [sessionLoading, session, navigate]);

  if (sessionLoading || !session) return <FullScreenLoader />;
  if (companyLoading) return <FullScreenLoader />;
  if (!company) return <CreateCompanyForm onCreated={refetchCompany} />;

  return (
    <AppShellChrome company={company} userEmail={userEmail}>
      {children}
    </AppShellChrome>
  );
}

function AppShellChrome({
  children,
  company,
  userEmail,
}: {
  children: ReactNode;
  company: NonNullable<ReturnType<typeof useCompany>["company"]>;
  userEmail: string | null;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [ts, setTs] = useState("");
  useEffect(() => {
    const tick = () => setTs(new Date().toISOString().slice(0, 19).replace("T", " "));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground font-mono text-[13px]">
      {/* Top status bar */}
      <header className="h-9 border-b border-border bg-surface-1 flex items-center px-3 gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-amber" />
          <span className="text-amber font-bold tracking-wider">CARBON.TERMINAL</span>
          <span className="text-dim">v2.4.1</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <span className="text-dim uppercase text-xs">BUYER</span>
        <span className="text-foreground">{company.companyName}</span>
        {company.vat && (
          <>
            <span className="text-dim">·</span>
            <span className="text-dim">VAT {company.vat}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-terminal-green animate-pulse" />
            <span className="text-green">LIVE</span>
          </div>
          <span className="text-dim">FY {company.fiscalYear}</span>
          <span className="text-dim tabular-nums">{ts} UTC</span>
          <div className="flex items-center gap-1.5 text-foreground">
            <CircleUser className="h-3.5 w-3.5" />
            <span>{userEmail}</span>
          </div>
          <button
            onClick={() => supabaseBrowser.auth.signOut()}
            className="text-dim hover:text-red"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-56 border-r border-border bg-sidebar shrink-0 flex flex-col">
          <nav className="p-2 space-y-0.5">
            {NAV.map((item) => {
              const active = path.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-sm transition-colors",
                    active
                      ? "bg-surface-2 text-amber border-l-2 border-terminal-amber -ml-px pl-[9px]"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-xs tracking-wider">{item.label}</span>
                  <span className="ml-auto text-[10px] text-dim">{item.code}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto p-3 border-t border-sidebar-border space-y-2">
            <div className="text-[10px] text-dim uppercase tracking-widest">System</div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-dim">Gemini</span>
              <span className="text-green flex items-center gap-1">
                <Activity className="h-3 w-3" /> READY
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-dim">Storage</span>
              <span className="text-green">OK</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-dim">DEFRA 2023</span>
              <span className="text-amber">v3.1</span>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

export function Panel({
  title,
  code,
  right,
  children,
  className,
}: {
  title: string;
  code?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border border-border bg-card", className)}>
      <header className="flex items-center gap-3 px-3 h-8 border-b border-border bg-surface-1">
        {code && <span className="text-[10px] text-amber font-bold">{code}</span>}
        <h2 className="text-xs font-semibold tracking-widest text-foreground uppercase">{title}</h2>
        <div className="ml-auto flex items-center gap-3 text-xs">{right}</div>
      </header>
      <div>{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "amber" | "green" | "red" | "cyan";
}) {
  const toneCls =
    tone === "amber"
      ? "text-amber"
      : tone === "green"
        ? "text-green"
        : tone === "red"
          ? "text-red"
          : tone === "cyan"
            ? "text-cyan"
            : "text-foreground";
  return (
    <div className="p-3 border-r border-border last:border-r-0">
      <div className="text-[10px] uppercase tracking-widest text-dim">{label}</div>
      <div className={cn("mt-2 text-2xl font-bold tabular-nums", toneCls)}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-dim tabular-nums">{sub}</div>}
    </div>
  );
}

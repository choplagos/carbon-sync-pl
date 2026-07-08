import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

export interface CompanyInfo {
  companyId: string;
  companyName: string;
  domain: string | null;
  vat: string | null;
  fiscalYear: number;
  reportingStandard: string;
  role: "owner" | "admin" | "analyst" | "auditor_readonly";
}

/** Tracks the Supabase Auth session client-side, including sign-out/refresh. */
function useSession() {
  // undefined = not yet resolved, null = resolved and signed out
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabaseBrowser.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // Session identity changed (login/logout/user switch) — drop any
      // cached company/emissions data tied to the previous user.
      queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  return session;
}

async function fetchCompanyForUser(userId: string): Promise<CompanyInfo | null> {
  const { data, error } = await supabaseBrowser
    .from("company_members")
    .select("role, companies(id, name, domain, vat, fiscal_year, reporting_standard)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error || !data || !data.companies) return null;
  // supabase-js types this join as an array in some generated-types setups;
  // handle both shapes defensively since we aren't using generated types yet.
  const c = Array.isArray(data.companies) ? data.companies[0] : data.companies;
  if (!c) return null;

  return {
    companyId: c.id,
    companyName: c.name,
    domain: c.domain,
    vat: c.vat,
    fiscalYear: c.fiscal_year,
    reportingStandard: c.reporting_standard,
    role: data.role,
  };
}

interface CompanyContextValue {
  session: Session | null | undefined;
  sessionLoading: boolean;
  userEmail: string | null;
  company: CompanyInfo | null;
  companyLoading: boolean;
  refetchCompany: () => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const sessionLoading = session === undefined;
  const userId = session?.user?.id;

  const query = useQuery({
    queryKey: ["company-membership", userId],
    queryFn: () => fetchCompanyForUser(userId!),
    enabled: !!userId,
  });

  const value: CompanyContextValue = {
    session,
    sessionLoading,
    userEmail: session?.user?.email ?? null,
    company: query.data ?? null,
    companyLoading: !!userId && query.isLoading,
    refetchCompany: () => query.refetch(),
  };

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

/** Must be called under <CompanyProvider> (AppShell provides it). */
export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error("useCompany() must be used within <CompanyProvider> (rendered by AppShell).");
  }
  return ctx;
}

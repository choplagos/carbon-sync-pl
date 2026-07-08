import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Terminal, Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Carbon Terminal" },
      { name: "description", content: "Buyer sign-in for the CSRD carbon compliance platform." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "signin") {
        const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
        if (error) {
          toast.error(error.message);
          return;
        }
      } else {
        const { error } = await supabaseBrowser.auth.signUp({ email, password });
        if (error) {
          toast.error(error.message);
          return;
        }
        toast.success("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
        return;
      }
      navigate({ to: "/dashboard" });
    } finally {
      setSubmitting(false);
    }
  };

  const signInWithGoogle = async () => {
    const { error } = await supabaseBrowser.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) toast.error(error.message);
  };

  return (
    <div className="min-h-screen bg-background bg-grid font-mono flex flex-col">
      <header className="border-b border-border bg-surface-1">
        <div className="max-w-md mx-auto px-6 h-12 flex items-center gap-2">
          <Terminal className="h-4 w-4 text-amber" />
          <span className="text-amber font-bold tracking-wider text-sm">CARBON.TERMINAL</span>
          <span className="text-dim text-xs ml-auto">v2.4.1</span>
        </div>
      </header>

      <main className="flex-1 grid place-items-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="text-[10px] uppercase tracking-widest text-dim">
              Buyer console · CSRD Scope 3
            </div>
            <h1 className="text-xl font-semibold mt-1">
              {mode === "signin" ? "Sign in to your account" : "Create buyer account"}
            </h1>
            <p className="text-xs text-dim mt-1">
              Access aggregated Scope 3 metrics and generate CSRD reports.
            </p>
          </div>

          <div className="border border-border bg-card">
            <div className="h-8 border-b border-border bg-surface-1 flex items-center px-3">
              <span className="text-[10px] text-amber font-bold mr-3">A1</span>
              <span className="text-xs uppercase tracking-widest">Authentication</span>
              <span className="ml-auto text-[10px] text-dim">ISO 27001 · SOC 2</span>
            </div>

            <div className="p-5 space-y-4">
              <button
                onClick={signInWithGoogle}
                className="w-full h-9 border border-border hover:bg-surface-1 flex items-center justify-center gap-2 text-xs uppercase tracking-widest"
              >
                <GoogleIcon className="h-3.5 w-3.5" />
                Continue with Google
              </button>

              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-dim">
                <div className="h-px flex-1 bg-border" />
                or
                <div className="h-px flex-1 bg-border" />
              </div>

              <form onSubmit={submit} className="space-y-3 text-xs">
                <label className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-widest text-dim">Email</span>
                  <div className="flex items-center border border-border bg-input focus-within:border-terminal-amber">
                    <Mail className="h-3.5 w-3.5 text-dim ml-2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="flex-1 h-9 px-2 bg-transparent outline-none text-foreground"
                      placeholder="you@company.eu"
                    />
                  </div>
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-widest text-dim">Password</span>
                  <div className="flex items-center border border-border bg-input focus-within:border-terminal-amber">
                    <Lock className="h-3.5 w-3.5 text-dim ml-2" />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="flex-1 h-9 px-2 bg-transparent outline-none text-foreground"
                      placeholder="••••••••"
                    />
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-9 bg-terminal-amber text-primary-foreground text-xs font-bold uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      {mode === "signin" ? "Sign in" : "Create account"}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </form>

              <div className="text-[11px] text-dim text-center">
                {mode === "signin" ? (
                  <>
                    New here?{" "}
                    <button className="text-amber" onClick={() => setMode("signup")}>
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button className="text-amber" onClick={() => setMode("signin")}>
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 text-center text-[11px] text-dim">
            Not a buyer?{" "}
            <Link to="/upload" className="text-cyan">
              Supplier upload portal →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.5-5.9 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 12.7 4.5 3.5 13.7 3.5 25S12.7 45.5 24 45.5 44.5 36.3 44.5 25c0-1.5-.2-3-.9-4.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.5 15.7 18.9 12.5 24 12.5c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 16.3 4.5 9.7 8.7 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 45.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.1c-2 1.4-4.5 2.3-7.2 2.3-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.5 41.2 16.2 45.5 24 45.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.1c-.4.4 6.5-4.8 6.5-13.6 0-1.5-.2-3-.9-4.5z"
      />
    </svg>
  );
}

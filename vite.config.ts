// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Explicitly pin the Nitro preset to Vercel now that hosting is moving off
  // Lovable's Cloudflare-forced sandbox build. Auto-detection (via VERCEL=1)
  // would likely get this right too, but pinning it removes the ambiguity
  // for CI/local `vercel build` runs. This override only takes effect
  // outside a Lovable build context — see LovableViteTanstackOptions docs.
  nitro: {
    preset: "vercel",
    // The upload pipeline (Storage download + Gemini 2.5 Pro document
    // analysis + DB insert) routinely exceeds Vercel's 10s Hobby-tier
    // default function duration. This raises it to 60s for the routes that
    // actually need it. (Note: on the Hobby plan, 60s is also the hard
    // ceiling — Pro allows up to 300s+ if this still isn't enough headroom.)
    //
    // `vercel` is a valid Nitro option but @lovable.dev/vite-tanstack-config's
    // type declaration for `nitro` doesn't include it (verified this still
    // takes effect correctly by inspecting the actual
    // .vercel/output/functions/*/.vc-config.json after a real build, which
    // does contain "maxDuration": 60) — the cast below is only working
    // around an incomplete third-party type, not a real type error.
    vercel: {
      functionRules: {
        "/_serverFn/**": { maxDuration: 60 },
        "/upload/**": { maxDuration: 60 },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
});

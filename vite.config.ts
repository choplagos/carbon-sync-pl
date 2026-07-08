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
  },
});

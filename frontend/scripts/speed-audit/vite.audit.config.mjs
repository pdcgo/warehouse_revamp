// THE PRODUCTION BUILD THE FRONTEND SPEED AUDIT SERVES — `go run ./tools/san audit frontend` (tools/san/audit.go).
//
// The app's own vite.config.ts as it ships — its plugins, its lazy routes, its `manualChunks` vendor split — so the
// audit measures the bundle a person downloads. (P1 dropped `manualChunks` here while it made the `react` and `chakra`
// chunks import each other and the page draw blank; #128 fixed the split in vite.config.ts, so nothing is dropped.)
//
// San passes `--outDir` (a cached folder outside the tree, e2e_report/frontend_audit/build/<hash>) and VITE_API_URL
// (the audit's own API port), and runs `vite preview` on this same file. No tsc: Level 1 already typechecks.
//
// ONE CHANGE FROM WHAT SHIPS — `esbuild.keepNames` (P2, #125, re-renders while typing): the minifier keeps every
// function's and class's `name`, so the typing pass's React hook (run.mjs, installRenderHook) can name the components
// that re-render per keystroke. Vite hands `esbuild` to the minify step too (resolveEsbuildTranspileOptions), so the
// names survive it. It changes how the code is NAMED, never what it asks: the ten screens' request counts on this build
// equal the baseline taken without it (docs/tools/san.md, audit frontend — the keepNames proof).
import base from "../../vite.config.ts";

export default {
  ...base,
  esbuild: {
    ...(base.esbuild || {}),
    keepNames: true,
  },
  build: {
    ...base.build,
    emptyOutDir: true,
    reportCompressedSize: false,
  },
};

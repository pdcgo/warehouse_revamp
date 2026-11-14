import { readdirSync, readFileSync } from "node:fs";
import { ServerResponse } from "node:http";
import { join } from "node:path";

import type { Plugin } from "vite";

// Lets the story test browser CACHE the modules it is served for the length of one `vitest run`.
//
// WHY. Every story file runs in a NEW iframe (Vitest's browser isolation), and a new iframe imports its whole module
// graph again: the addon's setup files, `.storybook/preview.tsx`, every stub and fixture, the generated proto files,
// the page under test. Vite answers the app's own modules `Cache-Control: no-cache` (a dev server's files change), and
// Vitest pins `no-cache` on every versioned dependency URL too (`?v=…`, so a test may mock a dependency), so each of
// those imports went to the server again and came back 304 — ~86,000 requests in one full run, 78,000 of them 304s,
// queued six at a time per browser tab. Chromium caps the requests one tab may have outstanding, and past the cap it
// refuses new ones outright: `net::ERR_INSUFFICIENT_RESOURCES`. Every full run of 2026-11-14 hit it in its last
// seconds, when small story files churn through iframes fastest — a module or the iframe page itself failed to load
// ("Failed to fetch dynamically imported module", "Cannot connect to the iframe"), Vitest's browser pool gave up on
// the run, and the files still queued never ran. (The copy's cold dependency cache was blamed first; measured, it
// pre-bundles once, at startup.)
//
// WHAT. One `vitest run` serves files that do not change while it runs — the browser server has no watcher and no HMR
// — so for the run's length a `no-cache` answer is made `private, max-age=3600`: the first iframe of a tab fetches a
// module, every later iframe of that tab reads it from the browser's cache without a request (~8,000 requests a run).
//
// NOT when it would be wrong:
//   - watch mode (`vitest` without `run`): a changed file must reach the next re-run, so the headers stay as they are;
//   - a project that mocks a module (`vi.mock`, `vi.doMock`, Storybook's `sb.mock`): a mock is served under the same
//     URL as the real module, so a cached copy would hand one file's mock — or the real module — to the next. None
//     does today; the first file that does turns this off (a warning names it) rather than serve the wrong module;
//   - Storybook's own dev server (.storybook/main.ts) and the app's (vite.config.ts): only vitest.config.ts uses this.
const RUN_CACHE = "private, max-age=3600";

// Whether this process is a single `vitest run` that may cache, as decided from Vitest's own config. Kept on the
// PROCESS, not in the plugin: the browser server loads vitest.config.ts a second time (a fresh copy of this plugin),
// and only the first copy is told about Vitest (`configureVitest`) — the copy serving the browser reads it here.
const SINGLE_RUN = Symbol.for("warehouse.vitest.cacheModulesForTheRun");

type RunFlag = { [SINGLE_RUN]?: boolean };

const MOCKS_A_MODULE = /\b(?:vi\.(?:mock|doMock)|sb\.mock)\s*\(/;

export function cacheModulesForTheRun(): Plugin {
  return {
    name: "warehouse:cache-modules-for-the-run",
    configureVitest({ vitest }) {
      if (vitest.config.watch) {
        (globalThis as RunFlag)[SINGLE_RUN] = false;

        return;
      }

      const mocker = mockingFile(vitest.config.root);
      if (mocker !== "") {
        vitest.logger.warn(`cache-modules-for-the-run is OFF: ${mocker} mocks a module (.storybook/runCachePlugin.ts)`);
      }

      (globalThis as RunFlag)[SINGLE_RUN] = mocker === "";
    },
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        if ((globalThis as RunFlag)[SINGLE_RUN] !== true) {
          next();

          return;
        }

        // At the one point every answer passes — writeHead, which Node also calls itself for a response that never did
        // — whoever set the header and however: Vite's transform answers set it one by one, its static files (sirv)
        // hand writeHead a headers object, and Vitest's pin is a setHeader wrapper that drops any later Cache-Control.
        const writeHead = res.writeHead.bind(res) as (status: number, ...rest: unknown[]) => ServerResponse;

        res.writeHead = ((status: number, ...rest: unknown[]) => {
          if (res.getHeader("cache-control") === "no-cache") {
            ServerResponse.prototype.setHeader.call(res, "Cache-Control", RUN_CACHE);
          }

          for (const arg of rest) {
            if (arg === null || typeof arg !== "object" || Array.isArray(arg)) continue;

            const headers = arg as Record<string, unknown>;
            for (const name of Object.keys(headers)) {
              if (name.toLowerCase() === "cache-control" && headers[name] === "no-cache") headers[name] = RUN_CACHE;
            }
          }

          return writeHead(status, ...rest);
        }) as ServerResponse["writeHead"];

        next();
      });
    },
  };
}

// mockingFile names the first story or Storybook file that mocks a module, or "" when none does.
function mockingFile(root: string): string {
  for (const dir of [".storybook", "src"]) {
    for (const entry of readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })) {
      if (!/\.[cm]?[jt]sx?$/.test(entry)) continue;

      const file = join(dir, entry);
      if (MOCKS_A_MODULE.test(readFileSync(join(root, file), "utf8"))) return file;
    }
  }

  return "";
}

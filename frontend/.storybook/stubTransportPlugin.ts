import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

// Redirects `src/transport.ts` to the in-process fake whenever Vite builds for Storybook.
//
// The swap works at all because `src/transport.ts` has exactly ONE importer — `src/api/clients.ts`,
// which reaches it by the literal specifier `"../transport"`. That is what the alias below matches,
// and it is why the regex is anchored rather than a loose `/transport/`: a bare substring would also
// capture `@connectrpc/connect-web`'s own internals.
//
// ⚠ It is a `config` hook adding a resolve.alias, NOT a `resolveId` hook. The obvious-looking
// version — resolve the id, compare the absolute path, return the stub — silently does nothing here:
// Storybook and the Vitest browser runner pre-bundle `src/api/clients.ts` into an optimized dep, and
// that scan does not run project `resolveId` hooks. It fails OPEN, serving the real transport, so the
// only symptom is pickers that never fill and stories that time out looking for options. An alias is
// part of the resolver config itself, so the dep optimizer honours it too.
//
// The same plugin is used by `.storybook/main.ts` and by `vitest.config.ts`, so the story you look
// at in the browser and the story the test runner executes read from exactly one fake.
const STUB = fileURLToPath(new URL("./stubTransport.ts", import.meta.url));

export function stubTransportPlugin(): Plugin {
  return {
    name: "storybook-stub-connect-transport",
    enforce: "pre",
    config() {
      return {
        resolve: {
          alias: [{ find: /^\.\.\/transport$/, replacement: STUB }],
        },
      };
    },
  };
}

import { describe, expect, it } from "vitest";

import en from "./locales/en.json";
import id from "./locales/id.json";

// EVERY LABEL IS TEXT, NEVER ITS KEY. i18next answers a key it cannot find with the key itself, so a renamed key whose
// locale entry was left behind renders `orderDetail.money.platformTotal` on a live screen and nothing fails — the
// seller's order detail showed exactly that after the code moved to `platformTotal`
// (platform-is-the-word-for-the-outside-marketplace) and both locale files still said `marketplaceTotal`.
//
// This reads every literal `t("a.b")` in the app's own source (not the generated code, the stories or the tests) and
// asserts the key is in en.json AND id.json — as itself, or as a plural (`_one` / `_other`). A key built at run time
// (a template literal) is not seen; give such a family a test of its own.

// Vite reads the sources as text — no Node API, so `npm run typecheck` (browser types only) reads this file too.
const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../gen/**", "!../**/*.stories.tsx", "!../**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

type Catalog = Record<string, unknown>;

function hasKey(catalog: Catalog, key: string): boolean {
  const parts = key.split(".");
  let node: unknown = catalog;

  for (let i = 0; i < parts.length; i++) {
    if (typeof node !== "object" || node === null) {
      return false;
    }

    const level = node as Catalog;
    const part = parts[i];

    if (part in level) {
      node = level[part];

      continue;
    }

    // A plural leaf: `count_one`, `count_other`, …
    return i === parts.length - 1 && Object.keys(level).some((k) => k.startsWith(`${part}_`));
  }

  return true;
}

function literalKeys(): { file: string; line: number; key: string }[] {
  const found: { file: string; line: number; key: string }[] = [];
  const call = /\bt\(\s*["']([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)["']/g;

  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(call)) {
      found.push({
        file: file.replace(/^\.\.\//, ""),
        line: text.slice(0, match.index).split("\n").length,
        key: match[1],
      });
    }
  }

  return found;
}

describe("every t() key is in both locales", () => {
  const keys = literalKeys();

  it("finds the app's keys (the scan itself works)", () => {
    expect(keys.length).toBeGreaterThan(1000);
    expect(keys.some((k) => k.key === "orderDetail.money.platformTotal")).toBe(true);
  });

  for (const [locale, catalog] of [
    ["en", en],
    ["id", id],
  ] as const) {
    it(`${locale}.json has every key the source asks for`, () => {
      const missing = keys
        .filter((k) => !hasKey(catalog as Catalog, k.key))
        .map((k) => `${k.file}:${k.line} ${k.key}`);

      expect(missing).toEqual([]);
    });
  }

  // The order detail's money labels read the decided word (platform-is-the-word-for-the-outside-marketplace).
  it("the order detail's platform total is the platform's, in both languages", () => {
    expect(en.orderDetail.money.platformTotal).toBe("Platform total");
    expect(id.orderDetail.money.platformTotal).toBe("Total platform");
    expect("marketplaceTotal" in en.orderDetail.money).toBe(false);
    expect("marketplaceTotal" in id.orderDetail.money).toBe(false);
  });
});

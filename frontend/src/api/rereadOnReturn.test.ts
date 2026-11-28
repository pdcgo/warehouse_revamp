import { describe, expect, it } from "vitest";

import { rereadOnReturnWhileEmpty } from "./rereadOnReturn";

// a-helper-link-opens-a-new-tab — the picker reads again on return ONLY while it has nothing to offer.
describe("rereadOnReturnWhileEmpty", () => {
  const whileEmpty = rereadOnReturnWhileEmpty((rows: number[]) => rows.length === 0);

  it("re-reads an empty answer, whatever its freshness", () => {
    expect(whileEmpty({ state: { data: [] } })).toBe("always");
  });

  it("never re-reads an answer with something in it — no refetch per alt-tab", () => {
    expect(whileEmpty({ state: { data: [7] } })).toBe(false);
  });

  it("leaves a query that has not answered yet to its own first read", () => {
    expect(whileEmpty({ state: { data: undefined } })).toBe(false);
  });
});

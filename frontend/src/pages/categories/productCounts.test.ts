import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { CategorySchema } from "../../gen/warehouse/category/v1/category_pb";
import { categoryProducts, productCountShown } from "./productCounts";

// THE KATEGORI PAGE'S PRODUK FIGURES — a branch made from the served own counts and the tree (productCounts.ts).

const node = (id: bigint, name: string, parentId: bigint) => create(CategorySchema, { id, name, parentId });

// Makanan › Snack › Keripik, Makanan › Roti; Minuman on its own.
const tree = [
  node(81n, "Makanan", 0n),
  node(82n, "Snack", 81n),
  node(83n, "Keripik", 82n),
  node(85n, "Roti", 81n),
  node(84n, "Minuman", 0n),
];

describe("categoryProducts", () => {
  it("adds every node below a branch to it, at any depth, and keeps each node's own", () => {
    const own = new Map([
      ["81", 8],
      ["82", 40],
      ["83", 72],
      ["85", 5],
    ]);

    const got = categoryProducts(tree, own);

    expect(got.get("81")).toEqual({ own: 8, branch: 125 });
    expect(got.get("82")).toEqual({ own: 40, branch: 112 });
    expect(got.get("83")).toEqual({ own: 72, branch: 72 });
    expect(got.get("85")).toEqual({ own: 5, branch: 5 });
    expect(got.get("84")).toEqual({ own: 0, branch: 0 });
  });

  it("lands a count for a category the tree does not hold nowhere", () => {
    const got = categoryProducts(tree, new Map([["99", 7], ["83", 1]]));

    expect(got.get("81")).toEqual({ own: 0, branch: 1 });
    expect(got.has("99")).toBe(false);
  });

  it("stops at a parent loop instead of walking it for ever", () => {
    const loop = [node(1n, "A", 2n), node(2n, "B", 1n)];

    const got = categoryProducts(loop, new Map([["1", 1], ["2", 2]]));

    expect(got.get("1")?.own).toBe(1);
    expect(got.get("2")?.own).toBe(2);
  });
});

describe("productCountShown — the owner's Q3, HELD as A", () => {
  const makanan = { own: 8, branch: 120 };
  const minuman = { own: 0, branch: 0 };

  it("A (as built, the default): the whole branch; an empty node reads 0", () => {
    expect(productCountShown(makanan)).toEqual({ figure: 120 });
    expect(productCountShown(minuman)).toEqual({ figure: 0 });
  });

  it("B (mock): the node's own; one holding none reads — (null)", () => {
    expect(productCountShown(makanan, "B")).toEqual({ figure: 8 });
    expect(productCountShown(minuman, "B")).toEqual({ figure: null });
  });

  it("C (mock): both, its own and the branch's total", () => {
    expect(productCountShown(makanan, "C")).toEqual({ figure: 8, total: 120 });
    expect(productCountShown(minuman, "C")).toEqual({ figure: null, total: 0 });
  });
});

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { categoriesForStory } from "../../../../.storybook/categoryStub";
import { fileProductsForStory } from "../../../../.storybook/productStub";
import { BranchCountMock } from "../branchCountMock";
import type { BranchCountOption } from "../productCounts";
import { CATEGORIES_META } from "./kit";

// CATEGORIES — the Produk column, COUNTED (the-product-count-is-a-marked-sample, real since #115): every team's live
// products filed on each node (ProductCategoryCounts, through productStub), on ONE seeded tree —
//
//   Makanan          8 of its own
//     Snack         40 of its own
//       Keripik     72 of its own (and 3 archived, left out)
//   Minuman          none
//
// What a BRANCH reads is the owner's Q3, HELD: the page is built with option A (the whole branch); B and C are MOCK
// stories only (branchCountMock.tsx), so the three can be shown side by side on the same tree.

const meta = {
  title: "Pages/Categories/Categories/Product count",
  ...CATEGORIES_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function seedTheTree() {
  categoriesForStory([
    { id: 81n, name: "Makanan", parentId: 0n },
    { id: 82n, name: "Snack", parentId: 81n },
    { id: 83n, name: "Keripik", parentId: 82n },
    { id: 84n, name: "Minuman", parentId: 0n },
  ]);
  fileProductsForStory(81n, 8);
  fileProductsForStory(82n, 40);
  fileProductsForStory(83n, 72);
  fileProductsForStory(83n, 3, { archived: true });
}

/** The seeded tree, every branch open, once the counts have landed. */
async function openTheTree(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("category-row-81", {}, { timeout: 4000 });
  await userEvent.click(canvas.getByTestId("categories-toggle-all"));
  await waitFor(() => expect(canvas.getByTestId("category-name-83")).toBeVisible());
  await waitFor(() => expect(canvas.queryByTestId(/^category-products-loading-/)).toBeNull());
  return canvas;
}

/** The Produk cell of each seeded row, in tree order — Makanan, Snack, Keripik, Minuman. */
function productCells(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  return ["81", "82", "83", "84"].map((id) => canvas.getByTestId(`category-products-${id}`).textContent);
}

const mock = (option: BranchCountOption): Story["decorators"] => [
  (Story) => (
    <BranchCountMock option={option}>
      <Story />
    </BranchCountMock>
  ),
];

/** OPTION A, AS BUILT — a branch counts everything under it, the set Discover's Kategori keeps when it is picked
 * (a-picked-branch-keeps-its-whole-subtree): Makanan 120 = 8 + 40 + 72, Snack 112, Keripik 72; the 3 archived are left
 * out; an empty node reads 0, as before. Counted now — no ⚠ mark on the column, no strip above the tree. */
export const AWholeBranch: Story = {
  name: "A · whole branch",
  beforeEach: () => seedTheTree(),
  play: async ({ canvasElement }) => {
    const canvas = await openTheTree(canvasElement);

    await expect(productCells(canvasElement)).toEqual(["120", "112", "72", "0"]);
    await expect(canvas.getByTestId("categories-heading")).toHaveTextContent(/Name.*Sub-categories.*Products.*Actions/);
    await expect(within(canvas.getByTestId("categories-heading")).queryByTestId(/^not-implemented-/)).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
  },
};

/** Option A on a phone — the row's one line says it: *1 sub-category · 120 products*. */
export const AWholeBranchOnAPhone: Story = {
  name: "A · whole branch, phone",
  beforeEach: () => seedTheTree(),
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await openTheTree(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("category-children-81")).toHaveTextContent("1 sub-category · 120 products"));
    await expect(canvas.getByTestId("category-children-82")).toHaveTextContent("1 sub-category · 112 products");
    await expect(canvas.getByTestId("category-children-83")).toHaveTextContent(/^72 products$/);
    await expect(canvas.getByTestId("category-children-84")).toHaveTextContent(/^0 products$/);
  },
};

/** MOCK of option B (not built) — only what is filed on the node itself; a node holding none reads —. */
export const MockBOwnOnly: Story = {
  name: "Mock B · own only",
  beforeEach: () => seedTheTree(),
  decorators: mock("B"),
  play: async ({ canvasElement }) => {
    await openTheTree(canvasElement);

    await expect(productCells(canvasElement)).toEqual(["8", "40", "72", "—"]);
  },
};

/** MOCK of option C (not built) — both: its own, then the whole branch's total, in a wider column. */
export const MockCBoth: Story = {
  name: "Mock C · own and total",
  beforeEach: () => seedTheTree(),
  decorators: mock("C"),
  play: async ({ canvasElement }) => {
    await openTheTree(canvasElement);

    await expect(productCells(canvasElement)).toEqual(["8 · 120 total", "40 · 112 total", "72 · 72 total", "— · 0 total"]);
  },
};

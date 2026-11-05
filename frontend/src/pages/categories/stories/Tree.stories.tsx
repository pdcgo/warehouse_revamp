import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { clearCategoriesForStory } from "../../../../.storybook/categoryStub";
import { CATEGORIES_META, TOP, loaded, openAll, openDialog, visibleNames } from "./kit";

// CATEGORIES — the tree itself — empty, shut on arrival, one button for all, read as a table, the product count. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Categories/Categories/Tree",
  ...CATEGORIES_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A taxonomy with nothing in it says what next, and its own New Category opens the form. */
export const AnEmptyTreeSaysWhatNext: Story = {
  name: "Empty",
  beforeEach: () => clearCategoriesForStory(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const hint = await canvas.findByTestId("categories-empty", {}, { timeout: 4000 });
    await expect(hint).toHaveTextContent("No categories yet");
    await openDialog(within(hint).getByTestId("categories-empty-create"));
    await expect(screen.getByTestId("new-category-name")).toBeVisible();
  },
};

/** The tree arrives SHUT — the top level only, A to Z ("default tutup semua") — each saying how many it holds. */
export const TheTreeArrivesShut: Story = {
  name: "Arrives shut",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(TOP));
    await expect(canvas.getByTestId("category-children-51")).toHaveTextContent(/^1$/);
    await expect(canvas.getByTestId("categories-toggle-all")).toHaveTextContent("Expand All");
  },
};

/** ONE button opens everything, then shuts everything ("tutup buka semua jadi 1 tombol") — and a click opens or shuts
 * a single branch; once every branch is open by hand the button offers to shut them. */
export const OneButtonOpensAndShutsAll: Story = {
  name: "One button for all",
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);
    const toggle = canvas.getByTestId("categories-toggle-all");

    await expect(toggle).toHaveTextContent("Collapse All");
    await expect(canvas.getByTestId("category-children-53")).toHaveTextContent("—");
    await userEvent.click(toggle);
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(TOP));
    await expect(toggle).toHaveTextContent("Expand All");

    await userEvent.click(canvas.getByTestId("category-name-51"));
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Rumah Tangga"]));
    await expect(toggle).toHaveTextContent("Expand All");
  },
};

/** No row's actions run over its count — the count ends before the ＋ button begins. Measured on the BUTTON, not the
 * actions' box: the bug was the button spilling out of a box too narrow for it, over the count. */
async function columnsDoNotOverlap(canvasElement: HTMLElement) {
  for (const add of within(canvasElement).getAllByTestId(/^add-child-/)) {
    if (!add.checkVisibility()) continue;
    const id = add.dataset.testid!.replace("add-child-", "");
    const count = within(canvasElement).getByTestId(`category-children-${id}`).getBoundingClientRect();
    await expect(count.right).toBeLessThanOrEqual(add.getBoundingClientRect().left);
  }
}

/** IT READS LIKE THE APP'S TABLES (owner: "secara tema kurang sesuai") — a heading row, rows the full width with a line
 * under each at a table row's height, square, and labelled actions that keep clear of the count; no card around it. */
export const TheTreeReadsLikeATable: Story = {
  name: "Reads like a table",
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    await expect(canvas.getByTestId("categories-heading")).toHaveTextContent(/Name.*Sub-categories.*Products.*Actions/);
    const row = getComputedStyle(canvas.getByTestId("category-row-51"));
    await expect(parseFloat(row.height)).toBeGreaterThanOrEqual(44);
    await expect(row.borderBottomWidth).toBe("1px");
    await expect(row.borderTopLeftRadius).toBe("0px");
    await expect(canvas.getByTestId("add-child-51")).toHaveTextContent(/^Sub-category$/);
    await expect(canvasElement.querySelector(".chakra-card__root")).toBeNull();
    await columnsDoNotOverlap(canvasElement);

    // A branch opens on a click, so it shows the hand, as a list row that opens something does; a leaf opens nothing
    // and keeps the arrow ("setiap dia ingin membuka detail, dia cuma selector biasa").
    await expect(row.cursor).toBe("pointer");
    await expect(getComputedStyle(canvas.getByTestId("category-row-53")).cursor).toBe("auto");
  },
};

/** HOW MANY PRODUCTS each holds (owner: "tambah jumlah produk dan kasih warning") — invented, so its column carries the
 * ⚠ mark and the strip at the top names it: nothing counts the products filed under a category yet. */
export const TheProductCountIsASampleAndSaysSo: Story = {
  name: "Product count, marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(
      within(canvas.getByTestId("categories-heading")).getByTestId("not-implemented-productCount"),
    ).toHaveTextContent("1");
    await expect(canvas.getByTestId("category-products-51")).toHaveTextContent(/^102$/);
    await expect(canvas.getByTestId("category-products-54")).toHaveTextContent(/^9$/);
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { CATEGORIES_META, loaded } from "./stories/kit";

// CATEGORIES — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// Categories (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders below, so
// Storybook draws Categories as a folder with these two stories leading it. Its rules are grouped by the part of the
// screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Tree     the tree itself — empty, shut on arrival, one button for all, read as a table, the product count
//   Search   the search — the path kept, nothing matching, and the URL
//   Create   New Category and ＋ Sub-category — under the node, a duplicate refused
//   Actions  the row's ⋯ — Rename, Move, Delete

const meta = {
  title: "Pages/Categories/Categories",
  ...CATEGORIES_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A phone — the same tree, New Category its ＋ alone on the title's row (a-phone-header-action-is-an-icon). */
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const create = canvas.getByRole("button", { name: "New Category" });
    await expect(create).toHaveAttribute("data-testid", "open-create-category");
    await expect(create).not.toHaveTextContent("New Category");
    // No heading row on a phone — the count says what it is, and ＋ and the open-all button are their icons alone.
    await expect(canvas.queryByTestId("categories-heading")).toBeNull();
    await expect(canvas.getByTestId("category-children-51")).toHaveTextContent("1 sub-category · 102 products");
    await expect(canvas.getByTestId("add-child-51")).not.toHaveTextContent("Sub-category");
    await expect(canvas.getByTestId("categories-toggle-all")).not.toHaveTextContent("Expand All");
  },
};

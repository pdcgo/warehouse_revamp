import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { CATEGORIES_META, loaded, openAll, openDialog, pickParent, visibleNames } from "./kit";

// CATEGORIES — New Category and ＋ Sub-category — under the node, a duplicate refused. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Categories/Categories/Create",
  ...CATEGORIES_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** New Category adds a category anywhere — here under Elektronik, picked in the form — and it is in the tree after. */
export const NewCategoryLandsInTheTree: Story = {
  name: "New category",
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    const dialog = await openDialog(canvas.getByTestId("open-create-category"));
    await expect(within(dialog).getByTestId("submit-create-category")).toBeDisabled();
    await userEvent.type(within(dialog).getByTestId("new-category-name"), "Kamera", { delay: 20 });
    await pickParent(dialog, "Elektronik");
    await userEvent.click(within(dialog).getByTestId("submit-create-category"));

    await waitFor(() =>
      expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone", "Kamera", "Rumah Tangga", "Dapur"]),
    );
    await expect(canvas.getByTestId("category-children-51")).toHaveTextContent(/^2$/);
  },
};

/** ＋ on a node adds a sub-category UNDER IT — the form opens with that node already its parent. */
export const AddStartsUnderTheNode: Story = {
  name: "Under the node",
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    const dialog = await openDialog(canvas.getByTestId("add-child-52"));
    await expect(dialog).toHaveTextContent("New Sub-category");
    await waitFor(() => expect(within(dialog).getByTestId("category-select")).toHaveTextContent("Elektronik › Audio"));

    await userEvent.type(within(dialog).getByTestId("new-category-name"), "Speaker", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("submit-create-category"));
    await waitFor(() =>
      expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone", "Speaker", "Rumah Tangga", "Dapur"]),
    );
  },
};

/** A name is unique under its parent — a second Audio under Elektronik is refused, and the form says why. */
export const ADuplicateNameIsRefused: Story = {
  name: "Duplicate refused",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const dialog = await openDialog(canvas.getByTestId("add-child-51"));
    await userEvent.type(within(dialog).getByTestId("new-category-name"), "Audio", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("submit-create-category"));

    await waitFor(() => expect(within(dialog).getByTestId("create-category-error")).toHaveTextContent("already exists"));
    await expect(canvas.queryByTestId("category-row-56")).toBeNull();
  },
};

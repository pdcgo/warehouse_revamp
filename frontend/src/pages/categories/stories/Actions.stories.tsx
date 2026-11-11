import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { CATEGORIES_META, loaded, openAll, openDialog, pickParent, visibleNames } from "./kit";

// CATEGORIES — the row's ⋯ — Rename, Move, Delete. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Categories/Categories/Actions",
  ...CATEGORIES_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A row's ⋯, opened — the item it holds. The menu portals. */
async function menuItem(canvas: ReturnType<typeof within>, id: number, item: string) {
  await userEvent.click(canvas.getByTestId(`category-actions-${id}`));
  const el = await screen.findByTestId(`${item}-${id}`);
  await waitFor(() => expect(el).toBeVisible());
  return el;
}

/** Ubah Nama changes the name and nothing else — Dapur stays under Rumah Tangga. */
export const RenameChangesTheNameOnly: Story = {
  name: "Rename",
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    const dialog = await openDialog(await menuItem(canvas, 55, "rename-cat"));
    const name = within(dialog).getByTestId("edit-category-name");
    await expect(name).toHaveValue("Dapur");
    await expect(within(dialog).queryByTestId("category-select")).toBeNull();
    await userEvent.clear(name);
    await userEvent.type(name, "Dapur dan Makan", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("submit-edit-category"));

    await waitFor(() =>
      expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone", "Rumah Tangga", "Dapur dan Makan"]),
    );
  },
};

/** Pindahkan gives a new parent — Dapur moves under Elektronik, and Rumah Tangga is left with none. */
export const MoveGivesANewParent: Story = {
  name: "Move",
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    const dialog = await openDialog(await menuItem(canvas, 55, "move-cat"));
    await expect(within(dialog).getByTestId("submit-move-category")).toBeDisabled();
    await pickParent(dialog, "Elektronik");
    await userEvent.click(within(dialog).getByTestId("submit-move-category"));

    await waitFor(() =>
      expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone", "Dapur", "Rumah Tangga"]),
    );
    await expect(canvas.getByTestId("category-children-54")).toHaveTextContent("—");
  },
};

/** Moving a category does not offer its own branch — Elektronik cannot go under itself or its children. */
export const TheMovePickerLeavesOutItsOwnBranch: Story = {
  name: "Move skips own branch",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const dialog = await openDialog(await menuItem(canvas, 51, "move-cat"));
    await userEvent.click(within(dialog).getByTestId("category-select"));
    const other = await within(dialog).findByTestId("category-node-Rumah Tangga");
    await waitFor(() => expect(other).toBeVisible());
    await expect(within(dialog).queryByTestId("category-node-Elektronik")).toBeNull();
  },
};

/** Hapus is OFF while a category has sub-categories, and says why — the server would refuse it after the confirm. */
export const DeleteIsOffWhileItHasSubCategories: Story = {
  name: "Delete off with children",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const del = await menuItem(canvas, 51, "delete-cat");
    await expect(del).toHaveAttribute("data-disabled");
    await expect(screen.getByTestId("delete-blocked-51")).toHaveTextContent("Delete its sub-categories first");

    // …and OFF means off: a click on it opens no confirm (owner: "hapus disabled masih bisa ku klik").
    await userEvent.click(del, { pointerEventsCheck: 0 });
    await new Promise((r) => setTimeout(r, 300));
    await expect(screen.queryByRole("alertdialog")).toBeNull();
  },
};

/** Hapus on a leaf confirms first, naming it — and it is gone after, its parent a leaf now. */
export const DeleteConfirmsFirst: Story = {
  name: "Delete confirms",
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    await userEvent.click(await menuItem(canvas, 53, "delete-cat"));
    const confirm = await screen.findByRole("alertdialog");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(confirm).toHaveTextContent("Headphone");

    await userEvent.click(within(confirm).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("category-row-53")).toBeNull());
    await expect(canvas.getByTestId("category-children-52")).toHaveTextContent("—");
  },
};

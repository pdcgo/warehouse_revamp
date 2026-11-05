import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SHOPS_META, loaded } from "./kit";

// SHOPS — the primary CS — its own column, and Change Primary CS from the row's ⋯.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Shops/Shops/Primary CS",
  ...SHOPS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The primary CS action lives in the row's ⋯ — open it, and hand back the item (the menu portals).
async function primaryItem(canvas: ReturnType<typeof within>, code: string) {
  await userEvent.click(canvas.getByTestId(`shop-actions-${code}`));
  const item = await screen.findByTestId(`shop-primary-change-${code}`);
  await waitFor(() => expect(item).toBeVisible());
  return item;
}

/** A shop with no primary CS says so in its CS column — in words, in the warning role, not a badge: it cannot import its
 * statements until one is made primary. */
export const AShopWithNoPrimaryCsSaysSo: Story = {
  name: "None, in words",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const none = canvas.getByTestId("shop-no-primary-MEL-TOK");
    await expect(none).toBeVisible();
    await expect(none).toHaveTextContent("No primary CS");
    await expect(none.tagName).toBe("P");
    await expect(none.getAttribute("class") ?? "").not.toMatch(/orange|badge/);
    await expect(canvas.queryByTestId("shop-no-primary-MEL-SHP")).toBeNull();
  },
};

// THE PRIMARY CS IS ITS OWN COLUMN, changed from the row's ⋯ (owner: "jadi kolom saja karena masih luas juga, gantinya
// taruh di aksi", then "pilih cs di ellipsis") — the person an imported statement's rows with no order are counted for.

/** Each shop names its primary CS in its own column; the row's ⋯ holds Change Primary CS — Choose Primary CS on a shop
 * with none — while Edit and Delete stay on the row. */
export const ThePrimaryCsHasItsOwnColumn: Story = {
  name: "Own column",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("shops-table")).getByRole("columnheader", { name: "Primary CS" })).toBeVisible();
    await waitFor(() => expect(canvas.getByTestId("shop-primary-MEL-SHP")).toHaveTextContent("Ani Rahayu"));
    await expect(canvas.getByTestId("shop-primary-MEL-LAZ")).toHaveTextContent("Eko Prasetyo");
    await expect(within(canvas.getByTestId("shop-primary-MEL-TOK")).getByTestId("shop-no-primary-MEL-TOK")).toBeVisible();

    await expect(canvas.getByTestId("edit-MEL-SHP")).toBeVisible();
    await expect(canvas.queryByTestId("shop-primary-change-MEL-SHP")).toBeNull();
    await expect(await primaryItem(canvas, "MEL-SHP")).toHaveTextContent("Change Primary CS");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("shop-primary-change-MEL-SHP")).toBeNull());
    await expect(await primaryItem(canvas, "MEL-TOK")).toHaveTextContent("Choose Primary CS");
  },
};

/** Change Primary CS offers the shop's granted users only, the current one marked; picking another and saving moves the
 * column — and the row does not open under the click. */
export const ChangeMovesThePrimaryCs: Story = {
  name: "Change",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await primaryItem(canvas, "MEL-SHP"));
    const dialog = await screen.findByTestId("primary-cs-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(canvas.queryByTestId("at-shop-detail")).toBeNull();

    const ani = await within(dialog).findByTestId("primary-cs-option-ani");
    await expect(ani).toHaveTextContent("Current");
    await expect(within(dialog).queryByTestId("primary-cs-option-eko")).toBeNull();
    await expect(within(dialog).getByTestId("primary-cs-save")).toBeDisabled();

    await userEvent.click(within(dialog).getByTestId("primary-cs-option-budi"));
    await waitFor(() => expect(within(dialog).getByTestId("primary-cs-save")).toBeEnabled());
    await userEvent.click(within(dialog).getByTestId("primary-cs-save"));

    await waitFor(() => expect(canvas.getByTestId("shop-primary-MEL-SHP")).toHaveTextContent("Budi Santoso"));
    await waitFor(() => expect(screen.queryByTestId("primary-cs-dialog")).toBeNull());
  },
};

/** A shop nobody holds has no one to choose — the dialog says why, offers no Save, and opens the shop's page, where
 * access is given. */
export const NobodyToChooseOpensTheShop: Story = {
  name: "Nobody to choose",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await primaryItem(canvas, "MEL-TOK"));
    const hint = await screen.findByTestId("primary-cs-nobody");
    await waitFor(() => expect(hint).toBeVisible());
    await expect(screen.queryByTestId("primary-cs-save")).toBeNull();

    await userEvent.click(screen.getByTestId("primary-cs-open-shop"));
    await waitFor(() => expect(canvas.getByTestId("at-shop-detail")).toBeInTheDocument());
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SHOPS_META, loaded } from "./kit";

// SHOPS — New Shop, Edit and Delete.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Shops/Shops/Actions",
  ...SHOPS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** New Shop asks for a name, a code and a marketplace, and the shop is on the list straight after. */
export const NewShopLandsOnTheList: Story = {
  name: "New shop",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-shop"));
    const name = await screen.findByTestId("shop-name");
    await waitFor(() => expect(name).toBeVisible());
    await expect(screen.getByTestId("submit-shop")).toBeDisabled();

    await userEvent.type(name, "Melati Blibli", { delay: 20 });
    await userEvent.type(screen.getByTestId("shop-code"), "MEL-BLI", { delay: 20 });
    await userEvent.click(screen.getByTestId("marketplace-select"));
    const option = await screen.findByRole("option", { name: "Blibli" });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(screen.getByTestId("submit-shop")).toBeEnabled());
    await userEvent.click(screen.getByTestId("submit-shop"));
    await waitFor(() => expect(canvas.getByTestId("shop-row-MEL-BLI")).toHaveTextContent("Melati Blibli"));
  },
};

/** Edit opens the same form, filled with the shop — its description a textarea, a sentence of text
 * (chakra-first-whenever-it-has-the-component). */
export const EditOpensTheShopFilledIn: Story = {
  name: "Edit, filled in",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("edit-MEL-SHP"));
    const name = await screen.findByTestId("shop-name");
    await waitFor(() => expect(name).toBeVisible());
    await expect(name).toHaveValue("Melati Official");
    await expect(screen.getByTestId("shop-code")).toHaveValue("MEL-SHP");
    await expect(screen.getByTestId("shop-description").tagName).toBe("TEXTAREA");
  },
};

/** Delete confirms first, naming the shop — and the row is gone after. */
export const DeleteConfirmsFirst: Story = {
  name: "Delete confirms",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("delete-MEL-LAZ"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Melati Grosir");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("shop-row-MEL-LAZ")).toBeNull());
    await expect(canvas.getByTestId("shop-row-MEL-SHP")).toBeVisible();
  },
};

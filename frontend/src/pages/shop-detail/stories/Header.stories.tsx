import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SHOP_DETAIL_META, loaded } from "./kit";

// SHOP DETAIL — the title's row — Back, Edit, Delete. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Shops/ShopDetail/Header",
  ...SHOP_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Delete confirms, naming the shop, then goes back to the list. */
export const DeleteConfirmsAndGoesBack: Story = {
  name: "Delete",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-detail-delete"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Melati Official");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("at-shops")).toBeInTheDocument());
  },
};

/** Edit opens the shop's form, filled in. */
export const EditOpensTheForm: Story = {
  name: "Edit",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-detail-edit"));
    const name = await screen.findByTestId("shop-name");
    await waitFor(() => expect(name).toBeVisible());
    await expect(name).toHaveValue("Melati Official");
  },
};

/** Back goes to the shops list. */
export const BackGoesToTheList: Story = {
  name: "Back",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-detail-back"));
    await waitFor(() => expect(canvas.getByTestId("at-shops")).toBeInTheDocument());
  },
};

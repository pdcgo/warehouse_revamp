import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SHOP_DETAIL_META, loaded } from "./kit";

// SHOP DETAIL — the title's row — Back, Edit, Close Shop. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Shops/ShopDetail/Header",
  ...SHOP_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Close Shop confirms, naming the shop — and the page stays, now read as closed (a-shop-is-closed-never-deleted). */
export const CloseConfirmsAndThePageReadsClosed: Story = {
  name: "Close Shop",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("shop-detail-delete")).toBeNull();
    await userEvent.click(canvas.getByTestId("shop-detail-close"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Melati Official");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await canvas.findByTestId("shop-closed-banner");
    await expect(canvas.getByTestId("shop-detail-reopen")).toBeVisible();
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

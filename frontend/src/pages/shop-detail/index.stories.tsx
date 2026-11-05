import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { SHOP_DETAIL_META, loaded } from "./stories/kit";

// SHOP DETAIL — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// ShopDetail (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders below, so
// Storybook draws ShopDetail as a folder with these two stories leading it. Its rules are grouped by the part of the
// screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   States   a shop with nobody granted, and another team's shop
//   Header   the title's row — Back, Edit, Delete
//   Details  the Shop Details panel — its fields, the two panels, the withdrawal account
//   Access   who may work on it — the primary CS, Make Primary, the picker, removing a grant

const meta = {
  title: "Pages/Shops/ShopDetail",
  ...SHOP_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A phone — the header stays one row, Edit and Delete their icons (a-phone-header-action-is-an-icon). */
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("shop-detail-name")).toHaveTextContent("Melati Official");
    const edit = canvas.getByRole("button", { name: "Edit" });
    await expect(edit).toHaveAttribute("data-testid", "shop-detail-edit");
    await expect(edit).not.toHaveTextContent("Edit");
    const name = canvas.getByTestId("shop-detail-name").getBoundingClientRect();
    await expect(edit.getBoundingClientRect().top).toBeLessThan(name.bottom);

    // The two panels stack, the detail first.
    const info = canvas.getByTestId("shop-detail-info").getBoundingClientRect();
    await expect(info.bottom).toBeLessThanOrEqual(canvas.getByTestId("shop-users-section").getBoundingClientRect().top);
  },
};

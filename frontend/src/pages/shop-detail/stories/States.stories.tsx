import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { At, AtStore, SHOP_DETAIL_META } from "./kit";

// SHOP DETAIL — a shop with nobody granted, and another team's shop. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Shops/ShopDetail/States",
  ...SHOP_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A shop with no one granted — and so no primary CS. */
export const NobodyGranted: Story = { render: () => <AtStore /> };

const AtKenanga = At(24);

/** Another team's shop is not found — the id in the URL is not trusted to belong to the team in hand. */
export const AnotherTeamsShopIsNotFound: Story = {
  name: "Another team's, not found",
  render: () => <AtKenanga />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("shop-detail-error", {}, { timeout: 4000 })).toBeVisible();
  },
};

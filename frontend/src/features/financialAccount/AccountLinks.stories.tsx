import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { AccountLinks } from "./AccountLinks";

// What an account is linked to — shared by the accounts list (Terhubung ke, three then +N) and the account page's
// Toko terhubung card (two then +N, no Operasional: its header says it). Each shop chip wears its marketplace's colour.

const SHOPS: Record<string, { name: string; marketplace: Marketplace }> = {
  "21": { name: "Melati Official", marketplace: Marketplace.SHOPEE },
  "22": { name: "Melati Store", marketplace: Marketplace.TOKOPEDIA },
  "23": { name: "Melati Grosir", marketplace: Marketplace.LAZADA },
  "25": { name: "Melati TikTok", marketplace: Marketplace.TIKTOK },
};

const shopOf = (id: bigint) => SHOPS[id.toString()];

const ACCOUNT = { id: 1301n, name: "BCA Operasional", operational: true, shopIds: [21n, 22n, 23n, 25n] };

const meta = {
  title: "Features/FinancialAccount/AccountLinks",
  component: AccountLinks,
  args: { account: ACCOUNT, shopOf },
} satisfies Meta<typeof AccountLinks>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The list's cell: Operasional first, then shops, three in all, the rest behind "+N" that opens them all. */
export const OnTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("account-operational-1301")).toBeVisible();
    await expect(canvas.getByTestId("account-shop-1301-21")).toHaveTextContent("Melati Official");
    await expect(canvas.getByTestId("account-shop-1301-22")).toBeVisible();
    await expect(canvas.queryByTestId("account-shop-1301-23")).toBeNull();
    await expect(canvas.getByTestId("account-links-more-1301")).toHaveTextContent("+2");

    await userEvent.click(canvas.getByTestId("account-links-more-1301"));
    const dialog = await screen.findByTestId("account-links-dialog-1301");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Melati Grosir");
    await expect(dialog).toHaveTextContent("Melati TikTok");
  },
};

/** The account page's card: no Operasional, two shops, then "+N" — each chip in its marketplace's colour. */
export const OnTheAccountPage: Story = {
  args: { withOperational: false, shown: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("account-operational-1301")).toBeNull();
    await expect(canvas.getByTestId("account-links-more-1301")).toHaveTextContent("+2");

    const shopee = getComputedStyle(canvas.getByTestId("account-shop-1301-21")).backgroundColor;
    const tokopedia = getComputedStyle(canvas.getByTestId("account-shop-1301-22")).backgroundColor;
    await expect(shopee).not.toBe(tokopedia);
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import { At, AtStore, SHOP_DETAIL_META, loaded } from "./kit";

// SHOP DETAIL — a shop with nobody granted, another team's shop, and a monitored team's shop, read-only. The page's stories are grouped by the part of the screen they are about
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

/** the-admin-team-monitors-read-only — a shop of a team the admin team MONITORS: its details and who works on it, read.
 * No Edit, no Delete, no one added, made primary or removed. */
export const MonitoringOffersNoWrite: Story = {
  name: "Monitoring, read-only",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("shop-users-list", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.queryByTestId("shop-detail-edit")).toBeNull();
    await expect(canvas.queryByTestId("shop-detail-delete")).toBeNull();
    await expect(canvas.queryByTestId("shop-add-user")).toBeNull();
    await expect(canvas.queryAllByTestId(/^remove-shop-user-/)).toHaveLength(0);
    await expect(canvas.queryAllByTestId(/^make-primary-/)).toHaveLength(0);
  },
};

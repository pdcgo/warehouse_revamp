import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SUPPLIERS_META, standingIn } from "./kit";

// SUPPLIERS — a warehouse team's page — it keeps no suppliers, and is told why (only-a-selling-team-has-suppliers).
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/Suppliers/States",
  ...SUPPLIERS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const WAREHOUSE_TEAM = 11n;

export const AWarehouseTeam: Story = { beforeEach: standingIn(WAREHOUSE_TEAM) };

// only-a-selling-team-has-suppliers: a warehouse team gets no New Supplier, and is told why.
export const OnlyASellingTeamHasSuppliers: Story = {
  name: "Selling team only",
  beforeEach: standingIn(WAREHOUSE_TEAM),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("suppliers-selling-only", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("open-create-supplier")).toBeNull();
    // No figures, so nothing to filter them by — nor a warehouse to filter by.
    await expect(canvas.queryByTestId("supplier-range-sold")).toBeNull();
    await expect(canvas.queryByTestId("supplier-warehouse-filter")).toBeNull();
  },
};

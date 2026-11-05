import type { Meta, StoryObj } from "@storybook/react-vite";

import { WAREHOUSE_DETAIL_META } from "./stories/kit";

// RESTOCK WAREHOUSE DETAIL — the screen as it first opens: an ongoing delivery sits FIRST, straight under
// RestockWarehouseDetail (owner: *"default dan mobile taruh di depan saja"* — this page has no Default or phone story
// of its own, so its first look leads). The same title also holds the folders below. Its rules are grouped by the part
// of the screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Actions     the header's acts, by status
//   Payment     the courier's charge, owed back
//   Products    the count, where the good units went, the broken units' photo
//   SignForBox  Sign for Box — its dialog, and the move to arrived
//   States      the delivery in each other status, as it opens
//   Timeline    the selling team's edit in the warehouse's trail

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ongoing: Story = {};

import type { Meta, StoryObj } from "@storybook/react-vite";

import { At502, At503, At504, At505, At507, WAREHOUSE_DETAIL_META } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the delivery in each other status, as it opens.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/States",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Arrived: Story = { render: () => <At502 /> };

export const Accepted: Story = { render: () => <At503 /> };

export const Lost: Story = { render: () => <At504 /> };

export const Cancelled: Story = { render: () => <At505 /> };

export const AcceptedWithADeletedStore: Story = { render: () => <At507 /> };

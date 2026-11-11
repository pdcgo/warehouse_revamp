import type { Meta, StoryObj } from "@storybook/react-vite";

import { SUPPLIER_DISCOVER_DETAIL_META, AtSinar } from "./kit";

// DISCOVER SUPPLIER DETAIL — the states worth looking at — a supplier with no stores. The page's stories are grouped
// by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is
// ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSupplierDetail/States",
  ...SUPPLIER_DISCOVER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoStores: Story = { render: () => <AtSinar /> };

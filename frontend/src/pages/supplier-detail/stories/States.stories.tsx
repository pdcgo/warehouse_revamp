import type { Meta, StoryObj } from "@storybook/react-vite";

import { SUPPLIER_DETAIL_META, AtBanyak, AtCahaya, AtSinar } from "./kit";

// SUPPLIER DETAIL — the states worth looking at — a website only, no stores yet, and more stores than a page. The
// page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierDetail/States",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AWebsiteOnly: Story = { render: () => <AtCahaya /> };

export const NoChannelsYet: Story = { render: () => <AtSinar /> };

export const ManyChannels: Story = { render: () => <AtBanyak /> };

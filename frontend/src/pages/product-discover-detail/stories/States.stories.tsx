import type { Meta, StoryObj } from "@storybook/react-vite";

import { AtBeras, AtKopi, AtTeh, DISCOVER_PRODUCT_DETAIL_META, tehIs } from "./kit";

// DISCOVER PRODUCT DETAIL — the states worth looking at, beyond Default and Mobile: a product with a reserve, your own
// product, a locked one and an archived one. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProductDetail/States",
  ...DISCOVER_PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithAReserve: Story = { render: () => <AtKopi /> };

export const YourOwnProduct: Story = { render: () => <AtBeras /> };

export const Locked: Story = { beforeEach: tehIs("crossLocked"), render: () => <AtTeh /> };

export const Archived: Story = { beforeEach: tehIs("deleted"), render: () => <AtTeh /> };

import type { Meta, StoryObj } from "@storybook/react-vite";

import { At, PRODUCTS_META } from "./kit";

// PRODUCTS — the states worth looking at, beyond Default and Mobile: the archive, its own page. The page's stories are
// grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is
// ./kit.tsx.

const meta = {
  title: "Pages/Products/Products/States",
  ...PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The archive — its own page, the archived products alone. */
export const Archived: Story = {
  name: "Archived",
  render: () => <AtArchived />,
};
const AtArchived = At("/products/archived");

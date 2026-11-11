import type { Meta, StoryObj } from "@storybook/react-vite";

import { AtEditMinyak, PRODUCT_FORM_META } from "./kit";

// PRODUCT FORM — the states worth looking at, beyond Default and Mobile: an edit, every field filled from the record.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductForm/States",
  ...PRODUCT_FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Editing 700 — the gallery and every field filled from the record. */
export const Editing: Story = {
  name: "Editing",
  render: () => <AtEditMinyak />,
};

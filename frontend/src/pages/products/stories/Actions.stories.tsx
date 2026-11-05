import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — what opens a page: a live row opens the product, Edit its form, New Product an empty one. The page's
// stories are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what
// they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/Products/Actions",
  ...PRODUCTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A live row opens the product's page; Edit opens its form; New Product opens an empty one. */
export const RowsAndActionsOpenTheirPages: Story = {
  name: "Row opens the product",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-product-SKU-ANG-001"));
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());
  },
};

export const EditOpensTheForm: Story = {
  name: "Edit",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("edit-SKU-ANG-001"));
    await waitFor(() => expect(canvas.getByTestId("at-product-edit")).toBeInTheDocument());
  },
};

export const NewProductOpensTheForm: Story = {
  name: "New Product",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-product"));
    await waitFor(() => expect(canvas.getByTestId("at-product-new")).toBeInTheDocument());
  },
};

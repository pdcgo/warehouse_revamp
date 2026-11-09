import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import { PRODUCTS_META, loaded } from "./kit";

// PRODUCTS — what opens a page: a live row opens the product, Edit its form, New Product an empty one — and none of the
// writes offered to the admin team monitoring. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

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

    await userEvent.click(canvas.getByTestId("open-product-SL-03-ANG-001"));
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());
  },
};

export const EditOpensTheForm: Story = {
  name: "Edit",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("edit-SL-03-ANG-001"));
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

/** the-admin-team-monitors-read-only — the admin team READING Toko Anggrek's catalogue (not a member, picked from All
 * teams): every row and figure, the way into the archive — and no New Product, no Edit, no Archive. The list is the
 * same screen; canWrite is what takes the writes away. */
export const MonitoringOffersNoWrite: Story = {
  name: "Monitoring, no writes",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("product-row-SL-03-ANG-003")).toBeVisible();
    await expect(canvas.getByTestId("open-archived-products")).toBeVisible();
    await expect(canvas.queryByTestId("open-create-product")).toBeNull();
    await expect(canvas.queryByTestId("edit-SL-03-ANG-001")).toBeNull();
    await expect(canvas.queryByTestId("archive-SL-03-ANG-001")).toBeNull();
  },
};

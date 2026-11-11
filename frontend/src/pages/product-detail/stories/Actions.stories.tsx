import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { AtTepung, PRODUCT_DETAIL_META, loaded } from "./kit";

// PRODUCT DETAIL — the title row's actions: Edit, and the order and restock forms the page opens with this product on
// them (the-order-and-restock-start-on-the-page). The page's stories are grouped by the part of the screen they are
// about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductDetail/Actions",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Edit opens the product's form; Back returns to the list. */
export const EditOpensTheForm: Story = {
  name: "Edit",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-edit"));
    await waitFor(() => expect(canvas.getByTestId("at-product-edit")).toBeInTheDocument());
  },
};

// ORDER AND RESTOCK FROM HERE — the warehouse and the quantity first, on the page (the-order-and-restock-start-on-the-page):
// every warehouse with its ready stock, the fullest preselected; then the form, with this product on it at that quantity
// (a-product-page-opens-the-order-and-restock-forms).
export const OrderAndRestockOpenTheirForms: Story = {
  name: "Order form",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-order"));
    const dialog = await screen.findByTestId("start-order-dialog");
    // Minyak: 54 ready at Gudang Pusat, 25 at Gudang Cabang — Pusat, the fullest, is preselected.
    await waitFor(() => expect(within(dialog).getByTestId("start-warehouse-ready-11")).toHaveTextContent("54 pcs"));
    await expect(within(dialog).getByTestId("start-warehouse-ready-14")).toHaveTextContent("25 pcs");

    const qty = within(dialog).getByTestId("start-quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "2", { delay: 40 });
    await userEvent.click(within(dialog).getByTestId("start-order-continue"));

    await canvas.findByTestId("at-order-form");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?product=700&warehouse=11&qty=2");
  },
};

export const RestockOpensWithThePickedWarehouse: Story = {
  name: "Restock, picked warehouse",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The page's reads land first — the picker's warehouses among them — as ThePickerSplitsThePage waits.
    await waitFor(() => expect(canvas.getByTestId("pd-batch-row-7001")).toBeInTheDocument());
    await pickTeam(canvas.getByTestId("pd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.getByTestId("pd-warehouse-note")).toBeVisible());
    await userEvent.click(canvas.getByTestId("product-detail-restock"));
    const dialog = await screen.findByTestId("start-restock-dialog");
    // The lens's warehouse comes preselected.
    await waitFor(() => expect(within(dialog).getByTestId("start-restock-continue")).toBeEnabled());
    await userEvent.click(within(dialog).getByTestId("start-restock-continue"));

    await canvas.findByTestId("at-restock-form");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?product=700&warehouse=14&qty=1");
  },
};

// NOTHING READY ANYWHERE, NOTHING TO ORDER (an-empty-product-cannot-start-an-order) — Tepung has no stock on any shelf:
// Buat Pesanan is held back with the reason, while Restok, the way stock comes back, stays.
export const OrderIsHeldBackWithNoStock: Story = {
  name: "Order held, no stock",
  render: () => <AtTepung />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("product-detail-order")).toBeDisabled());
    await expect(canvas.getByTestId("product-detail-order").parentElement).toHaveAttribute(
      "title",
      "No stock is ready in any warehouse.",
    );
    await expect(canvas.getByTestId("product-detail-restock")).toBeEnabled();
  },
};

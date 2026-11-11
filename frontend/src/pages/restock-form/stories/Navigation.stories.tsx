import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { marker, routedPage } from "../../../../.storybook/pageStory";
import { RestockFormPage } from "../index";
import { BERAS, FORM_META, ONGOING, loaded, ongoingFromOneSupplier } from "./kit";

// RESTOCK FORM — Back and Save return where the form was opened (a-form-returns-where-it-was-opened) — a product's
// page, the list, the restock's own page.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockForm/Navigation",
  ...FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Beras's own page opened this form with Gudang Pusat picked — the product and the warehouse in the address, and the
// page in the navigation's state.
const FromProductPage = routedPage(
  [
    { path: "/inventories/restock/new", element: <RestockFormPage key="create" /> },
    marker("/products/:productId", "at-product-page"),
  ],
  { pathname: "/inventories/restock/new", search: `?product=${BERAS}&warehouse=11`, state: { from: `/products/${BERAS}` } },
);

// THE PRODUCT IS THE FIRST LINE, and Back returns to the page that opened the form.
export const OpenedFromAProductPageStartsWithIt: Story = {
  name: "From a product page",
  render: () => <FromProductPage />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await waitFor(() => expect(canvas.getByTestId("restock-line-0")).toHaveTextContent("Beras Pandan Wangi 5kg"), {
      timeout: 4000,
    });
    await userEvent.click(canvas.getByTestId("restock-create-back"));
    await canvas.findByTestId("at-product-page");
  },
};

function editOpenedFrom(from: string) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId/edit", element: <RestockFormPage key="edit" /> },
      marker("/inventories/restock/:requestId", "at-restock-detail"),
      marker("/inventories/restock", "at-restock-list"),
    ],
    { pathname: `/inventories/restock/${ONGOING.id}/edit`, state: { from } },
  );
}

const EditFromList = editOpenedFrom("/inventories/restock?status=ongoing");
const EditFromDetail = editOpenedFrom(`/inventories/restock/${ONGOING.id}`);

// OPENED FROM THE LIST, BACK TO THE LIST (owner: *"untuk navigasi edit bukan ke detail, tapi sesuai halaman sebelumnya,
// kalau detail ke detail, kalau list ke list"*) — Save goes back there, its filter kept.
export const AnEditFromTheListSavesBackToTheList: Story = {
  name: "From the list · save",
  render: () => <EditFromList />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("submit-restock")).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("submit-restock"));
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};

// …and the arrow back goes there too.
export const AnEditFromTheListGoesBackToTheList: Story = {
  name: "From the list · back",
  render: () => <EditFromList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await userEvent.click(canvas.getByTestId("restock-edit-back"));
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};

// OPENED FROM THE RESTOCK'S PAGE, BACK TO IT.
export const AnEditFromTheDetailSavesBackToTheDetail: Story = {
  name: "From the detail · save",
  render: () => <EditFromDetail />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("submit-restock")).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("submit-restock"));
    await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 });
  },
};

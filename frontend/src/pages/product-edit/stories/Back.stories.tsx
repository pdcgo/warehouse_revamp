import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { LocationProbe, marker, routedPage } from "../../../../.storybook/pageStory";
import { liveProducts } from "../../../../.storybook/productStub";
import { AtEditMinyak, PRODUCT_FORM_META, loaded, loadedMinyak, retype, routes } from "./kit";

// PRODUCT FORM — where the form returns (the-form-returns-where-it-was-opened): Back at the top and at the foot, and a
// save, each to the product's page, the filtered list or the list it came from. The page's stories are grouped by the
// part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductForm/Back",
  ...PRODUCT_FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Opened from the product's own page, as its Ubah does.
const AtEditFromDetail = routedPage(routes, { pathname: "/products/700/edit", state: { from: "/products/700" } });
// Opened from a filtered list, as a row's Ubah does — the list route shows its query, to see it came back filtered.
const AtEditFromList = routedPage(
  [
    routes[0]!,
    routes[1]!,
    { path: "/products", element: <><span data-testid="at-products" /><LocationProbe /></> },
    marker("/products/:productId", "at-product-detail"),
  ],
  { pathname: "/products/700/edit", state: { from: "/products?q=minyak" } },
);

/** Saving an edit writes it and lands on THE PRODUCT'S PAGE — where it was opened from, as Back goes too (the-form-returns-where-it-was-opened) —
 * the gallery sent back as it stands, so it is kept, not dropped. */
export const SavingAnEditReturnsToTheProduct: Story = {
  name: "Save, to the product",
  render: () => <AtEditFromDetail />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await retype(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 2L — Botol");
    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());

    const saved = liveProducts().find((p) => p.id === 700n)!;
    await expect(saved).toMatchObject({ name: "Minyak Goreng Sawit 2L — Botol", crossMarkupBps: 1250, reservedStock: 4 });
    await expect(saved.images).toHaveLength(2);
  },
};

/** BACK RETURNS TO WHERE THE FORM WAS OPENED FROM (the-form-returns-where-it-was-opened): from the product's page, back
 * there; from a filtered list, back to that list with its query; reached by a link, to the list. */
export const BackFromAnEditReturnsToTheProduct: Story = {
  name: "Back, to the product",
  render: () => <AtEditFromDetail />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back"));
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());
  },
};

export const BackFromAnEditOpenedFromTheListReturnsToTheList: Story = {
  name: "Back, to the filtered list",
  render: () => <AtEditFromList />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back-foot"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=minyak");
  },
};

export const ASaveFromTheListReturnsToTheList: Story = {
  name: "Save, to the filtered list",
  render: () => <AtEditFromList />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await retype(canvas.getByTestId("product-edit-name"), "Minyak Goreng Sawit 2L — Botol");
    await userEvent.click(canvas.getByTestId("product-edit-save"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=minyak");
  },
};

export const AnEditReachedByALinkReturnsToTheList: Story = {
  name: "From a link, to the list",
  render: () => <AtEditMinyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
  },
};

export const BackFromANewOneReturnsToTheList: Story = {
  name: "New, to the list",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-edit-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
  },
};

/** BACK IS AT THE FOOT TOO, with its arrow, right beside Save — and goes where the top arrow goes. */
export const BackAtTheFootGoesWhereTheArrowGoes: Story = {
  name: "Back at the foot",
  render: () => <AtEditFromDetail />,
  play: async ({ canvasElement }) => {
    const canvas = await loadedMinyak(canvasElement);
    const back = canvas.getByTestId("product-edit-back-foot");

    await expect(back).toHaveTextContent("Back");
    await expect(back.querySelector("svg")).not.toBeNull();
    // Beside it, not across the page: the two share a parent and Back comes first.
    const save = canvas.getByTestId("product-edit-save");
    await expect(back.parentElement).toBe(save.parentElement);
    await expect(back.nextElementSibling).toBe(save);
    await expect(save.querySelector("svg")).not.toBeNull();

    await userEvent.click(back);
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());
  },
};

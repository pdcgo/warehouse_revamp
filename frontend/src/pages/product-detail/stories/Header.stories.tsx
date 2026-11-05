import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { At, PRODUCT_DETAIL_META, loaded, sectionOf } from "./kit";

// PRODUCT DETAIL — the title row: the name with its SKU, the sticky bar that repeats it, Back, and another team's
// product, not found. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/ProductDetail/Header",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The product's name is the title ABOVE the Info card, its SKU to copy under it; inside Info the category leads the
 * record's list, read like the figures under it. */
export const TheProductsName: Story = {
  name: "Name and SKU",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await expect(canvas.getByTestId("product-detail-name")).toHaveTextContent(/^Minyak Goreng Sawit 2L — Satuan$/);
    await expect(info.queryByTestId("product-detail-name")).toBeNull();
    await expect(canvas.getByTestId("product-detail-sku")).toHaveTextContent("SKU-ANG-001");
    await expect(info.queryByTestId("product-detail-sku")).toBeNull();
    await waitFor(() => expect(info.getByTestId("product-detail-category")).toHaveTextContent("Rumah Tangga"));
  },
};

/** THE HEADER ROW — back as an icon beside the name, the SKU under it, the actions on the right — and the SAME ROW in
 * the sticky bar, which shows only once the title has scrolled behind it (it showed from the start once: owner,
 * *"stickymu bermasalah, muncul terus"*). */
export const TheHeaderRowSticks: Story = {
  name: "Sticky bar",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const bar = canvas.getByTestId("product-detail-name-bar");

    // The page's own row: back beside the name, the actions on it.
    await expect(canvas.getByTestId("product-detail-back")).toBeInTheDocument();
    await expect(canvas.getByTestId("product-detail-edit")).toBeInTheDocument();
    await expect(bar).not.toHaveAttribute("data-shown");
    await new Promise((r) => setTimeout(r, 300));
    await expect(bar).not.toHaveAttribute("data-shown");

    canvas.getByTestId("pd-section-warehouse").scrollIntoView();
    await waitFor(() => expect(bar).toHaveAttribute("data-shown", "true"));
    await expect(bar).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");
    // The SKU, back and the actions ride with it (owner: *"di stickynya juga ada skuid"*, *"di stickynya juga ada"*).
    await expect(within(bar).getByTestId("product-detail-sticky-sku")).toHaveTextContent("SKU-ANG-001");
    await expect(within(bar).getByTestId("product-detail-sticky-back")).toBeInTheDocument();
    await expect(within(bar).getByTestId("product-detail-sticky-edit")).toBeInTheDocument();

    // Back up and down again — it follows the name each way, and holds still in between (it flipped back and forth
    // while the page sat still before: owner, *"judul stickynya ngebug di bolak balik"*).
    window.scrollTo(0, 0);
    await waitFor(() => expect(bar).not.toHaveAttribute("data-shown"));
    await new Promise((r) => setTimeout(r, 300));
    await expect(bar).not.toHaveAttribute("data-shown");
    canvas.getByTestId("pd-section-warehouse").scrollIntoView();
    await waitFor(() => expect(bar).toHaveAttribute("data-shown", "true"));
    await new Promise((r) => setTimeout(r, 300));
    await expect(bar).toHaveAttribute("data-shown", "true");
    window.scrollTo(0, 0);
  },
};

export const BackGoesToTheList: Story = {
  name: "Back to the list",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
  },
};

const AtOtherTeams = At(74);

/** Another team's product is not found — the id in the URL is not trusted to belong to the team in hand. */
export const AnotherTeamsProductIsNotFound: Story = {
  name: "Another team's, not found",
  render: () => <AtOtherTeams />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("product-detail-error", {}, { timeout: 5000 })).toBeVisible();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIER_REPORT_META, loaded } from "./kit";

// SUPPLIER REPORT — a ranked row — where it opens (manage-and-discover-are-two-pages), its hover
// (a-table-row-lights-up), and the growing pager (every-list-pages-with-the-growing-pager). The page's stories are
// grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share
// is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierReport/Rows",
  ...SUPPLIER_REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Our own supplier opens where we manage it — and another team's on Discover (manage-and-discover-are-two-pages).
export const OurSupplierOpensItsManageDetail: Story = {
  name: "Ours opens manage",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-report-row-31"));
    await expect(await canvas.findByTestId("at-own-supplier")).toBeInTheDocument();
  },
};

export const AnotherTeamsSupplierOpensOnDiscover: Story = {
  name: "Another team's opens Discover",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-report-row-34"));
    await expect(await canvas.findByTestId("at-discover-supplier")).toBeInTheDocument();
  },
};

// A deleted supplier opens nothing — neither detail page shows a deleted one.
export const ADeletedSupplierOpensNothing: Story = {
  name: "Deleted opens nothing",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-report-row-38"));
    await expect(canvas.queryByTestId("at-own-supplier")).toBeNull();
    await expect(canvas.getByTestId("supplier-report-table")).toBeVisible();
  },
};

// A ROW LIGHTS UP under the pointer, every cell — driven by `data-hover`, which Chakra's `_hover` honours.
export const ARankedRowLightsUp: Story = {
  name: "Row lights up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const row = within(canvas.getByTestId("supplier-report-table")).getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// The ranking pages with the growing pager.
export const TheRankingPagesWithTheGrowingPager: Story = {
  name: "Growing pager",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("supplier-report-pager")).toBeVisible();
    await expect(canvas.getByTestId("supplier-report-pager-page-1")).toBeVisible();
  },
};

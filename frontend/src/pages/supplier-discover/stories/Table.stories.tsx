import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIER_DISCOVER_META, NUSANTARA, SINAR, SUMBER, loaded } from "./kit";

// DISCOVER SUPPLIERS — the table view — a row lighting up, the description column
// (discover-table-shows-the-description), the figures last. The page's stories are grouped by the part of the screen
// they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSuppliers/Table",
  ...SUPPLIER_DISCOVER_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const TableView: Story = {
  name: "Table view",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));
    await waitFor(() => expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "table"));
  },
};

// A table row lights up under the pointer, every cell (a-table-row-lights-up) — driven by `data-hover`.
export const ATableRowLightsUp: Story = {
  name: "Row lights up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));

    const row = await canvas.findByTestId(`discover-supplier-row-${SUMBER.id}`);
    await waitFor(() => expect(row.tagName).toBe("TR"));
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// THE TABLE SHOWS THE DESCRIPTION — what the supplier sells, in its own column; a dash when it has none
// (discover-table-shows-the-description).
export const TheTableShowsTheDescription: Story = {
  name: "Description column",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));

    await waitFor(() =>
      expect(within(canvas.getByTestId("discover-suppliers-table")).getByRole("columnheader", { name: "Description" })).toBeVisible(),
    );
    await expect(canvas.getByTestId(`discover-table-description-${NUSANTARA.id}`)).toHaveTextContent(NUSANTARA.description);
    await expect(canvas.getByTestId(`discover-table-description-${SINAR.id}`)).toHaveTextContent("—");
  },
};

// …and the table carries them last, at the right edge, as the supplier list does — a dash for a supplier none of whose
// goods ever arrived.
export const TheTableCarriesTheFiguresLast: Story = {
  name: "Figures last",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));
    await waitFor(() => expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "table"));

    const headers = within(canvas.getByTestId("discover-suppliers-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    await expect(headers.at(-2)).toMatch(/^Sold/);
    await expect(headers.at(-1)).toMatch(/^Ready/);
    await expect(canvas.getByTestId(`discover-sold-${SUMBER.id}`)).toHaveTextContent(/^1\.507ordered \w+ \d+, \d{4}$/);
    await expect(canvas.getByTestId(`discover-ready-${SUMBER.id}`)).toHaveTextContent(/^151restocked \w+ \d+, \d{4}$/);
    await expect(canvas.getByTestId(`discover-sold-${SINAR.id}`)).toHaveTextContent("—");
  },
};

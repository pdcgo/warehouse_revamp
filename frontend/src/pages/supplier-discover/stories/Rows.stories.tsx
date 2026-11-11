import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { SUPPLIER_DISCOVER_META, LIVE, NUSANTARA, loaded, rows } from "./kit";

// DISCOVER SUPPLIERS — the list itself — every team's suppliers, cards first or a table
// (discover-is-cards-or-a-table), the pager, and where a row opens. The page's stories are grouped by the part of the
// screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSuppliers/Rows",
  ...SUPPLIER_DISCOVER_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // deleted

// Across EVERY team — this one's included — each row naming the team that keeps the supplier. Real rows; a deleted
// supplier has left the list. (Only the figures and their filters are marked — see below.)
export const EveryTeamsSuppliers: Story = {
  name: "Every team's",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(LIVE.length));
    for (const team of ["Toko Melati", "Toko Kenanga", "Toko Anggrek"]) {
      await expect(canvas.getByTestId("discover-suppliers-table")).toHaveTextContent(team);
    }
    await expect(canvas.queryByTestId(`discover-supplier-row-${LAMA_TUTUP.id}`)).toBeNull();
  },
};

// CARDS FIRST, a table on a switch — the same rows either way, and the filters and the page carry across.
export const CardsFirstThenATable: Story = {
  name: "Cards first, then a table",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "cards");
    await expect(within(canvas.getByTestId("discover-suppliers-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const shown = rows(canvas).length;

    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));
    await waitFor(() => expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "table"));
    await expect(within(canvas.getByTestId("discover-suppliers-table")).getAllByRole("columnheader").length).toBeGreaterThan(0);
    await expect(rows(canvas)).toHaveLength(shown);

    await userEvent.click(canvas.getByTestId("discover-suppliers-view-cards"));
    await waitFor(() => expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "cards"));
  },
};

// Twelve suppliers at ten a page: two pages.
export const Paginates: Story = {
  name: "Pages",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-suppliers-pager-size"));
    const ten = await canvas.findByRole("option", { name: "10" });
    await waitFor(() => expect(ten).toBeVisible());
    await userEvent.click(ten);
    await waitFor(() => expect(rows(canvas)).toHaveLength(10));

    await userEvent.click(canvas.getByTestId("discover-suppliers-pager-next"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(LIVE.length - 10));
  },
};

// A row opens the DISCOVER detail — never the manage detail, which carries the owning team's actions.
export const ARowOpensTheDiscoverDetail: Story = {
  name: "Opens the Discover detail",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`discover-supplier-row-${NUSANTARA.id}`));
    await canvas.findByTestId("at-discover-detail");
    await expect(canvas.queryByTestId("at-manage-detail")).toBeNull();
  },
};

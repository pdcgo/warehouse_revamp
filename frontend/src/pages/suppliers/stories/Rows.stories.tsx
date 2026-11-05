import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { SUPPLIERS_META, BANYAK, SINAR, SUMBER, loaded, rowNames } from "./kit";

// SUPPLIERS — the columns and what a row shows (the-suppliers-list-follows-the-screen-rules) — whose suppliers, the
// stores as badges, the contact, the sort, the pager, the hover. The page's stories are grouped by the part of the
// screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/Suppliers/Rows",
  ...SUPPLIERS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's — never on team 12's list
const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // team 12's, deleted

// the-supplier-has-no-code · no-province-or-city: Name, Contact, Address — no Code, no City.
export const TheDecidedColumns: Story = {
  name: "No code, no city",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = canvas.getByTestId("suppliers-table");

    await expect(within(table).queryByText("Code")).toBeNull();
    await expect(within(table).queryByText("City")).toBeNull();
    await expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toHaveTextContent(SUMBER.address);
  },
};

// The page lists THIS team's live suppliers only: another selling team's is Discover's question, and a deleted one
// has left every list (a-deleted-supplier-is-kept-for-its-figures).
export const OnlyThisTeamsLiveSuppliers: Story = {
  name: "Only this team's, live",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId(`supplier-row-${MAKMUR_JAYA.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`supplier-row-${LAMA_TUTUP.id}`)).toBeNull();
  },
};

// THE COLUMNS ARE DISCOVER'S, MINUS THE TEAM — the supplier and where it is (two lines), its stores as one badge per
// type, its contact. A deleted store is not a badge (a-store-delete-is-soft-too): PT Sumber Makmur's Lazada is gone.
export const ItsStoresAreBadges: Story = {
  name: "Stores as badges",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const sumber = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    await expect(sumber).toHaveTextContent("Shopee");
    await expect(sumber).toHaveTextContent("Tokopedia");
    await expect(sumber).not.toHaveTextContent("Lazada");
    await expect(canvas.getByTestId(`supplier-row-${BANYAK.id}`)).toHaveTextContent("×3");
    // A supplier with no store reads a dash, and its address line too.
    await expect(canvas.getByTestId(`supplier-row-${SINAR.id}`)).toHaveTextContent("—");
  },
};

// THE CONTACT IS RIGHT OF THE SUPPLIER (the-contact-sits-right-of-the-supplier) — Pemasok, Kontak, then the stores and
// the figures.
export const TheContactIsRightOfTheSupplier: Story = {
  name: "Contact beside the supplier",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headers = within(canvas.getByTestId("suppliers-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    await expect(headers[0]).toMatch(/^Supplier/);
    await expect(headers[1]).toBe("Contact");
    await expect(headers[2]).toBe("Supplier stores");
  },
};

// THE NAME SORTS FROM ITS HEADING (a-table-sorts-from-its-headings) — the list's own order is newest first; the
// heading starts at A to Z, then flips. The server sorts; a page is never re-sorted here.
export const TheNameSortsFromItsHeading: Story = {
  name: "Sort by name",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowNames(canvas)).toEqual(["PT Banyak Toko", "Toko Grosir Sinar", "CV Cahaya Abadi", "PT Sumber Makmur"]);

    await userEvent.click(canvas.getByTestId("supplier-sort-name"));
    await waitFor(() =>
      expect(rowNames(canvas)).toEqual(["CV Cahaya Abadi", "PT Banyak Toko", "PT Sumber Makmur", "Toko Grosir Sinar"]),
    );

    await userEvent.click(canvas.getByTestId("supplier-sort-name"));
    await waitFor(() =>
      expect(rowNames(canvas)).toEqual(["Toko Grosir Sinar", "PT Sumber Makmur", "PT Banyak Toko", "CV Cahaya Abadi"]),
    );
  },
};

// The pages grow as they are opened, as on the accounts list.
export const TheGrowingPager: Story = {
  name: "Growing pager",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("suppliers-pager")).toBeVisible();
  },
};

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (owner: *"hoverable"*, `a-supplier-row-lights-up`) — as the
// account's statement does.
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const ASupplierRowLightsUp: Story = {
  name: "Row lights up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

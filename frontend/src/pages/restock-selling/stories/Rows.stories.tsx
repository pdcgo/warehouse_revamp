import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SELLING_META, loaded } from "./kit";

// RESTOCK SELLING — the screen's own rules and what a row shows — its columns, its references, its value and its badges. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Rows",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE SCREEN NAMES ITSELF (the-desktop-shell-has-no-top-bar) and its action carries its icon
// (an-action-button-carries-its-icon); the picked tab is bold (a-selected-tab-is-bold); the pager is on screen even on
// one page (the-pager-is-always-on-screen).
export const TheScreenRules: Story = {
  name: "Screen rules",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Restock" })).toBeVisible();
    await expect(canvas.getByTestId("open-create-restock").querySelector("svg")).not.toBeNull();
    await expect(getComputedStyle(canvas.getByTestId("restock-tab-all")).fontWeight).toBe("700");
    await expect(getComputedStyle(canvas.getByTestId("restock-tab-ongoing")).fontWeight).not.toBe("700");
    await expect(canvas.getByTestId("restock-pager")).toBeVisible();
    // Created: when, and by whom under it — two lines, never three.
    const created = canvas.getByTestId("restock-created-by-501");
    await expect(created).toHaveTextContent("by Ani Rahayu");
    await expect(created.parentElement).toHaveTextContent(/\d{2}:\d{2}by /);
  },
};

// THE OWNER'S COLUMN ORDER (the-restock-list-leads-with-its-references) — the reference first, then the supplier, the
// warehouse, the products, the total, the courier, the status, the two dates and the actions.
export const TheReferenceLeadsTheRow: Story = {
  name: "Columns",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headings = within(canvas.getByTestId("restock-requests-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());

    await expect(headings).toEqual([
      "Reference",
      "Supplier",
      "Warehouse",
      "Products",
      "Total",
      "Shipment",
      "Status",
      "Created",
      "Accepted",
      "Actions",
    ]);
    // Our own number is not on the row.
    await expect(canvas.getByTestId("restock-row-503")).not.toHaveTextContent("#503");
  },
};

// THE ORDER NUMBER AND THE TRACKING NUMBER ARE COPYABLE, and a long one is cut with its tooltip saying it whole (owner:
// *"order id dan resinya copyable … harus ada pembatasan tapi juga harus ada cara lihat fullnya"*). Copying never opens
// the restock under it.
export const TheReferencesCopyAndALongOneIsCut: Story = {
  name: "Copy, and a long one cut",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 504's tracking number runs long: cut on the row, whole in its tooltip and in what is copied.
    const shown = canvas.getByTestId("restock-receipt-504-shown");
    await expect(shown.scrollWidth).toBeGreaterThan(shown.clientWidth);
    await expect(canvas.getByTestId("restock-receipt-504")).toHaveAccessibleName("Copy: JNE-CGK-20260911-0000111122-REG");
    await userEvent.hover(canvas.getByTestId("restock-receipt-504"));
    const whole = await screen.findByTestId("restock-receipt-504-whole");
    await waitFor(() => expect(whole).toBeVisible());
    await expect(whole).toHaveTextContent("JNE-CGK-20260911-0000111122-REG");
    await userEvent.unhover(canvas.getByTestId("restock-receipt-504"));

    // A short one is shown whole.
    const short = canvas.getByTestId("restock-receipt-503-shown");
    await expect(short.scrollWidth).toBeLessThanOrEqual(short.clientWidth);

    await userEvent.click(canvas.getByTestId("restock-invoice-503"));
    await waitFor(() => {
      const el = canvas.getByTestId("restock-invoice-503");
      expect(el.hasAttribute("data-copied") || el.hasAttribute("data-copy-failed")).toBe(true);
    });
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const ARowLightsUp: Story = {
  name: "Lights up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("restock-row-503");
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// the-couriers-charge-stays-out-of-total — 503's Value is goods 950.000 + shipping 30.000, not the 5.000 the courier
// asked at the door.
export const TheValueIsGoodsPlusShipping: Story = {
  name: "Value",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-value-503")).toHaveTextContent("Rp 980.000");
    await expect(canvas.getByTestId("restock-value-501")).toHaveTextContent("Rp 2.080.000");
  },
};

// a-short-unit-at-the-door-is-missing — an accepted row with units short says MISSING.
export const MissingUnitsAreFlagged: Story = {
  name: "Missing badge",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-missing-503")).toHaveTextContent("1 missing");
    await expect(canvas.queryByTestId("restock-missing-501")).toBeNull();
  },
};

// The supplier is read off the lines, and a deleted store still shows, badged (a-deleted-supplier-still-shows-with-a-
// badge). The invoice and the tracking number are labelled.
export const SupplierInvoiceAndCourier: Story = {
  name: "Supplier and references",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("restock-supplier-503")).toHaveTextContent("PT Sumber Makmur"));
    await waitFor(() => expect(within(canvas.getByTestId("restock-supplier-507")).getByTestId("deleted-badge")).toBeVisible());
    // 501's lines name two suppliers — the first, and "+1 more".
    await expect(canvas.getByTestId("restock-supplier-501")).toHaveTextContent("+1 more supplier");
    await expect(canvas.getByTestId("restock-invoice-503")).toHaveTextContent("INV/2026/09/0412");
    await expect(canvas.getByTestId("restock-receipt-503")).toHaveTextContent("SCP5544332211");
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { WAREHOUSE_META, loaded } from "./kit";

// RESTOCK WAREHOUSE — the screen's own rules and what a row shows — who and when, the courier, its products.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouse/Rows",
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE SCREEN RULES (the-warehouse-restock-list-follows-the-screen-rules) — the page names itself
// (the-desktop-shell-has-no-top-bar); the queue's figures are the card strip, the count leading
// (a-list-summary-is-the-order-lists-card-strip); the picked tab is bold (a-selected-tab-is-bold); a row's date is short,
// with its time (a-table-date-is-short-and-every-time-is-wib); the pager is on screen on one page
// (the-pager-is-always-on-screen).
export const TheScreenRules: Story = {
  name: "Screen rules",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Incoming Restocks" })).toBeVisible();
    await expect(canvas.getByTestId("restock-inbound-summary")).toBeVisible();
    await expect(canvas.getByTestId("restock-stat-restocks")).toHaveAttribute("data-emphasis", "true");
    await expect(getComputedStyle(canvas.getByTestId("restock-tab-all")).fontWeight).toBe("700");
    await expect(canvas.getByTestId("restock-inbound-pager")).toBeVisible();
  },
};

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const ARowLightsUp: Story = {
  name: "Lights up",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("restock-row-501");
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// The courier is a shipment channel, named.
export const TheCourierIsNamed: Story = {
  name: "Courier named",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId("shipment-channel-badge-jne")).toHaveTextContent("JNE"));
    await expect(row).toHaveTextContent("JNE0123456789");
  },
};

// WHO AND WHEN (owner: *"tablenya dari itu team besar lalu usernya kecil di bawah"*, *"ada tanggal dibuat dan sampai"*,
// the-inbound-row-says-who-and-when) — Dari is the team, who raised it small under it; Dibuat and Tiba are their own
// columns, short and with the time; Tiba names who signed for the box, and is a dash until the box is at the door. (The
// column was Sampai; it says the status's own word now — tiba-marks-and-terima-is-final.)
export const TheRowSaysWhoAndWhen: Story = {
  name: "Who and when",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const heads = within(canvas.getByTestId("restock-inbound-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);

    await expect(heads).toEqual(["Restock", "From", "Products", "Shipment", "Status", "Created", "Arrived", "Actions"]);
    await expect(canvas.getByTestId("restock-open-501")).toHaveTextContent(/^#501$/);
    await expect(canvas.getByTestId("restock-from-501")).toHaveTextContent("Toko Melati");
    await waitFor(() => expect(canvas.getByTestId("restock-created-by-501")).toHaveTextContent(/^by /));
    await expect(canvas.getByTestId("restock-created-501")).toHaveTextContent(/^\d{1,2} \w{3} \d{2}:\d{2}$/);
    await expect(canvas.getByTestId("restock-arrived-501")).toHaveTextContent("—");
    await expect(canvas.getByTestId("restock-arrived-502")).toHaveTextContent(/\d{2}:\d{2}/);
    await waitFor(() => expect(canvas.getByTestId("restock-arrived-502-by")).toHaveTextContent("by Budi Santoso"));
  },
};

// "+N MORE" STARTS AT THE TEXT'S LEFT EDGE (owner: *"produk more harusnya sama teks rata kiri"*) — not centred in the cell.
export const TheMoreProductsLineStartsAtTheLeft: Story = {
  name: "+N more at the left",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const more = within(canvas.getByTestId("restock-row-501")).getByTestId("restock-items-more");
    const summary = more.parentElement!.firstElementChild as HTMLElement;

    await expect(Math.abs(more.getBoundingClientRect().left - summary.getBoundingClientRect().left)).toBeLessThan(1);
  },
};

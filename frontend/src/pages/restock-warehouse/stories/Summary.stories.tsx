import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { WAREHOUSE_META, loaded } from "./kit";

// RESTOCK WAREHOUSE — the card strip — the queue still to do, and the COD this warehouse paid; never the restock's money.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouse/Summary",
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The headline is the queue still to do — ongoing AND arrived — over every restock to this warehouse, not the page.
export const TheHeadlineCountsOngoingAndArrived: Story = {
  name: "Headline count",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 501 and 506 ongoing, 502 arrived — 504 is lost and 503/507 accepted, so they are not waiting.
    await waitFor(() => expect(canvas.getByTestId("restock-stat-restocks")).toHaveTextContent("3"));
  },
};

// THE WAREHOUSE SEES NO RESTOCK MONEY, ONLY THE COD IT PAID (owner: *"gudang tidak perlu tahu nilai restok, tapi nilai cod
// yang mereka bayarkan mungkin lebih baik"*, the-warehouse-sees-the-cod-it-paid) — no queue value; the last card is the
// courier's charge it paid this month, marked as a sample until a read sums it; no row carries a price.
export const TheWarehouseSeesOnlyTheCodItPaid: Story = {
  name: "Only the COD it paid",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const strip = canvas.getByTestId("restock-inbound-summary");

    await expect(strip).not.toHaveTextContent("Queue value");
    const cod = canvas.getByTestId("restock-stat-cod");
    await expect(cod).toHaveTextContent("COD paid");
    await expect(canvas.getByTestId("restock-stat-cod-value")).toHaveTextContent(/^Rp /);
    await expect(cod).toHaveTextContent(/this month · \d+ restocks/);
    await expect(within(cod).getByTestId(/^not-implemented-/)).toBeVisible();
    await expect(strip.lastElementChild).toBe(cod);
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(canvas.getByTestId("restock-inbound-table")).not.toHaveTextContent("Rp");
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { restockCodPaidForStory } from "../../../../.storybook/restockStub";
import { restockReadScenario } from "../../../../.storybook/restockReadScenario";
import { firstOfMonthBack, jakartaDayEndUnix, jakartaDayStartUnix, jakartaToday } from "../../../lib/jakartaDay";
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
// courier's charge it paid this month, summed by the server, unmarked; no row carries a price.
export const TheWarehouseSeesOnlyTheCodItPaid: Story = {
  name: "Only the COD it paid",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const strip = canvas.getByTestId("restock-inbound-summary");

    await expect(strip).not.toHaveTextContent("Queue value");
    const cod = canvas.getByTestId("restock-stat-cod");
    await expect(cod).toHaveTextContent("COD paid");
    await waitFor(() => expect(canvas.getByTestId("restock-stat-cod-value")).toHaveTextContent(/^Rp /));
    await expect(cod).toHaveTextContent(/this month · \d+ restocks?/);
    await expect(within(cod).queryByTestId(/^not-implemented-/)).toBeNull();
    await expect(strip.lastElementChild).toBe(cod);
    await expect(canvas.getByTestId("restock-inbound-table")).not.toHaveTextContent("Rp");
  },
};

// THE COD IS THIS MONTH'S, AND ONLY WHAT IT PAID (the-warehouse-sees-the-cod-it-paid) — 503 (Rp 5.000) and 507 (Rp 12.000)
// accepted this month carried a courier's charge: Rp 17.000 · 2 restocks. 504's Rp 30.000 was accepted the last second of
// last month, and is not in it. The card asks the server for this JAKARTA month — 00:00 WIB on the 1st through 23:59:59
// WIB today — and nothing narrows it: not the FROM lens, which is the queue's.
export const TheCodIsThisMonthsOnly: Story = {
  name: "COD, this month only",
  beforeEach: () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const lastMonthEnd = jakartaDayStartUnix(firstOfMonthBack(jakartaToday(), 0)) - 1n;
    restockCodPaidForStory(503n, 5000, now - 60n);
    restockCodPaidForStory(507n, 12000, now - 120n);
    restockCodPaidForStory(504n, 30000, lastMonthEnd);
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("restock-stat-cod-value")).toHaveTextContent("Rp 17.000"));
    await expect(canvas.getByTestId("restock-stat-cod")).toHaveTextContent("this month · 2 restocks");

    const today = jakartaToday();
    await expect(restockReadScenario.codWindows).toContainEqual({
      teamId: 11n,
      fromUnix: jakartaDayStartUnix(firstOfMonthBack(today, 0)),
      toUnix: jakartaDayEndUnix(today),
    });
  },
};

import { Badge } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { OrderSummary } from "./OrderSummary";
import type { OrderSummaryRow } from "./stat";
import { orderSummaryTotal } from "./stat";

// THE SUMMARY ABOVE THE ORDER LIST. A card strip that never changes, and a measure line under it
// that follows the status tab above.
//
// The rules pinned here are the ones that make it safe to put money over a work queue: a cost that
// was never recorded must never render as a zero, the margin must come off the GOODS and not off the
// total, and the strip must stay a thing you read rather than one you operate.
//
// ⚠ THE ROWS ARE KEYED BY THE CALLER'S OWN NAMES, not by the proto enum — the screen's vocabulary is
// the owner's eight statuses and the contract carries six, differently named. That is why the badge
// arrives as a prop: naming and colouring a pile is the page's job, not this component's.

function priced(key: string, count: number, value: bigint): OrderSummaryRow {
  // What the platform actually paid sits a little under our quote, which is the whole reason the
  // margin is measured against it rather than against `value`.
  const mpValue = (value * 98n) / 100n;

  return {
    key,
    onTheWire: true,
    count,
    value,
    mpValue,
    cogs: (mpValue * 62n) / 100n,
    fees: 3_000n * BigInt(count),
    marginUnknown: 0,
    itemCount: count * 3,
  };
}

const ROWS: OrderSummaryRow[] = [
  priced("pending", 2, 430_000n),
  // ⚠ THE ONE NOTHING IS PRICED IN. Its revenue, cost and fees are 0 because there is nothing to add,
  // and `marginUnknown === count` is what tells the screen that 0 is an absence rather than an amount.
  {
    key: "processed",
    onTheWire: true,
    count: 1,
    value: 420_000n,
    mpValue: 0n,
    cogs: 0n,
    fees: 0n,
    marginUnknown: 1,
    itemCount: 3,
  },
  priced("shipped", 2, 640_000n),
  priced("cancel", 1, 360_000n),
  // ⚠ A STAGE THE CONTRACT HAS NO STATUS FOR — `completed` is one of the owner's eight and the enum
  // has no value for it, so every figure is unknown rather than zero.
  {
    key: "completed",
    onTheWire: false,
    count: 0,
    value: 0n,
    mpValue: null,
    cogs: null,
    fees: null,
    marginUnknown: null,
    itemCount: null,
  },
];

const TOTAL = orderSummaryTotal(ROWS);

const BLANK = ROWS.map((row) => ({
  ...row,
  mpValue: null,
  cogs: null,
  fees: null,
  marginUnknown: null,
  itemCount: null,
}));

const badge = (row: OrderSummaryRow) => <Badge colorPalette="gray">{row.key}</Badge>;

const meta = {
  title: "Features/Orders/OrderSummary",
  component: OrderSummary,
  parameters: {
    docs: {
      description: {
        component:
          "The order list's summary, by status first: a card per pile plus a total, and a measure line under them carrying the selected pile's figures. It sits below the status tabs and controls nothing — no card is pressable and none is highlighted, because the active tab directly above already says which pile the line belongs to. The strip is identical whether a status is filtered or not; only the line's numbers change. A figure the contract does not carry is an em-dash, never a zero, and a pile where no order has a recorded cost shows no margin at all rather than a confident 100%.",
      },
    },
  },
  args: { rows: ROWS, total: TOTAL, badge },
} satisfies Meta<typeof OrderSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const NoStatusFilter: Story = {};

export const AStatusSelected: Story = {
  args: { selectedKey: "shipped" },
};

// Every figure the contract does not carry, as `orderSummaryRows` returns them before any sample
// filler runs. This is what the strip looks like honestly.
export const NothingButTheCensus: Story = {
  args: { rows: BLANK, total: orderSummaryTotal(BLANK) },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// ⚠ THE STRIP DOES NOT CHANGE SHAPE WHEN THE TAB DOES (owner). Every card is present in both states
// — only the measure line's numbers move. The design this replaced drew cards for "All Status" and
// borderless tiles for a filtered one, so changing tab redrew the top of the screen.
export const TheSameCardsAreThereWhetherFilteredOrNot: Story = {
  args: { selectedKey: "shipped" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-summary-total")).toBeInTheDocument();
    for (const row of ROWS) {
      await expect(canvas.getByTestId(`order-summary-row-${row.key}`)).toBeInTheDocument();
    }

    // …and the measure line is there in both states too, carrying the SELECTED pile.
    await expect(canvas.getByTestId("order-summary-measures")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-summary-measure-atv")).toHaveTextContent("Rp 320.000");
  },
};

// With nothing filtered, the line carries the TOTAL — the strip is never without a subject.
export const WithNoFilterTheLineCarriesTheTotal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-summary-measure-tx")).toHaveTextContent(
      String(TOTAL.count),
    );
    await expect(canvas.getByTestId("order-summary")).toHaveAttribute("data-pile", "total");
  },
};

// ⚠ A COST THAT WAS NEVER RECORDED IS NOT ZERO. `order.proto` says a cogs of 0 means the goods were
// never restocked through this system — unknown, not free. Rendered as a number it produced a pile
// reading "Rp 0 · margin 100%", which is the most confident wrong figure this screen could print.
export const APileWithNoRecordedCostShowsNoMargin: Story = {
  args: { selectedKey: "processed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-summary-measure-spend")).toHaveTextContent("—");
    const margin = canvas.getByTestId("order-summary-measure-margin");
    await expect(margin).toHaveTextContent("—");
    // …and never a percentage, which is what made the zero look measured.
    await expect(margin).not.toHaveTextContent("%");

    // The note says there is no margin, rather than pointing at "the rest" when there is no rest.
    await expect(canvas.getByTestId("order-summary-cost-unknown")).toHaveTextContent(
      /no margin to show/i,
    );
  },
};

// …and when SOME are priced the margin stands, with the note saying how many it left out. The reader
// needs the figure AND its population; either alone is misleading.
export const APartlyPricedTotalSaysHowManyItLeftOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const note = canvas.getByTestId("order-summary-cost-unknown");
    await expect(note).toHaveTextContent("1");
    await expect(note).toHaveTextContent(String(TOTAL.count));
    await expect(note).not.toHaveTextContent(/no margin to show/i);
  },
};

// ⚠ THE MARGIN IS MEASURED AGAINST WHAT THE PLATFORM PAID, AND THE FEES ARE INSIDE THE COST
// (owner, 2026-09-28): `margin = harga MP − total beli`, `persentase = margin ÷ harga MP`.
//
// The shipped pile is 2 orders worth 640.000 of our own quote, of which the marketplace took 98%
// (627.200); the goods cost 62% of that (388.864) and the warehouse charges 3.000 an order (6.000).
// So the margin is 232.336 and the share is 37%.
//
// ⚠ THE TWO WRONG ANSWERS ARE BOTH CLOSE ENOUGH TO LOOK RIGHT, which is why this is pinned:
//
//   38%    → the fees were left out of total beli
//   36,3%  → it divided by OUR total instead of the marketplace's
//
// This replaced an assertion of 36% for `subtotal − cogs` over `subtotal` — a formula that also
// happens to be `order.proto`'s own, and answered a question the owner had not asked.
export const TheMarginIsMeasuredAgainstTheMarketplacePrice: Story = {
  args: { selectedKey: "shipped" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const margin = canvas.getByTestId("order-summary-measure-margin");
    await expect(margin).toHaveTextContent("Rp 232.336");
    await expect(margin).toHaveTextContent("37%");
    await expect(margin).not.toHaveTextContent("38%");
    await expect(margin).not.toHaveTextContent("36,3%");
  },
};

// ⚠ A CARD IS A HEADLINE, NOT SEVEN FIGURES. Each pile shows what it is worth, how many orders and
// whether it is earning — the rest lives on the one line below. A card carrying all seven was a
// table, and a table above a table is what this replaced.
export const ACardIsAHeadline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const card = canvas.getByTestId("order-summary-row-shipped");
    await expect(card).toHaveTextContent("Rp 640.000");
    await expect(card).toHaveTextContent("2 tx");
    await expect(card).toHaveTextContent("37%");
    // Not the supporting measures — those are on the line.
    await expect(card).not.toHaveTextContent("UPT");
  },
};

// ⚠ THE STRIP IS NOT A CONTROL (owner). It sits BELOW the status tabs and navigates, filters and
// selects nothing — the tab above is how a status is chosen. An earlier version made every card a
// button, which put two controls on one job directly above each other.
export const NoCardIsPressable: Story = {
  args: { selectedKey: "shipped" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const strip = canvas.getByTestId("order-summary");
    await expect(strip.querySelectorAll("button").length).toBe(0);
    await expect(strip.querySelectorAll("a").length).toBe(0);
  },
};

// ⚠ NO CARD IS HIGHLIGHTED EITHER (owner). Every card draws identically whatever the tab says — the
// active tab sits directly above the strip and already names the pile, so marking the card as well
// says it twice, and a highlight on something unpressable reads as a control that is broken.
export const NoCardIsHighlighted: Story = {
  args: { selectedKey: "shipped" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const cards = [
      canvas.getByTestId("order-summary-total"),
      ...ROWS.map((row) => canvas.getByTestId(`order-summary-row-${row.key}`)),
    ];

    const backgrounds = new Set(cards.map((el) => getComputedStyle(el).backgroundColor));
    const borders = new Set(cards.map((el) => getComputedStyle(el).borderColor));

    await expect(backgrounds.size).toBe(1);
    await expect(borders.size).toBe(1);
  },
};

// ⚠ A PILE THE CONTRACT CANNOT HOLD IS UNKNOWN, NOT ZERO. `completed` is one of the owner's eight
// statuses and the enum has no value for it — so "0 orders are completed" is a claim the contract
// cannot make, and printing it would be the confident-zero mistake one level up from a cogs of 0.
export const APileTheContractCannotHoldIsUnknown: Story = {
  args: { selectedKey: "completed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const card = canvas.getByTestId("order-summary-row-completed");
    await expect(card).toHaveTextContent("—");
    await expect(card).not.toHaveTextContent("Rp 0");
    await expect(card).not.toHaveTextContent("0 tx");

    // …and the measure line refuses everything too, the count included.
    for (const key of ["tx", "items", "upt", "atv", "spend", "margin"]) {
      await expect(canvas.getByTestId(`order-summary-measure-${key}`)).toHaveTextContent("—");
    }
  },
};

// The total is the rows added up, so it cannot disagree with the cards beside it. Read off the
// rendering rather than recomputed here — a test doing its own arithmetic would pass while the
// screen showed something else.
export const TheTotalAgreesWithTheCardsBesideIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const total = canvas.getByTestId("order-summary-total");
    await expect(total).toHaveTextContent(`${TOTAL.count} tx`);
    // 430 + 420 + 640 + 360, summed from the rows rather than sent separately by the server.
    await expect(total).toHaveTextContent("Rp 1.850.000");
  },
};

// A figure the contract does not carry is an em-dash everywhere it appears — never a 0 that reads as
// a measured result.
export const AFigureTheContractDoesNotCarryIsADash: Story = {
  args: { rows: BLANK, total: orderSummaryTotal(BLANK) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The count and the transaction value are real and still render.
    const total = canvas.getByTestId("order-summary-total");
    await expect(total).toHaveTextContent("Rp 1.850.000");
    await expect(total).toHaveTextContent("—");
    await expect(total).not.toHaveTextContent("%");

    for (const key of ["items", "upt", "spend", "margin"]) {
      await expect(canvas.getByTestId(`order-summary-measure-${key}`)).toHaveTextContent("—");
    }

    // …and with no cost recorded anywhere, there is no note to write either.
    await expect(canvas.queryByTestId("order-summary-cost-unknown")).toBeNull();
  },
};

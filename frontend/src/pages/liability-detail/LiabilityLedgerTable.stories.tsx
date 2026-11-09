import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { expect, within } from "storybook/test";

import { liabilityEntries } from "../../../.storybook/fixtures";
import { LiabilityLogSchema, LiabilitySourceType } from "../../gen/warehouse/liability/v1/liability_pb";
import { LiabilityLedgerTable } from "./components/LiabilityLedgerTable";

// ONE DIRECTION OF A RELATIONSHIP'S LEDGER — the receivable or the payable tab of the liability
// detail, on its own so it can be read beside the other ledgers (settlement, financial account, stock).
//
//   | story            | the rule it pins                                              |
//   | ---------------- | ------------------------------------------------------------- |
//   | Receivable       | a cause in words, the sign spelled out, the balance it left   |
//   | Payable          | the other direction reads as a minus                          |
//   | AReversalIsLabelled | a reversal says so — never left to be read off a sign      |
//   | Empty            | the tab's own sentence, not an empty table                    |
//   | EveryCauseReadsInItsBusinessWords | each source type is the business's word + the record it came from |
//   | TheWholeLedgerRunsRowToRow | the All tab: both directions in their order, each balance the one below plus its amount |
//   | OnAPhoneEachEntryIsABlock | a block per entry, the balance after on its second line       |

// The page's own fixtures — the same rows the liability detail story serves.
const rows = liabilityEntries.map((e) => create(LiabilityLogSchema, e));
const receivable = rows.filter((e) => e.amount > 0);
const payable = rows.filter((e) => e.amount < 0);

// A lost item that turned up again: the warehouse gives back what it was charged, and says so.
const found = create(LiabilityLogSchema, {
  id: 599n,
  teamId: 11n,
  counterpartyId: 12n,
  amount: 450_000,
  sourceType: LiabilitySourceType.FOUND,
  sourceId: 6001n,
  reversal: true,
  groupId: 3n,
  balanceAfter: 7_920_000,
  createdAtUnix: 1_756_100_000n,
});

const meta = {
  title: "Pages/Liability/Ledger Table",
  component: LiabilityLedgerTable,
  args: { rows: receivable, emptyText: "Nothing is owed to you in this period." },
} satisfies Meta<typeof LiabilityLedgerTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What they owe us: each row names its cause and spells out its sign. */
export const Receivable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByTestId(`liability-detail-entry-${receivable[0]!.id}`);

    await expect(canvas.getAllByTestId(/^liability-detail-entry-/)).toHaveLength(receivable.length);
    await expect(first).toHaveTextContent("+Rp 30.000");
    await expect(first).toHaveTextContent("Rp 8.700.000");
  },
};

/** What we owe them — the minus is written, not implied by a colour. */
export const Payable: Story = {
  args: { rows: payable, emptyText: "You owe nothing in this period." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId(`liability-detail-entry-${payable[0]!.id}`)).toHaveTextContent("−Rp 450.000");
  },
};

/** A reversal is labelled and shaded, so it cannot be mistaken for a new charge. */
export const AReversalIsLabelled: Story = {
  args: { rows: [found, ...receivable] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId(`liability-detail-reversal-${found.id}`)).toBeInTheDocument();
  },
};

/** No rows is the tab's own sentence, not a table with a header and nothing under it. */
export const Empty: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("liability-ledger-empty")).toHaveTextContent("Nothing is owed to you");
    await expect(canvas.queryByTestId("liability-ledger-table")).toBeNull();
  },
};

// THE LEDGER SPEAKS THE BUSINESS'S WORDS (the-ledger-speaks-the-business-words): every source type a pair can post, each
// naming the record it came from — the pair's whole ledger from the page fixture, plus a product fee, which only ever
// moves between two SELLING teams and so has no row on a warehouse pair.
const productFee = create(LiabilityLogSchema, {
  id: 598n,
  teamId: 12n,
  counterpartyId: 13n,
  amount: 72_000,
  sourceType: LiabilitySourceType.PRODUCT_FEE,
  sourceId: 9002n,
  reversal: false,
  groupId: 12n,
  balanceAfter: 72_000,
  createdAtUnix: 1_756_050_000n,
});

export const EveryCauseReadsInItsBusinessWords: Story = {
  args: { rows: [productFee, ...rows] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByTestId("liability-ledger-table");

    for (const words of [
      "Order fee · order #9001",
      "Product fee · order #9002",
      "Courier at a restock · restock #7001",
      "Courier at a return · order #8811",
      "Courier on a transfer · transfer #3101",
      "Goods broken · movement #6001",
      "Goods lost · movement #6101",
      "Goods found again · movement #6102",
      "Payment #601",
    ]) {
      await expect(table).toHaveTextContent(words);
    }

    // The find and the cancelled order's fee give money back, and say so.
    await expect(canvas.getByTestId("liability-detail-reversal-507")).toBeInTheDocument();
    await expect(canvas.getByTestId("liability-detail-reversal-509")).toBeInTheDocument();
  },
};

/**
 * THE ALL TAB'S ROWS (the-team-balance-screens-are-accepted) — both directions in the ledger's order, the payment and
 * the reversals in their place, and *Balance after* on every row: each one is the row below it plus its own amount, so
 * the column runs without a gap.
 */
export const TheWholeLedgerRunsRowToRow: Story = {
  args: { rows, emptyText: "Nothing has moved between you in this range." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shown = canvas.getAllByTestId(/^liability-detail-entry-/);

    await expect(shown.map((r) => r.dataset.testid)).toEqual(rows.map((r) => `liability-detail-entry-${r.id}`));
    for (let i = 0; i + 1 < rows.length; i++) {
      await expect(rows[i]!.balanceAfter).toBe(rows[i + 1]!.balanceAfter + rows[i]!.amount);
    }
    for (const r of rows) {
      await expect(canvas.getByTestId(`liability-detail-balance-after-${r.id}`)).toHaveTextContent(/Rp [0-9.]+/);
    }
    // A payable movement sits in the run, with its minus — the Receivable cut would have skipped it.
    await expect(canvas.getByTestId("liability-detail-entry-503")).toHaveTextContent("−Rp 450.000");
    await expect(canvas.getByTestId("liability-detail-balance-after-503")).toHaveTextContent("Rp 7.470.000");
  },
};

/**
 * ON A PHONE EACH ENTRY IS A BLOCK (a-phone-reads-each-line-as-a-block, the-team-balance-phone-layout-is-accepted): the
 * cause and the movement on the first line, the day and *Balance after* on the second — no four clamped columns.
 */
export const OnAPhoneEachEntryIsABlock: Story = {
  args: { rows, emptyText: "Nothing has moved between you in this range.", phone: true },
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ledger = canvas.getByTestId("liability-ledger-table");

    await expect(ledger.tagName).not.toBe("TABLE");
    await expect(ledger).toHaveAttribute("data-layout", "blocks");
    await expect(canvas.getByTestId("liability-detail-entry-501")).toHaveTextContent("Order fee · order #9001");
    await expect(canvas.getByTestId("liability-detail-balance-after-501")).toHaveTextContent("Balance after Rp 8.700.000");
    await expect(canvas.getByTestId("liability-detail-entry-503")).toHaveTextContent("−Rp 450.000");
  },
};

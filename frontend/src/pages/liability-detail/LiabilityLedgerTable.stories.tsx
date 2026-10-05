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

// The page's own fixtures — the same rows the liability detail story serves.
const rows = liabilityEntries.map((e) => create(LiabilityLogSchema, e));
const receivable = rows.filter((e) => e.amount > 0n);
const payable = rows.filter((e) => e.amount < 0n);

// A lost item that turned up again: the warehouse gives back what it was charged, and says so.
const found = create(LiabilityLogSchema, {
  id: 599n,
  teamId: 11n,
  counterpartyId: 12n,
  amount: 450_000n,
  sourceType: LiabilitySourceType.FOUND,
  sourceId: 6001n,
  reversal: true,
  groupId: 3n,
  balanceAfter: 7_920_000n,
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

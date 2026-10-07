import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { OrderLedgerPanel } from "./components/OrderLedgerPanel";
import { ahead, awaiting, correctedByHand, lateFee, noEstimate, worked } from "./fixtures";
import { hiddenCost, loss, netReceived } from "./model";
import type { OrderSettlement, SettlementEntry } from "./model";

// ONE ORDER'S SETTLEMENT LEDGER — and the argument for the whole design.
//
// ⚠ A PROTOTYPE, not a build (`implementation_analysis`). No service, no proto, no route: the panel
// takes its ledger as a prop. What is being reviewed here is whether the SCREEN is right, before the
// contract is derived from it.
//
// Every story below pins a rule that is otherwise invisible — the kind that reads as a styling choice
// until somebody "tidies" it and the screen starts lying:
//
//   | story          | the rule it holds                                                        |
//   | -------------- | ------------------------------------------------------------------------ |
//   | WorkedExample  | the owner's own table, rendered — and the balance labelled LOST           |
//   | Awaiting       | an order with only its sale recorded is not an error and not a queue item       |
//   | LateFee        | a fee that arrived after the day it belongs to shows the GAP              |
//   | ManualAndReversal | append-only: no edit, no delete, the mistake stays visible             |
//   | CameOutAhead   | a positive balance renders as a GAIN, not a smaller loss                  |
//   | NoEstimate     | zero means "not recorded" — the panel refuses rather than inventing       |
//   | ReadOnly       | without posting rights there is no Add and no Reverse                     |
//   | TheDetailLeadsWithTheSource          | Detail: the source badge first, then the note          |
//   | AReversalSaysWhatItUndoes            | a reversal names the amount and the day it undoes        |
//   | TheCardsSayHowManyEntries            | Received and the adjustment count the rows after the sale |
//   | NoTotalBeliNoMargins                 | without the host's total beli, no margin card at all     |
//   | TwoMarginsDifferByTheAdjustment      | estimated and true margin, apart by exactly the adjustment |
//   | TheMarginsSayWhereTheyComeFrom       | each margin's note names its formula                     |
//   | TheBalanceReadsLikeTheChange         | the balance is signed like the change, and bold          |
//   | TheMarginOpensItsBreakdown           | "Rincian ›" opens how the true margin adds up             |
//   | Mobile                               | the panel at phone width — review in the workbench        |
//
// ⚠ EVERY STORY GETS A `totalBeli` BY DEFAULT (owner) — 80.000, what the order cost us all in — so the two
// margin cards are on screen as the order detail shows them. `NoTotalBeliNoMargins` is the one that
// leaves it out, to show what the panel does without it.
const meta = {
  title: "Pages/Order Settlement/Ledger Panel",
  component: OrderLedgerPanel,
  args: { totalBeli: 80_000n },
} satisfies Meta<typeof OrderLedgerPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * `context.md` §Settlement Behaviors, row for row.
 *
 * The check is arithmetic, not appearance: sold for 120.000, received 110.000, lost 10.000 — and
 * **20.000 of that was never itemised** while named rows gave 10.000 back. That split is the whole
 * point of `hidden-cost-is-left-in-the-balance`, and it is the number a single "balance" column
 * would hide.
 */
export const WorkedExample: Story = {
  args: { settlement: worked, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The doc's four rows, and the doc's final balance.
    await expect(canvas.getAllByTestId(/^entry-/)).toHaveLength(4);
    await expect(canvas.getByTestId("ledger-table")).toHaveTextContent("−Rp 10.000");

    // 120.000 − 100.000 = 20.000 kept and never explained. −10.000 + 20.000 = +10.000 named.
    await expect(hiddenCost(worked)).toBe(20_000n);
    await expect(netReceived(worked)).toBe(110_000n);
    await expect(loss(worked)).toBe(10_000n);

    // ⚠ The word is LOST. `a-residual-balance-is-normal` means nobody is collecting this, so any
    // label implying a debt — "outstanding", "unpaid", "due" — would be wrong on every order.
    const summary = canvas.getByTestId("settlement-summary");
    await expect(summary).toHaveTextContent("Adjustment");
    await expect(summary).not.toHaveTextContent(/outstanding|unpaid|due/i);
  },
};

/**
 * Placed, nothing back yet. Holds only the sale it opened with.
 *
 * `settlement-ignores-our-order-status` lets this persist for as long as the platform likes — so the
 * panel must render it as an ordinary state, with no warning and nothing to act on.
 */
export const Awaiting: Story = {
  args: { settlement: awaiting, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId(/^entry-/)).toHaveLength(1);
    // The whole sale is unreceived so far, which is exactly right and must not look like an alarm.
    await expect(loss(awaiting)).toBe(85_000n);
    await expect(canvas.queryByTestId("no-estimate-notice")).not.toBeInTheDocument();
  },
};

/**
 * A fee that BELONGS to 31 December and was LEARNED on 6 January.
 *
 * The argument for `two-dates-occurred-and-posted`. With one date column this charge either lands in
 * a closed month or silently moves to the wrong one — and either way the screen cannot show that it
 * arrived late, which is the single most common thing about settlement (`§3`).
 */
export const LateFee: Story = {
  args: { settlement: lateFee, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const markers = canvas.getAllByTestId("late-marker");
    await expect(markers).toHaveLength(1);
    await expect(markers[0]).toHaveTextContent("2026-01-06");
    // Only the late row is marked — a marker on every row would carry no information.
    await expect(canvas.getAllByTestId(/^entry-/)).toHaveLength(3);
  },
};

/**
 * A typo, its reversal, and the correct row — all three permanent.
 *
 * `a-correction-is-a-new-row`. The reversed row stays on screen, dimmed, and loses its action menu:
 * you cannot reverse a reversal. A design that hid it would be tidier and would destroy the only
 * evidence that somebody typed the wrong number.
 */
export const ManualAndReversal: Story = {
  args: { settlement: correctedByHand, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Three manual rows, each badged with WHO — the only review this design supports, because
    // nothing detects a wrong amount and nothing can remove one.
    await expect(canvas.getAllByTestId("source-badge-manual")).toHaveLength(3);
    await expect(canvas.getAllByTestId("source-badge-manual")[0]).toHaveTextContent("Budi");

    // The mistake is still there — and the row that undid it says which row that was.
    await expect(canvas.getByTestId("entry-typo")).toBeInTheDocument();
    await expect(canvas.getAllByTestId(/^ledger-reversal-/)).toHaveLength(1);

    // And the screen says why there is no delete button, rather than only enforcing it server-side.
    await expect(canvas.getByTestId("append-only-notice")).toHaveTextContent(
      /cannot be edited or deleted/i,
    );
  },
};

/** Reversing is destructive-shaped — it posts a permanent row — so it confirms first. */
export const ReverseConfirms: Story = {
  args: { settlement: worked, canPost: true },
  render: function Render(args) {
    const [reversed, setReversed] = useState<SettlementEntry | null>(null);
    return (
      <>
        <OrderLedgerPanel {...args} onReverse={setReversed} />
        {reversed && <div data-testid="reversed">{String(reversed.change)}</div>}
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // ONE action, so it is the button on the row itself — no `⋯` to open first.
    const last = worked.entries[worked.entries.length - 1]!;
    await userEvent.click(canvas.getByTestId(`ledger-reverse-${last.id}`));

    // A dialog, not an immediate post — CLAUDE.md: anything not trivially reversible confirms.
    const confirm = await waitFor(() =>
      within(document.body).getByRole("button", { name: /post reversal/i }),
    );
    await userEvent.click(confirm);

    await waitFor(async () => {
      await expect(canvas.getByTestId("reversed")).toHaveTextContent("20000");
    });
  },
};

/**
 * A reimbursement larger than what was withheld — the order came out AHEAD.
 *
 * Rare, real, and the case a red-only design gets wrong: it would render a gain as a smaller loss,
 * which is the one direction nobody double-checks.
 */
export const CameOutAhead: Story = {
  args: { settlement: ahead, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(loss(ahead)).toBe(-4_000n);
    // ONE label both ways, signed — "+Rp 4.000" rather than a second word for a gain.
    await expect(canvas.getByTestId("loss")).toHaveTextContent("Adjustment");
    await expect(canvas.getByTestId("loss")).toHaveTextContent("+Rp 4.000");
    await expect(canvas.getByTestId("loss")).toHaveTextContent("Rp 4.000");
  },
};

/**
 * `marketplace_total` was 0 — **not recorded**, not "sold for nothing" (`order.proto:224`).
 *
 * ⚠ THIS STORY IS AN OPEN QUESTION, ON SCREEN. Computed naively the order reads as pure profit,
 * because everything that arrives is a gain against a sale of zero. The panel refuses to show
 * any figure instead, which is the cheapest possible argument for giving 0 a rule.
 */
export const NoEstimate: Story = {
  args: { settlement: noEstimate, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("no-estimate-notice")).toBeInTheDocument();
    // No summary at all — a "loss" of −62.000 here would be a fiction presented as a fact.
    await expect(canvas.queryByTestId("settlement-summary")).not.toBeInTheDocument();
    // The rows themselves still show: what happened is known even when the comparison is not.
    await expect(canvas.getAllByTestId(/^entry-/)).toHaveLength(1);
  },
};

/** No posting rights: the ledger reads, and offers nothing to write with. */
export const ReadOnly: Story = {
  args: { settlement: correctedByHand, canPost: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("add-entry")).not.toBeInTheDocument();
    await expect(canvas.queryAllByTestId(/^ledger-reverse-/)).toHaveLength(0);
    // Attribution stays visible — reading who typed what is not a posting right.
    await expect(canvas.getAllByTestId("source-badge-manual").length).toBeGreaterThan(0);
  },
};

const _typecheck: OrderSettlement = worked;
void _typecheck;

/**
 * NO TOTAL BELI, NO MARGINS (owner) — the panel takes the cost from its host, and with none it shows the
 * three cards it can stand behind. A margin with no cost would be the whole payout passed off as earned.
 */
export const NoTotalBeliNoMargins: Story = {
  // The example WITHOUT it — every other story has the default 80.000.
  args: { settlement: worked, canPost: true, totalBeli: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("estimated-margin")).toBeNull();
    await expect(canvas.queryByTestId("margin")).toBeNull();
    await expect(within(canvas.getByTestId("settlement-summary")).getAllByTestId(/^(sold|received|loss)$/)).toHaveLength(3);
  },
};

/**
 * TWO MARGINS, APART BY THE ADJUSTMENT (owner). Sold 120.000, received 110.000, everything the order cost
 * 80.000: estimated 40.000 (33.33%), true 30.000 (25.00%) — and 30.000 − 40.000 is the −10.000 beside them.
 */
export const TwoMarginsDifferByTheAdjustment: Story = {
  args: { settlement: worked, canPost: true, totalBeli: 80_000n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("estimated-margin-value")).toHaveTextContent("Rp 40.000");
    await expect(canvas.getByTestId("estimated-margin")).toHaveTextContent("33.33% of the selling price");
    await expect(canvas.getByTestId("margin-value")).toHaveTextContent("Rp 30.000");
    await expect(canvas.getByTestId("margin")).toHaveTextContent("25.00% of the selling price");
    await expect(canvas.getByTestId("loss-value")).toHaveTextContent("−Rp 10.000");
  },
};

/** Each margin says how it is made, under its share — no tooltip. */
export const TheMarginsSayWhereTheyComeFrom: Story = {
  args: { settlement: worked, canPost: true, totalBeli: 80_000n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("estimated-margin-note")).toHaveTextContent("selling price − total cost");
    await expect(canvas.getByTestId("margin-note")).toHaveTextContent("received − total cost");
    await expect(canvas.getByTestId("add-entry")).toHaveTextContent("Add Entry");
  },
};

/**
 * THE BALANCE READS LIKE THE CHANGE (owner) — the sign before "Rp", on every money figure — and stands
 * out from it: bold, where the change is plain.
 */
export const TheBalanceReadsLikeTheChange: Story = {
  args: { settlement: worked, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const last = worked.entries[worked.entries.length - 1]!;
    await expect(canvas.getByTestId(`ledger-balance-${last.id}`)).toHaveTextContent("−Rp 10.000");
    await expect(canvas.getByTestId("ledger-table")).not.toHaveTextContent("Rp -");
  },
};

/** DETAIL LEADS WITH THE SOURCE (owner): the badge, then the note that used to be the whole column. */
export const TheDetailLeadsWithTheSource: Story = {
  args: { settlement: correctedByHand, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const typo = canvas.getByTestId("ledger-detail-typo");
    const badge = within(typo).getByTestId("source-badge-manual");
    await expect(typo).toHaveTextContent("voucher clawback");
    // The badge comes first.
    await expect(typo.textContent!.indexOf("Budi")).toBeLessThan(typo.textContent!.indexOf("voucher"));
    await expect(badge).toBeInTheDocument();
    await expect(canvas.getByTestId("ledger-table")).toHaveTextContent("Source");
  },
};

/** A REVERSAL SAYS WHAT IT UNDOES (owner) — the amount and the day of the row it reverses. */
export const AReversalSaysWhatItUndoes: Story = {
  args: { settlement: correctedByHand, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reversal = correctedByHand.entries.find((e) => e.reversesId)!;
    const original = correctedByHand.entries.find((e) => e.id === reversal.reversesId)!;
    await expect(canvas.getByTestId(`ledger-reversal-${reversal.id}`)).toHaveTextContent(
      `reverses −Rp 45.000 of ${original.occurredOn}`,
    );
  },
};

/**
 * RECEIVED AND THE ADJUSTMENT SAY HOW MANY ENTRIES (owner) — the rows after the sale: the worked example's
 * payout, ads fee and reimbursement. Received carries it under its share; the adjustment as its only line.
 */
export const TheCardsSayHowManyEntries: Story = {
  args: { settlement: worked, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("received-note")).toHaveTextContent("from 3 entries");
    // The same note, in the same grey, on both cards.
    await expect(canvas.getByTestId("loss-note")).toHaveTextContent("from 3 entries");
  },
};

/**
 * "RINCIAN ›" OPENS HOW THE TRUE MARGIN ADDS UP (owner) — the entries after the sale, per type, to Received;
 * less the total cost, to the true margin; and under it the estimate, the difference (the adjustment), and
 * the deduction kept before the payout.
 */
export const TheMarginOpensItsBreakdown: Story = {
  args: { settlement: worked, canPost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("margin-breakdown-open"));

    const dialog = await screen.findByTestId("margin-breakdown-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    const body = within(dialog);
    await expect(body.getByTestId("breakdown-fund")).toHaveTextContent("+Rp 100.000");
    await expect(body.getByTestId("breakdown-received")).toHaveTextContent("Rp 110.000");
    await expect(body.getByTestId("breakdown-margin")).toHaveTextContent("Rp 30.000");
    await expect(body.getByTestId("breakdown-difference")).toHaveTextContent("−Rp 10.000");
    await expect(body.getByTestId("breakdown-deducted")).toHaveTextContent("Rp 20.000");
  },
};

/**
 * THE PANEL ON A PHONE (owner). A typo, its reversal and the right row, with both margins — the richest
 * ledger the fixtures have.
 *
 * ⚠ NO `play()`, DELIBERATELY: the `viewport` global resizes the WORKBENCH canvas only — the story runner
 * has one fixed desktop viewport (see MobileLayout.stories). Review it in Storybook.
 */
export const Mobile: Story = {
  args: { settlement: correctedByHand, canPost: true },
  globals: { viewport: { value: "mobile2" } },
};

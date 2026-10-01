import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { OrderLedgerPanel } from "./components/OrderLedgerPanel";
import { ahead, awaiting, correctedByHand, lateFee, noEstimate, worked } from "./fixtures";
import { hiddenCost, loss, netReceived, trueMargin } from "./model";
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
const meta = {
  title: "Pages/Order Settlement/Ledger Panel",
  component: OrderLedgerPanel,
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
    await expect(canvas.getByTestId("ledger-table")).toHaveTextContent("Rp -10.000");

    // 120.000 − 100.000 = 20.000 kept and never explained. −10.000 + 20.000 = +10.000 named.
    await expect(hiddenCost(worked)).toBe(20_000n);
    await expect(netReceived(worked)).toBe(110_000n);
    await expect(loss(worked)).toBe(10_000n);
    // The number no service in this system could produce before settlement existed.
    await expect(trueMargin(worked)).toBe(40_000n);

    // ⚠ The word is LOST. `a-residual-balance-is-normal` means nobody is collecting this, so any
    // label implying a debt — "outstanding", "unpaid", "due" — would be wrong on every order.
    const summary = canvas.getByTestId("settlement-summary");
    await expect(summary).toHaveTextContent("Lost");
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
    await expect(canvas.getAllByTestId("manual-badge")).toHaveLength(3);
    await expect(canvas.getAllByTestId("manual-badge")[0]).toHaveTextContent("Budi");

    // The mistake is still there.
    await expect(canvas.getByTestId("entry-typo")).toBeInTheDocument();

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

    const menus = canvas.getAllByRole("button", { name: /row actions/i });
    await userEvent.click(menus[menus.length - 1]);

    const item = await waitFor(() => document.body.querySelector('[data-value="reverse"]'));
    await expect(item).not.toBeNull();
    await userEvent.click(item as Element);

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
    // The label flips too. "Lost −Rp 4.000" is a double negative nobody reads correctly.
    await expect(canvas.getByTestId("loss")).toHaveTextContent("Gained");
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
    await expect(canvas.queryByRole("button", { name: /row actions/i })).not.toBeInTheDocument();
    // Attribution stays visible — reading who typed what is not a posting right.
    await expect(canvas.getAllByTestId("manual-badge").length).toBeGreaterThan(0);
  },
};

const _typecheck: OrderSettlement = worked;
void _typecheck;

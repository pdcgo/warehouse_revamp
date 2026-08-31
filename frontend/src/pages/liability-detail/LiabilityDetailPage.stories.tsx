import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { LiabilityDetailPage } from "./index";

const WAREHOUSE = teams.find((t) => t.id === 11n)!; // the creditor
const COUNTERPARTY = 12n; //                            Toko Melati, the debtor at 87% of its limit

// The page reads `:counterpartyId` from the route and navigates back to the list, so it needs a real
// router — built once at module scope, or every re-render would reset the history.
const Routed = routedPage(
  [
    { path: "/liability/:counterpartyId", element: <LiabilityDetailPage /> },
    marker("/liability", "at-liability-list"),
  ],
  `/liability/${COUNTERPARTY}`,
);

const meta = {
  title: "Pages/Liability/PairDetail",
  component: LiabilityDetailPage,
  render: () => <Routed />,
  parameters: {
    signedIn: true,
    // The page mounts its own data router, so preview.tsx must stand its MemoryRouter down.
    dataRouter: true,
  },
  beforeEach: asTeam(WAREHOUSE.id),
} satisfies Meta<typeof LiabilityDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("liability-detail-page")).toBeInTheDocument(), {
    timeout: 3000,
  });
  return canvas;
}

// The three things `team_balance_design.md` §Detail Pair Team Balance asks this page for.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 1. "Its show general summarize" — the pair's position, split into the two directions. Never a
    //    bare signed number: direction is words and separate figures.
    await expect(canvas.getByTestId("liability-detail-balance")).toBeInTheDocument();

    // 3. "its show change balance log" — the ledger, in its four cuts.
    await expect(canvas.getByTestId("liability-detail-tab-receivable")).toBeInTheDocument();
    await expect(canvas.getByTestId("liability-detail-tab-payable")).toBeInTheDocument();

    // 2. "Its show change limit history log" — the NEW tab, and a different kind of log entirely.
    await expect(canvas.getByTestId("liability-detail-tab-limits")).toBeInTheDocument();
  },
};

// ⚠ THE TWO LOGS ARE DIFFERENT KINDS OF THING and must not merge: the entry tabs are money that
// MOVED, the limit tab is a RULE that changed. They share a page because somebody asking "why is
// this team blocked" needs both — and they have different grains, so only one of them is a ledger.
export const TheLimitLogIsSeparateFromTheLedger: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The ledger tab first: entries carry an amount and a running balance.
    await expect(canvas.getByTestId("liability-detail-receivable")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("liability-detail-tab-limits"));

    // The limit log carries old → new limits and a reason. Fixture change 2 is the one on this pair
    // that SET a ceiling where there had been none: unlimited → 10.000.000.
    await waitFor(() => expect(canvas.getByTestId("terms-history")).toBeInTheDocument(), {
      timeout: 3000,
    });
    await expect(canvas.getByTestId("terms-change-2")).toHaveTextContent(/unlimited/i);

    // And the override — a limit lifted by somebody outside the creditor team — is marked as one.
    await expect(canvas.getByTestId("terms-override-3")).toBeInTheDocument();
  },
};

// The log is filtered to THIS pair. A per-pair page showing every team's limit changes would be
// reporting somebody else's negotiation on this counterparty's record.
export const TheLimitLogIsScopedToThisPair: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("liability-detail-tab-limits"));

    await waitFor(() => expect(canvas.getByTestId("terms-history-table")).toBeInTheDocument(), {
      timeout: 3000,
    });

    // Changes 2 and 3 are this pair's. Change 4 belongs to team 13 and change 1 to team 14.
    await expect(canvas.getByTestId("terms-change-2")).toBeInTheDocument();
    await expect(canvas.queryByTestId("terms-change-4")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("terms-change-1")).not.toBeInTheDocument();
  },
};

// ── WHERE THE LIMIT IS SET (terms-live-on-the-pair-detail) ──────────────────────────────────────
//
// It was a screen of its own listing every counterparty. The owner's answer is that terms belong
// beside the pair they govern, so this is the same controls with the list taken away.
export const TheTermsTabSetsThisPairsLimit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("liability-detail-tab-terms"));

    await waitFor(() => expect(canvas.getByTestId("terms-panel")).toBeInTheDocument(), {
      timeout: 3000,
    });

    // Toko Melati has its OWN row: a 30.000 fee, not the default's 25.000.
    await expect(canvas.getByTestId("terms-panel-fee")).toHaveTextContent("30.000");

    // ⛔ AND NO MARKUP. The cross-product markup is the PRODUCT's (owner) — `cross_markup_bps` in
    // product_service — so a credit-terms panel must not present it as a property of this pair.
    await expect(canvas.queryByTestId("terms-panel-markup")).not.toBeInTheDocument();

    // Its own row, so nothing is inherited and the row can be removed.
    await expect(canvas.queryByTestId("terms-inherited")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("terms-delete")).toBeInTheDocument();
  },
};

// THE METER IS THE POINT OF PUTTING TERMS HERE. On the old screen a limit sat in a table beside every
// other team's; here it is one click from the entries that filled it, and 8.700.000 of 10.000.000 is
// past the 80% warning.
export const TheTermsTabWarnsWhenTheLimitIsNearlyUsed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("liability-detail-tab-terms"));

    await waitFor(() => expect(canvas.getByTestId("terms-panel-meter")).toBeInTheDocument(), {
      timeout: 3000,
    });
    await expect(canvas.getByTestId("terms-panel-meter")).toHaveTextContent("87");
  },
};

// ── PROOF IS REQUIRED (a-payment-must-carry-proof) ──────────────────────────────────────────────
//
// §Payment Flow has the payer BRING proof of the transfer and the creditor CHECK IT MANUALLY. A
// payment with nothing attached asks the creditor to accept on the payer's word, which is exactly
// what two-phase confirmation declines to trust — so the send is disabled rather than refused after
// the fact.
export const APaymentCannotBeSentWithoutProof: Story = {
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    // The dialog portals, so it is queried from the document rather than the canvas.
    await userEvent.click(within(canvasElement).getByTestId("liability-detail-make-payment"));

    const amount = await screen.findByTestId("record-amount");
    await userEvent.type(amount, "500000", { delay: 40 });

    // A valid amount is not enough on its own.
    await waitFor(() => expect(screen.getByTestId("record-submit")).toBeDisabled());
    await expect(screen.getByTestId("record-proof-input")).toBeInTheDocument();
  },
};

// §Payment Flow's MIDDLE STEP — *"Team B check manually"*. The creditor has to be able to LOOK at
// the proof, and until this landed there was nowhere on any screen that showed it: the payer's
// upload half shipped, the ids reached the client, and the table drew four columns without them.
export const TheCreditorCanOpenTheProof: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The "team" tab is the one holding payments THEY recorded and this team must act on.
    await userEvent.click(canvas.getByTestId("liability-detail-tab-team"));

    const proof = await canvas.findByTestId("liability-detail-proof-doc-602a");
    await expect(proof).toBeInTheDocument();

    // Two files on that claim, and both are reachable — a creditor checking a transfer often has a
    // slip and a screenshot, and showing only the first would hide half the evidence.
    await expect(canvas.getByTestId("liability-detail-proof-doc-602b")).toBeInTheDocument();
  },
};

// §Payment Flow's `no` arm, and the lifecycle diagram's second terminal state. Before it existed a
// creditor could only leave a bad claim pending forever, or CONFIRM and then REVERSE — two real
// ledger movements for money that never moved.
export const RejectingNeedsAReasonAndPostsNothing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("liability-detail-tab-team"));

    // The balance before, so the assertion below is about THIS act rather than about the fixture.
    const balanceBefore = canvas.getByTestId("liability-detail-balance").textContent;

    await userEvent.click(await canvas.findByTestId("liability-detail-reject-602"));

    // ⚠ THE REASON IS REQUIRED — the submit stays disabled until there is one. A refusal the payer
    // cannot read is a debt they cannot fix.
    const submit = await screen.findByTestId("liability-detail-reject-submit");
    await waitFor(() => expect(submit).toBeDisabled());

    const reason = screen.getByTestId("liability-detail-reject-reason");
    await userEvent.type(reason, "the slip is for last month", { delay: 20 });

    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    // ⚠ THE BALANCE DOES NOT MOVE. That is the whole point of the state, and the one thing a
    // rejection must never do.
    await waitFor(() =>
      expect(canvas.getByTestId("liability-detail-balance").textContent).toBe(balanceBefore),
    );
  },
};

// A refusal the payer cannot read is a debt they cannot fix, so the reason travels with the row —
// on the payer's own screen, not only on the creditor's.
export const ARejectedClaimShowsWhy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("liability-detail-tab-team"));

    const reason = await canvas.findByTestId("liability-detail-reason-603");
    await expect(reason).toHaveTextContent("no transfer of this amount reached our account");
  },
};


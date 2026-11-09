import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { liabilityListCalls } from "../../../.storybook/liabilityScenario";
import { liabilityPeriod } from "../../features/liability/queries";
import { LiabilityLogDirection, LiabilityPaymentSide } from "../../gen/warehouse/liability/v1/liability_pb";
import { teams } from "../../../.storybook/fixtures";
import { account } from "../../../.storybook/financialAccountFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
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
  // The warehouse's Owner: setting terms is theirs (the-warehouse-admin-equals-the-owner-except-money).
  beforeEach: () => {
    asTeam(WAREHOUSE.id)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
} satisfies Meta<typeof LiabilityDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// the-warehouse-admin-equals-the-owner-except-money: the warehouse Admin reads the terms and the meter, and is offered
// neither Set nor Remove.
export const TheWarehouseAdminSetsNoTerms: Story = {
  beforeEach: asRole(Role.WAREHOUSE_ADMIN),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("liability-detail-page")).toBeInTheDocument(), { timeout: 3000 });
    await userEvent.click(canvas.getByTestId("liability-detail-tab-terms"));

    await waitFor(() => expect(canvas.getByTestId("terms-panel-meter")).toBeInTheDocument(), { timeout: 3000 });
    await expect(canvas.queryByTestId("terms-edit")).toBeNull();
    await expect(canvas.queryByTestId("terms-delete")).toBeNull();
  },
};

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("liability-detail-page")).toBeInTheDocument(), {
    timeout: 3000,
  });
  return canvas;
}

// THE DATE RANGE LIVES IN THE URL (a-lists-filters-live-in-the-url) — opened at `?range=7d` the picker reads it; a new
// window is written back.
const AtFilteredUrl = routedPage(
  [
    { path: "/liability/:counterpartyId", element: <><LiabilityDetailPage /><LocationProbe /></> },
    marker("/liability", "at-liability-list"),
  ],
  `/liability/${COUNTERPARTY}?range=7d`,
);

export const FiltersLiveInTheUrl: Story = {
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");
    const range = canvas.getByTestId("liability-detail-range");

    await expect(range).toHaveTextContent("Last 7 days");

    // ⛔ THE RANGE IS THE SERVER'S (backlog #34). It used to narrow the 50 rows loaded, so a range reaching past page 1
    // showed only what page 1 held. The ledger read carries the window as Jakarta days, and the rows are what came
    // back: yesterday's fee is in it, the payment of 12 days ago is not.
    const week = liabilityPeriod({ kind: "relative", days: 7 });
    await waitFor(() => expect(liabilityListCalls.logs.at(-1)).toMatchObject({ from: week.from, to: week.to }));
    await expect(await canvas.findByTestId("liability-detail-entry-501")).toBeInTheDocument();
    await expect(canvas.queryByTestId("liability-detail-entry-511")).toBeNull();
    // The header's balance is still the WHOLE pair's.
    await expect(canvas.getByTestId("liability-detail-balance")).toHaveTextContent("8.700.000");

    await userEvent.click(range);
    const month = await screen.findByTestId("liability-detail-range-quick-1m");
    await waitFor(() => expect(month).toBeVisible());
    await userEvent.click(month);
    await waitFor(() => expect(location).toHaveTextContent("range=1m"));

    // A new window is a new read, and the payment's row is back.
    const lastMonth = liabilityPeriod({ kind: "relative", months: 1 });
    await waitFor(() => expect(liabilityListCalls.logs.at(-1)).toMatchObject({ from: lastMonth.from, to: lastMonth.to }));
    await expect(await canvas.findByTestId("liability-detail-entry-511")).toBeInTheDocument();

    // The limit log reads the same window (ChangeLogPanel sends it).
    await userEvent.click(canvas.getByTestId("liability-detail-tab-limits"));
    await waitFor(() =>
      expect(liabilityListCalls.termsHistory.at(-1)).toMatchObject({ from: lastMonth.from, to: lastMonth.to }),
    );
  },
};

// ⛔ EACH TAB IS ITS OWN SERVER PAGE (backlog #34). The cuts were one read each, narrowed here — so Their payments drew
// empty under a page of My payments, and a cut's pager counted the whole ledger. Each tab sends its direction or side,
// and draws what came back; *Balance after* stays the true running balance of the whole ledger on a cut.
export const EachTabReadsItsOwnServerPage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId("liability-detail-entry-501");
    await expect(liabilityListCalls.logs.at(-1)?.direction).toBe(LiabilityLogDirection.UNSPECIFIED);

    await userEvent.click(canvas.getByTestId("liability-detail-tab-payable"));
    await waitFor(() => expect(liabilityListCalls.logs.at(-1)?.direction).toBe(LiabilityLogDirection.PAYABLE));
    const payable = canvas.getByTestId("liability-detail-payable");
    await waitFor(() =>
      expect(within(payable).getAllByTestId(/^liability-detail-entry-/).map((r) => r.dataset.testid)).toEqual(
        [503, 508, 509].map((id) => `liability-detail-entry-${id}`),
      ),
    );
    // The broken-goods payable left 7.470.000 — the whole ledger's balance after it, not a sum of the cut.
    await expect(within(payable).getByTestId("liability-detail-balance-after-503")).toHaveTextContent("Rp 7.470.000");

    await userEvent.click(canvas.getByTestId("liability-detail-tab-team"));
    await waitFor(() => expect(liabilityListCalls.payments.at(-1)?.side).toBe(LiabilityPaymentSide.RECEIVED));
    const team = canvas.getByTestId("liability-detail-team");
    await waitFor(() => expect(within(team).getByTestId("liability-detail-payment-602")).toBeInTheDocument());
    await expect(within(team).queryByTestId("liability-detail-payment-601")).toBeNull();

    await userEvent.click(canvas.getByTestId("liability-detail-tab-mine"));
    await waitFor(() => expect(liabilityListCalls.payments.at(-1)?.side).toBe(LiabilityPaymentSide.PAID));
    const mine = canvas.getByTestId("liability-detail-mine");
    await waitFor(() => expect(within(mine).getByTestId("liability-detail-payment-601")).toBeInTheDocument());
    await expect(within(mine).queryByTestId("liability-detail-payment-602")).toBeNull();
  },
};

// The three things `team_balance_design.md` §Detail Pair Team Balance asks this page for.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 1. "Its show general summarize" — the pair's position, split into the two directions. Never a
    //    bare signed number: direction is words and separate figures.
    await expect(canvas.getByTestId("liability-detail-balance")).toBeInTheDocument();

    // 3. "its show change balance log" — the ledger. ALL is the FIRST tab and the one it opens on
    //    (the-team-balance-screens-are-accepted), with its rows: the stub once served the wrong slice and every ledger
    //    drew empty, which only a ROW proves against.
    const all = await canvas.findByTestId("liability-detail-tab-all");
    await expect(all.parentElement!.querySelector('[role="tab"]')).toBe(all);
    await expect(all).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByTestId("liability-detail-tab-receivable")).toBeInTheDocument();
    await expect(canvas.getByTestId("liability-detail-tab-payable")).toBeInTheDocument();
    await expect(await canvas.findByTestId("liability-detail-entry-501")).toHaveTextContent("Order fee · order #9001");

    // The figures are the order list's cards (a-list-summary-is-the-order-lists-card-strip): the position leads, in
    // words under its figure, and the pages grow as they are opened (every-list-pages-with-the-growing-pager).
    await expect(canvas.getByTestId("liability-detail-position")).toHaveAttribute("data-emphasis", "true");
    await expect(canvas.getByTestId("liability-detail-direction")).toHaveTextContent("They owe you");
    await expect(within(canvas.getByTestId("liability-detail-all")).getByTestId("liability-detail-all-pager")).toBeInTheDocument();

    // 2. "Its show change limit history log" — the NEW tab, and a different kind of log entirely.
    await expect(canvas.getByTestId("liability-detail-tab-limits")).toBeInTheDocument();
  },
};

// ── THE ALL TAB (the-team-balance-screens-are-accepted) ─────────────────────────────────────────────────────────────
//
// The Receivable and Payable cuts split by the SIGN of a movement, so a payment and a reversal land in the other cut
// and *Balance after* skips rows. All is the whole running ledger, in its order, first and the default — every row of
// the pair, whichever way it went, with the balance it left.
export const TheAllTabRunsTheWholeLedger: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const all = await canvas.findByTestId("liability-detail-all");

    // Eleven movements, newest first — the fees, the broken-goods payable, the found reversal and the payment.
    await waitFor(() => expect(within(all).getAllByTestId(/^liability-detail-entry-/)).toHaveLength(11));
    await expect(within(all).getAllByTestId(/^liability-detail-entry-/).map((r) => r.dataset.testid)).toEqual(
      [501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511].map((id) => `liability-detail-entry-${id}`),
    );

    // The payable row and the payment, each with its balance after — both missing from the Receivable cut's run.
    await expect(within(all).getByTestId("liability-detail-entry-503")).toHaveTextContent("−Rp 450.000");
    await expect(within(all).getByTestId("liability-detail-balance-after-503")).toHaveTextContent("Rp 7.470.000");
    await expect(within(all).getByTestId("liability-detail-entry-511")).toHaveTextContent("Payment #601");
    await expect(within(all).getByTestId("liability-detail-balance-after-511")).toHaveTextContent("Rp 7.865.000");

    // The cuts are unchanged: Receivable leaves the payable movement out.
    await userEvent.click(canvas.getByTestId("liability-detail-tab-receivable"));
    const receivable = canvas.getByTestId("liability-detail-receivable");
    await waitFor(() => expect(within(receivable).getByTestId("liability-detail-entry-501")).toBeVisible());
    await expect(within(receivable).queryByTestId("liability-detail-entry-503")).toBeNull();
  },
};

// ── MAKE PAYMENT IS THE DEBTOR'S (the-debtor-claims-the-creditor-decides) ──────────────────────────────────────────

// ⛔ THE CREDITOR IS NOT OFFERED IT. Toko Melati owes Gudang Pusat 8.700.000, so Gudang Pusat may ask to be paid and
// accept or reject what Melati sends — never record a payment of its own; the server refuses one as FailedPrecondition.
export const TheCreditorIsNotOfferedMakePayment: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("liability-detail-balance")).toHaveTextContent("8.700.000"));
    await expect(await canvas.findByTestId("liability-detail-request-payment")).toBeInTheDocument();
    await expect(canvas.queryByTestId("liability-detail-make-payment")).toBeNull();
  },
};

// A PAIR THAT OWES NOTHING OFFERS NO PAYMENT: Toko Kenanga's page for Toko Melati — nothing ever moved between them, so
// it is square, and neither Make Payment nor Request Payment is offered.
const KenangaAtMelati = routedPage(
  [
    { path: "/liability/:counterpartyId", element: <LiabilityDetailPage /> },
    marker("/liability", "at-liability-list"),
  ],
  `/liability/${COUNTERPARTY}`,
);

export const ASquarePairOffersNoPayment: Story = {
  render: () => <KenangaAtMelati />,
  beforeEach: () => {
    asTeam(13n)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("liability-detail-direction")).toHaveTextContent("Square"));
    await expect(await canvas.findByTestId("liability-ledger-empty")).toBeInTheDocument();
    await expect(canvas.queryByTestId("liability-detail-make-payment")).toBeNull();
    await expect(canvas.queryByTestId("liability-detail-request-payment")).toBeNull();
  },
};

// ⚠ THE TWO LOGS ARE DIFFERENT KINDS OF THING and must not merge: the entry tabs are money that
// MOVED, the limit tab is a RULE that changed. They share a page because somebody asking "why is
// this team blocked" needs both — and they have different grains, so only one of them is a ledger.
export const TheLimitLogIsSeparateFromTheLedger: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The ledger tab first — All, the default: entries carry an amount and a running balance.
    await expect(canvas.getByTestId("liability-detail-all")).toBeInTheDocument();

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

    // ⛔ AND NO FLAT FEE. The warehouse's fee is warehouse_service's, frozen on each order — Credit Terms is the
    // limit alone since step 5 of the-flat-rate-is-dropped-last.
    await expect(canvas.queryByTestId("terms-panel-fee")).not.toBeInTheDocument();

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
//
// Toko Melati — the DEBTOR — pays Gudang Pusat: Make Payment is the team that owes's (the-debtor-claims-the-creditor-decides).
const MelatiAtGudangPusat = routedPage(
  [
    { path: "/liability/:counterpartyId", element: <LiabilityDetailPage /> },
    marker("/liability", "at-liability-list"),
  ],
  `/liability/${WAREHOUSE.id}`,
);
const asTheDebtor = () => {
  asTeam(COUNTERPARTY)();
  asRole(Role.SELLING_OWNER)();
};

export const APaymentCannotBeSentWithoutProof: Story = {
  render: () => <MelatiAtGudangPusat />,
  beforeEach: asTheDebtor,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    // The dialog portals, so it is queried from the document rather than the canvas.
    await userEvent.click(await within(canvasElement).findByTestId("liability-detail-make-payment"));

    const amount = await screen.findByTestId("record-amount");
    await userEvent.type(amount, "500000", { delay: 40 });

    // A valid amount is not enough on its own.
    await waitFor(() => expect(screen.getByTestId("record-submit")).toBeDisabled());

    // ⚠ THE PROOF FIELD IS CHAKRA'S FILE UPLOAD (chakra-first-whenever-it-has-the-component) — a trigger button with its
    // icon, the browser's input hidden behind it, never the native "Choose file · No file chosen" box.
    const pick = screen.getByTestId("record-proof-pick");
    await expect(pick.tagName).toBe("BUTTON");
    await expect(pick).toHaveTextContent("Attach Proof");
    await expect(screen.getByTestId("record-proof-input").closest('[data-scope="file-upload"]')).not.toBeNull();
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

// ── WHICH ACCOUNT (a-team-payment-posts-on-accept) ──────────────────────────────────────────────
//
// A team payment reaches the financial accounts when it is ACCEPTED, as two movements: out of the
// payer's account, into the creditor's. Each side names its own — the payer when recording, the
// creditor when accepting — because each is the only one who knows which bank the money touched.
//
// Both are SENT, and both are required — the stub refuses a request without its account, as the
// contract does, so a story that reaches "sent" proves the pick travelled. Team 11 has two accounts, Kas Gudang and BCA Gudang, so neither picker fills itself in.
const KAS_GUDANG = account("Kas Gudang");
const BCA_GUDANG = account("BCA Gudang");

// The payer's half — Toko Melati, the debtor. Amount and proof are not enough any more: the send waits for the account
// the transfer left, and once it is sent the claim is pending — the balance does not move. Melati has several
// accounts, so the picker does not fill itself in.
const BCA_OPERASIONAL = account("BCA Operasional");

export const APaymentNamesTheAccountItWasPaidFrom: Story = {
  render: () => <MelatiAtGudangPusat />,
  beforeEach: asTheDebtor,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(await canvas.findByTestId("liability-detail-make-payment"));
    const balanceBefore = canvas.getByTestId("liability-detail-balance").textContent;

    // The dialog portals, so it is queried from the document rather than the canvas.
    await userEvent.type(await screen.findByTestId("record-amount"), "500000", { delay: 40 });
    await userEvent.upload(
      screen.getByTestId("record-proof-input") as HTMLInputElement,
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "transfer.png", { type: "image/png" }),
    );
    await waitFor(() => expect(screen.getByTestId("record-proof-list")).toHaveTextContent("transfer.png"));
    // A second slip goes under the first — the trigger now says so.
    await expect(screen.getByTestId("record-proof-pick")).toHaveTextContent("Attach Another");

    // ⚠ Amount and proof, and still not ready — the account the transfer left is required too.
    const submit = screen.getByTestId("record-submit");
    await waitFor(() => expect(submit).toBeDisabled());

    const trigger = screen.getByTestId("record-from-account");
    await waitFor(() => expect(trigger).not.toBeDisabled());
    await userEvent.click(trigger);
    const option = await screen.findByTestId(`record-from-account-option-${BCA_OPERASIONAL.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    // Sent — with its account, or the stub would have refused it and the dialog would still be open —
    // and pending: it appears under My payments, and nothing has posted.
    //
    // ⚠ THIS LINE IS THE REGRESSION TEST for the form's `noValidate`. Before it, the cleared (but
    // required) proof input made the browser swallow the submit, the dialog stayed open, and no
    // story had ever pressed Send to notice.
    await waitFor(() => expect(screen.queryByTestId("record-submit")).not.toBeInTheDocument());
    await userEvent.click(canvas.getByTestId("liability-detail-tab-mine"));
    await expect(await canvas.findByTestId("liability-detail-payment-700")).toHaveTextContent("Pending");
    await expect(canvas.getByTestId("liability-detail-balance").textContent).toBe(balanceBefore);
  },
};

// The creditor's half. Accepting is FINAL (an-accepted-payment-is-final), so it waits for the account
// the money landed in — and once accepted, the balance goes down by the payment.
export const AcceptingNamesTheAccountItLandedIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Toko Melati owes 8.700.000 and claims a 2.000.000 transfer (payment 602).
    await expect(canvas.getByTestId("liability-detail-balance")).toHaveTextContent("8.700.000");

    await userEvent.click(canvas.getByTestId("liability-detail-tab-team"));
    await userEvent.click(await canvas.findByTestId("liability-detail-confirm-602"));

    const submit = await screen.findByTestId("liability-detail-confirm-submit");
    await waitFor(() => expect(submit).toBeDisabled());

    const trigger = screen.getByTestId("liability-detail-confirm-account");
    await waitFor(() => expect(trigger).not.toBeDisabled());
    await userEvent.click(trigger);

    // Both of the warehouse's accounts are offered — any active one, not only the operational Kas.
    const option = await screen.findByTestId(`liability-detail-confirm-account-option-${BCA_GUDANG.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await expect(screen.getByTestId(`liability-detail-confirm-account-option-${KAS_GUDANG.id}`)).toBeVisible();
    await userEvent.click(option);

    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(canvas.getByTestId("liability-detail-balance")).toHaveTextContent("6.700.000"));
    await expect(canvas.getByTestId("liability-detail-payment-602")).toHaveTextContent("Accepted");
    await expect(canvas.queryByTestId("liability-detail-confirm-602")).not.toBeInTheDocument();
  },
};


// ── THE DEBTOR'S SIDE OF THE SAME PAIR (the-debtor-sees-the-limits-set-on-it) ───────────────────────────────────────

// The same pair read from the other end: Toko Melati on its page for Gudang Pusat.
const RoutedAsDebtor = routedPage(
  [
    { path: "/liability/:counterpartyId", element: <LiabilityDetailPage /> },
    marker("/liability", "at-liability-list"),
  ],
  `/liability/${WAREHOUSE.id}`,
);

// A LIMIT THAT CAN STOP YOUR ORDERS IS NOT KEPT FROM YOU. Melati sees the limit Gudang Pusat set on it, its debt, and
// the same 80% badge the creditor sees — worded from Melati's side, naming who set it. There is nothing to edit:
// setting it stays Gudang Pusat's.
export const TheDebtorSeesTheLimitSetOnIt: Story = {
  render: () => <RoutedAsDebtor />,
  beforeEach: () => {
    asTeam(COUNTERPARTY)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const block = await canvas.findByTestId("limit-on-you", {}, { timeout: 4000 });
    await expect(within(block).getByTestId("limit-on-you-meter-pct")).toHaveTextContent("87%");
    await expect(within(block).getByTestId("limit-on-you-meter-warn")).toHaveTextContent(
      "87% of the limit Gudang Pusat set",
    );
    await expect(block).toHaveTextContent("Set by Gudang Pusat");
  },
};

// ─── the payment request (a-creditor-may-request-payment) ───────────────────────────────────────

// Toko Kenanga (13) owes Gudang Pusat Rp 1.000.000 and has not been asked.
const AtKenanga = routedPage(
  [
    { path: "/liability/:counterpartyId", element: <LiabilityDetailPage /> },
    marker("/liability", "at-liability-list"),
  ],
  "/liability/13",
);

// THE CREDITOR ASKS. Request Payment is confirmed — it is sent to another team — and then the pair says what was asked:
// the amount owed at that moment. Nothing is posted, so the position does not move.
export const TheCreditorAsksADebtorToPay: Story = {
  render: () => <AtKenanga />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("liability-detail-payment-requested")).toBeNull();

    await userEvent.click(await canvas.findByTestId("liability-detail-request-payment"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const said = await canvas.findByTestId("liability-detail-payment-requested", {}, { timeout: 3000 });
    await expect(said).toHaveTextContent("Rp 1.000.000");
    await expect(canvas.getByTestId("liability-detail-balance")).toHaveTextContent("1.000.000");
  },
};

// THE DEBTOR SEES IT on the pair detail — who asks, how much, and that it pays through Make Payment. It is owed nothing,
// so it is offered no Request Payment of its own.
const AtGudangPusat = routedPage(
  [
    { path: "/liability/:counterpartyId", element: <LiabilityDetailPage /> },
    marker("/liability", "at-liability-list"),
  ],
  "/liability/11",
);

export const TheDebtorSeesTheRequest: Story = {
  render: () => <AtGudangPusat />,
  beforeEach: () => {
    asTeam(COUNTERPARTY)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const notice = await canvas.findByTestId("liability-detail-payment-request", {}, { timeout: 3000 });
    await expect(notice).toHaveTextContent("Gudang Pusat asks you to pay Rp 8.700.000");
    await expect(canvas.getByTestId("liability-detail-make-payment")).toBeInTheDocument();
    await expect(canvas.queryByTestId("liability-detail-request-payment")).toBeNull();
  },
};

// The request posts nothing, so the warehouse ADMIN may send it too — unlike the terms, which are the Owner's
// (the-warehouse-admin-equals-the-owner-except-money).
export const TheWarehouseAdminMayAskToPay: Story = {
  beforeEach: asRole(Role.WAREHOUSE_ADMIN),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("liability-detail-request-payment")).toBeInTheDocument();
    // Melati was already asked — the creditor reads what it asked.
    await expect(await canvas.findByTestId("liability-detail-payment-requested")).toHaveTextContent("Rp 8.700.000");
  },
};

// ── MOBILE (every-page-has-a-mobile-story) — the phone's own arrangement (the-team-balance-phone-layout-is-accepted) ──
//
// Its own phone shell (the-phone-header-is-one-row, a-phone-reads-each-line-as-a-block, a-phone-filters-from-a-sheet):
// the header one row, the cards with the position across the row, every ledger entry, payment and limit change a block,
// the date range in the Filter sheet, and the seven tabs scrolling in one row with the picked one kept in view.
// Gudang Pusat is the creditor here, so its icon is Request Payment alone — never Make Payment
// (the-debtor-claims-the-creditor-decides).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("liability-detail-page")).toHaveAttribute("data-layout", "phone");
    await waitFor(() => expect(canvas.getByTestId("liability-detail-balance")).toHaveTextContent("8.700.000"));

    // One header row: back, the name, the creditor's one icon.
    const header = canvas.getByTestId("liability-detail-header");
    const request = await canvas.findByTestId("liability-detail-request-payment");
    await expect(canvas.queryByTestId("liability-detail-make-payment")).toBeNull();
    await expect(request.getBoundingClientRect().top).toBeLessThan(canvas.getByTestId("liability-detail-back").getBoundingClientRect().bottom);
    await expect(header).toHaveTextContent("Toko Melati");

    // The lead card takes the whole row.
    const position = canvas.getByTestId("liability-detail-position").getBoundingClientRect();
    const receivable = canvas.getByTestId("liability-detail-receivable-card").getBoundingClientRect();
    await expect(position.width).toBeGreaterThan(receivable.width * 1.5);

    // All first, as blocks, each with its balance after.
    const ledger = await within(canvas.getByTestId("liability-detail-all")).findByTestId("liability-ledger-table");
    await expect(ledger).toHaveAttribute("data-layout", "blocks");
    await expect(canvas.getByTestId("liability-detail-balance-after-501")).toHaveTextContent("Balance after Rp 8.700.000");

    // The tabs scroll in ONE row rather than overlap: every trigger on the first one's line, the row wider than the screen.
    const list = canvas.getByTestId("liability-detail-tab-all").parentElement!;
    await expect(list).toHaveAttribute("data-scroll", "x");
    await expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    const top = canvas.getByTestId("liability-detail-tab-all").getBoundingClientRect().top;
    await expect(Math.abs(canvas.getByTestId("liability-detail-tab-terms").getBoundingClientRect().top - top)).toBeLessThan(2);
  },
};

// The date range opens from the counted Filter button, in a bottom sheet (a-phone-filters-from-a-sheet).
export const MobileFiltersFromASheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("liability-detail-range")).toBeNull();
    await userEvent.click(await canvas.findByTestId("liability-detail-filters-open"));
    const sheet = await screen.findByTestId("liability-detail-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("liability-detail-range")).toBeVisible();

    await userEvent.click(within(sheet).getByTestId("liability-detail-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("liability-detail-filters-sheet")).toBeNull());
  },
};

// Team payments as blocks — the amount and its state, the day and the note, the proof and the creditor's two acts.
export const MobilePaymentsAreBlocks: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId("liability-detail-tab-team"));
    const block = await canvas.findByTestId("liability-detail-payment-602");
    await waitFor(() => expect(block).toBeVisible());
    await expect(block.tagName).not.toBe("TR");
    await expect(block).toHaveTextContent("Rp 2.000.000");
    await expect(block).toHaveTextContent("Pending");
    await expect(within(block).getByTestId("liability-detail-confirm-602")).toBeVisible();
    await expect(within(block).getByTestId("liability-detail-proof-doc-602a")).toBeInTheDocument();

    // The picked tab is scrolled into view.
    const team = canvas.getByTestId("liability-detail-tab-team");
    await waitFor(() =>
      expect(team.getBoundingClientRect().right).toBeLessThanOrEqual(team.parentElement!.getBoundingClientRect().right + 1),
    );
  },
};

// The debtor's phone: Make Payment is its icon, beside nothing else — it was asked, so it pays.
export const MobileTheDebtorPays: Story = {
  globals: { viewport: { value: "mobile2" } },
  render: () => <MelatiAtGudangPusat />,
  beforeEach: asTheDebtor,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("liability-detail-make-payment")).toBeVisible();
    await expect(canvas.queryByTestId("liability-detail-request-payment")).toBeNull();
    await expect(await canvas.findByTestId("liability-detail-payment-request")).toHaveTextContent("Gudang Pusat asks you to pay");
    await expect(canvas.getByTestId("liability-detail-direction")).toHaveTextContent("You owe them");
  },
};

// The limit changes as blocks too — the move, the override mark, when and who, the reason.
export const MobileLimitChangesAreBlocks: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(await canvas.findByTestId("liability-detail-tab-limits"));
    const table = await canvas.findByTestId("terms-history-table", {}, { timeout: 3000 });
    await expect(table).toHaveAttribute("data-layout", "blocks");
    await expect(canvas.getByTestId("terms-change-3")).toHaveTextContent("Cap lifted for the ramadan push");
    await expect(canvas.getByTestId("terms-override-3")).toBeInTheDocument();
  },
};

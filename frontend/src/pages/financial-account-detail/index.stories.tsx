import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { account, expectedBalance } from "../../../.storybook/financialAccountFixtures";
import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { FinancialAccountChangeType as T } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiahNumber } from "../../lib/money";
import { FinancialAccountDetailPage } from "./index";

// One account's page — docs/business/financial_account/context_decision.md. Accepted at design_accept
// (the-prototype-and-its-contract-are-accepted); the stub plays the rules the server enforces.
//
// One account: its balance, the shops that withdraw into it, and its statement. BCA Operasional's book
// (.storybook/financialAccountFixtures.ts) ends at 11.443.500 with yesterday's reconcile — a 6.500 bank fee.

const BCA_OPS = account("BCA Operasional");
const BCA_GAJI = account("BCA Gaji");
const SHOPEEPAY = account("ShopeePay Melati");
const UNKNOWN = account("Unknown — shop #25");
const KAS = account("Kas Gudang");

const rp = (n: number) => formatRupiahNumber(n).replace(/\s/g, " ");

function routedAt(accountId: bigint) {
  return routedPage(
    [{ path: "/financial-accounts/:accountId", element: <FinancialAccountDetailPage /> }],
    `/financial-accounts/${accountId}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render
// (pageStory.tsx).
const AtShopeePay = routedAt(SHOPEEPAY.id);
const AtUnknown = routedAt(UNKNOWN.id);
const AtKasGudang = routedAt(KAS.id);
const AtBcaGaji = routedAt(BCA_GAJI.id);

const meta = {
  title: "Pages/FinancialAccount/Account",
  component: routedAt(BCA_OPS.id),
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: asTeam(12n),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement, balance: number) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(balance)), { timeout: 4000 });
  await canvas.findByTestId("account-log-table");

  return canvas;
}

const firstRow = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("account-log-table")).getAllByRole("row")[1]!;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const BelowZero: Story = { render: () => <AtShopeePay /> };

export const Unknown: Story = { render: () => <AtUnknown /> };

export const AWarehouseCashBox: Story = {
  beforeEach: asTeam(11n),
  render: () => <AtKasGudang />,
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-log-says-balance-after: newest first, and the top row's balance after IS the balance.
export const TheStatementExplainsTheBalance: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    const top = firstRow(canvas);
    await expect(top).toHaveTextContent("Adjustment");
    await expect(top).toHaveTextContent(`−${rp(6_500)}`);
    await expect(top).toHaveTextContent(rp(11_443_500));
    await expect(canvas.getByTestId("account-detail-checked")).toHaveTextContent("yesterday");
  },
};

// one-way-in-per-type: each row says which way it came in — a listener's row is not corrected here.
export const EachRowSaysWhichWayItCameIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.getByTestId("account-log-way-1425")).toHaveTextContent("automatic");
    // A listener writes the shop by id; the statement shows its name.
    await expect(canvas.getByTestId("account-log-row-1425")).toHaveTextContent("Withdrawal from Melati Official");
    await expect(canvas.getByTestId("account-log-way-1427")).toHaveTextContent("by hand · Ani Rahayu");
  },
};

// The statement filters by type — Withdrawal leaves the three withdrawals.
export const FilterTheStatementByType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await userEvent.click(canvas.getByTestId("account-log-type-filter"));
    const withdrawal = await canvas.findByTestId(`account-log-type-option-${T.WITHDRAWAL}`);
    await waitFor(() => expect(withdrawal).toBeVisible());
    await userEvent.click(withdrawal);

    await waitFor(() => expect(within(canvas.getByTestId("account-log-table")).getAllByRole("row")).toHaveLength(1 + 3));
  },
};

// The shops whose withdrawals land here.
export const TheShopsThatWithdrawHere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.getByTestId("account-shops-21")).toHaveTextContent("Melati Official");
    await expect(canvas.getByTestId("account-shops-22")).toHaveTextContent("Melati Store");
  },
};

// adjustment-is-for-reconciling-only: the bank's figure in, the difference worked out on screen, a note
// required before it posts — then the top row is the adjustment and the account is checked now.
export const AReconcilePostsTheDifference: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    // Named the way a person says it, "reconciliation" kept as the dialog's description
    // (reconcile-reads-cocokkan-saldo). The note is a textarea (an-account-note-is-a-textarea).
    await expect(canvas.getByTestId(`account-reconcile-button-${BCA_OPS.id}`)).toHaveTextContent("Match Balance");
    await userEvent.click(canvas.getByTestId(`account-reconcile-button-${BCA_OPS.id}`));
    const actual = await screen.findByTestId("reconcile-actual");
    await waitFor(() => expect(actual).toBeVisible());
    await expect(screen.getByTestId("reconcile-description")).toHaveTextContent(/^Reconciliation:/);
    await expect(screen.getByTestId("reconcile-note").tagName).toBe("TEXTAREA");
    await userEvent.type(actual, "11400000", { delay: 20 });

    await expect(screen.getByTestId("reconcile-difference")).toHaveTextContent(`−${rp(43_500)}`);
    await expect(screen.getByTestId("reconcile-save")).toBeDisabled();

    await userEvent.type(screen.getByTestId("reconcile-note"), "card fee", { delay: 20 });
    await userEvent.click(screen.getByTestId("reconcile-save"));

    await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(11_400_000)));
    const top = firstRow(canvas);
    await expect(top).toHaveTextContent("Adjustment");
    await expect(top).toHaveTextContent("card fee");
    await waitFor(() => expect(canvas.getByTestId("account-detail-checked")).not.toHaveTextContent("yesterday"));
  },
};

// A reconcile that agrees posts NOTHING — and still marks the account checked.
export const AReconcileThatAgreesPostsNothing: Story = {
  render: () => <AtBcaGaji />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1302"]!);
    await expect(canvas.getByTestId("account-detail-checked")).toHaveTextContent("Never checked");

    await userEvent.click(canvas.getByTestId(`account-reconcile-button-${BCA_GAJI.id}`));
    const actual = await screen.findByTestId("reconcile-actual");
    await waitFor(() => expect(actual).toBeVisible());
    await userEvent.type(actual, "600000", { delay: 20 });
    await expect(screen.getByTestId("reconcile-difference")).toHaveTextContent("agree");
    await userEvent.click(screen.getByTestId("reconcile-save"));

    await waitFor(() => expect(canvas.getByTestId("account-detail-checked")).not.toHaveTextContent("Never checked"));
    await expect(firstRow(canvas)).toHaveTextContent("Payroll");
  },
};

// capital-joins-the-types: a direction and a positive amount — the person never types a sign.
export const CapitalOutMovesTheBalance: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await userEvent.click(canvas.getByTestId(`account-actions-${BCA_OPS.id}`));
    const capital = await screen.findByTestId(`account-capital-${BCA_OPS.id}`);
    await waitFor(() => expect(capital).toBeVisible());
    await userEvent.click(capital);

    const out = await screen.findByTestId("capital-out");
    await waitFor(() => expect(out).toBeVisible());
    await userEvent.click(out);
    await userEvent.type(screen.getByTestId("capital-amount"), "443500", { delay: 20 });
    await userEvent.click(screen.getByTestId("capital-save"));

    await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(11_000_000)));
    await expect(firstRow(canvas)).toHaveTextContent("Capital out");
  },
};

// below-zero-is-warned-never-refused — the account's own page says it too.
export const BelowZeroIsExplained: Story = {
  render: () => <AtShopeePay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1303"]!);

    await expect(canvas.getByTestId("account-detail-balance-below-zero")).toBeVisible();
    await expect(canvas.getByTestId("account-detail-below-zero")).toBeVisible();
  },
};

/** Set account — in the menu, not a button (the-unknown-row-warns-and-sets-from-the-menu). */
async function openSetAccount(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId(`account-actions-${UNKNOWN.id}`));
  const item = await screen.findByTestId(`account-identify-${UNKNOWN.id}`);
  await waitFor(() => expect(item).toBeVisible());
  await expect(item).toHaveTextContent("Set Account");
  await userEvent.click(item);
}

// a-shop-with-no-account-gets-an-unknown-one: the page says how it came to be, offers Set account in its menu
// (the-unknown-row-warns-and-sets-from-the-menu) — and no reconcile, since there is no statement to read.
export const AnUnknownAccountExplainsItself: Story = {
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1304"]!);

    await expect(canvas.getByTestId("account-unknown-explained")).toHaveTextContent("Melati TikTok");
    // Shown by its shop's name, no "Unknown —" (the-unknown-account-reads-lainnya).
    await expect(canvas.getByTestId("account-name-heading")).toHaveTextContent(/^Melati TikTok$/);
    await openSetAccount(canvas);
    await expect(canvas.queryByTestId(`account-reconcile-button-${UNKNOWN.id}`)).toBeNull();
    await expect(canvas.getByTestId("account-detail-checked")).toHaveTextContent("No statement to check");
  },
};

// an-unknown-account-is-filled-in-or-moved-in — FILL IN: the account becomes the real one, rows kept.
export const FillInTheUnknownAccount: Story = {
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1304"]!);

    await openSetAccount(canvas);
    const provider = await screen.findByTestId("identify-provider");
    await waitFor(() => expect(provider).toBeVisible());
    await userEvent.click(provider);
    const bca = await screen.findByTestId("identify-provider-option-2");
    await waitFor(() => expect(bca).toBeVisible());
    await userEvent.click(bca);
    await userEvent.type(screen.getByTestId("identify-number"), "7778889990", { delay: 20 });
    await userEvent.type(screen.getByTestId("identify-name"), "BCA TikTok", { delay: 20 });
    await userEvent.click(screen.getByTestId("identify-save"));

    await waitFor(() => expect(canvas.getByTestId("account-name-heading")).toHaveTextContent("BCA TikTok"));
    await expect(canvas.queryByTestId("account-unknown-explained")).toBeNull();
    // The two withdrawals are still its rows, each on its own day.
    await expect(within(canvas.getByTestId("account-log-table")).getAllByRole("row")).toHaveLength(1 + 2);
  },
};

// FILL IN a number that is already recorded is refused — and the refusal points at MOVE IN.
export const FillingInARecordedNumberIsRefused: Story = {
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1304"]!);

    await openSetAccount(canvas);
    const provider = await screen.findByTestId("identify-provider");
    await waitFor(() => expect(provider).toBeVisible());
    await userEvent.click(provider);
    const bca = await screen.findByTestId("identify-provider-option-2");
    await waitFor(() => expect(bca).toBeVisible());
    await userEvent.click(bca);
    await userEvent.type(screen.getByTestId("identify-number"), BCA_GAJI.accountNumber, { delay: 20 });
    await userEvent.type(screen.getByTestId("identify-name"), "BCA TikTok", { delay: 20 });
    await userEvent.click(screen.getByTestId("identify-save"));

    await expect(await screen.findByTestId("identify-error")).toHaveTextContent("move the money into it");
  },
};

// MOVE IN: the balance transfers into the real account, the shop re-points, the unknown is archived at zero.
export const MoveTheUnknownAccountIn: Story = {
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1304"]!);

    await openSetAccount(canvas);
    const move = await screen.findByTestId("identify-move");
    await waitFor(() => expect(move).toBeVisible());
    // What each does on the pill, when to pick it under (set-account-reads-lengkapi-data-or-pindah-saldo).
    await expect(screen.getByTestId("identify-fill")).toHaveTextContent("Complete details");
    await expect(move).toHaveTextContent("Move balance");
    await userEvent.click(move);
    await expect(screen.getByTestId("identify-when")).toHaveTextContent("already in the list");
    await userEvent.click(screen.getByTestId("identify-into"));
    const into = await screen.findByTestId(`identify-into-option-${BCA_OPS.id}`);
    await waitFor(() => expect(into).toBeVisible());
    await userEvent.click(into);
    await expect(screen.getByTestId("identify-move-summary")).toHaveTextContent("Melati TikTok withdraws there");
    await userEvent.click(screen.getByTestId("identify-save"));

    await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(0)));
    await expect(firstRow(canvas)).toHaveTextContent(`To ${BCA_OPS.name}`);
    await expect(canvas.getByText("Archived")).toBeVisible();
  },
};

// a-shop-has-one-account: pointing a shop here MOVES it, and the dialog names the account it leaves.
export const PointAShopHere: Story = {
  render: () => <AtBcaGaji />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1302"]!);
    await expect(canvas.getByTestId("account-shops-none")).toBeVisible();

    await userEvent.click(canvas.getByTestId("open-shop-set"));
    const shop = await screen.findByTestId("shop-select");
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    const official = await screen.findByTestId("shop-select-option-21");
    await waitFor(() => expect(official).toBeVisible());
    await userEvent.click(official);

    await waitFor(() =>
      expect(screen.getByTestId("shop-set-current")).toHaveTextContent(`withdraws into ${BCA_OPS.name} now — it moves to ${BCA_GAJI.name}`),
    );
    await userEvent.click(screen.getByTestId("shop-set-save"));

    await canvas.findByTestId("account-shops-21");
  },
};

// A warehouse's cash box: Reconcile asks what the box COUNTS. (That a warehouse sees no shops section rests on the
// server scoping ShopList by team — the stub serves every shop to every team, which other stories rely on.)
export const ACashBoxIsCounted: Story = {
  beforeEach: asTeam(11n),
  render: () => <AtKasGudang />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1306"]!);

    await userEvent.click(canvas.getByTestId(`account-reconcile-button-${KAS.id}`));
    const dialog = await screen.findByTestId("reconcile");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("What does the box count?");
  },
};

// seeing-is-team-wide-moving-is-admin-and-up: a CS reads the statement and moves nothing.
export const AMemberReadsButDoesNotMove: Story = {
  beforeEach: asRole(Role.TEAM_CUSTOMER_SERVICE),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.queryByTestId(`account-actions-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`account-reconcile-button-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId("open-shop-set")).toBeNull();
  },
};

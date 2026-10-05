import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { account, expectedBalance } from "../../../.storybook/financialAccountFixtures";
import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { FinancialAccountType } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahNumber } from "../../lib/money";
import { FinancialAccountsPage } from "./index";

// The accounts page — docs/business/financial_account/context_decision.md. Accepted at design_accept
// (the-prototype-and-its-contract-are-accepted); the stub plays the rules the server enforces.
//
// Toko Melati's accounts, from ONE consistent book (.storybook/financialAccountFixtures.ts): BCA
// Operasional 11.443.500, BCA Gaji 600.000, ShopeePay Melati −150.000 (below zero), an unknown account
// holding Melati TikTok's 4.200.000, Kas Melati 350.000 in the cash box, and BNI Lama archived at zero. Every play() is one decided rule.

const BCA_OPS = account("BCA Operasional");
const BCA_GAJI = account("BCA Gaji");
const SHOPEEPAY = account("ShopeePay Melati");
const UNKNOWN = account("Unknown — shop #25");
const BNI = account("BNI Lama");

const rp = (n: number) => formatRupiahNumber(n).replace(/\s/g, " ");

const Routed = routedPage(
  [
    { path: "/financial-accounts", element: <FinancialAccountsPage /> },
    marker("/financial-accounts/report", "at-account-report"),
    marker("/financial-accounts/:accountId", "at-account-detail"),
  ],
  "/financial-accounts",
);

const meta = {
  title: "Pages/FinancialAccount/Accounts",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: asTeam(12n),
} satisfies Meta<typeof Routed>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId(`account-balance-${BCA_OPS.id}`)).toHaveTextContent(rp(expectedBalance["1301"]!)), {
    timeout: 4000,
  });

  return canvas;
}

async function openMenu(canvas: ReturnType<typeof within>, id: bigint) {
  await userEvent.click(canvas.getByTestId(`account-actions-${id}`));
  const first = await screen.findAllByRole("menuitem");
  await waitFor(() => expect(first[0]).toBeVisible());
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const AsAWarehouse: Story = { beforeEach: asTeam(11n) };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// The totals are by TYPE and asked of the server — bank, wallet, the money in unknown accounts, the team.
export const TotalsByType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.BANK_ACCOUNT}-value`)).toHaveTextContent(rp(12_043_500));
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.WALLET}-value`)).toHaveTextContent(rp(-150_000));
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.CASH}-value`)).toHaveTextContent(rp(350_000));
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.UNKNOWN}-value`)).toHaveTextContent(rp(4_200_000));
    await expect(canvas.getByTestId("account-total-team-value")).toHaveTextContent(rp(16_443_500));
  },
};

/**
 * THE HEADER (owner) — the subtitle directly under the title, and the report button says its word. It used
 * to render i18next's "returned an object instead of string": its key was the report page's namespace.
 */
export const TheHeaderReadsAsOneBlock: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("open-account-report")).toHaveTextContent(/^Report$/);
    const title = canvas.getByRole("heading", { name: "Accounts" });
    const subtitle = canvas.getByTestId("financial-accounts-subtitle");
    // Under the title, inside the same block — not a section away.
    await expect(subtitle.getBoundingClientRect().top - title.getBoundingClientRect().bottom).toBeLessThan(12);
  },
};

// below-zero-is-warned-never-refused: the row and the totals say it — in red on the card's line, where the
// banner used to repeat it (the-accounts-page-has-no-banners).
export const BelowZeroIsWarnedNeverRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-balance-${SHOPEEPAY.id}-below-zero`)).toBeVisible();
    await expect(canvas.getByTestId(`account-balance-${BCA_OPS.id}`)).not.toHaveAttribute("data-below-zero");
    // Under the figure, what the banner used to say: allowed, and check it against the bank.
    await expect(canvas.getByTestId(`account-balance-${SHOPEEPAY.id}-below-zero`)).toHaveTextContent(
      "Below zero · check it against the bank",
    );
    // Right-aligned under the right-aligned heading.
    const figure = canvas.getByTestId(`account-balance-${BCA_OPS.id}`);
    const cell = figure.closest("td")!;
    await expect(cell.getBoundingClientRect().right - figure.getBoundingClientRect().right).toBeLessThan(16);
    const count = canvas.getByTestId(`account-total-${FinancialAccountType.WALLET}-below-zero`);
    await expect(count).toHaveTextContent("1 below zero");
    await expect(getComputedStyle(count).color).not.toBe(getComputedStyle(count.parentElement!).color);
    await expect(canvas.queryByTestId("below-zero-warning")).toBeNull();
  },
};

// a-shop-with-no-account-gets-an-unknown-one: warned "bank not named" · its menu offers Which account is
// this? and Transfer out — no reconcile (no statement to read), never operational.
export const AnUnknownAccountIsWarned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-unknown-${UNKNOWN.id}`)).toHaveTextContent("Bank not named");
    // The server names it by the shop's id; the row shows the shop's name.
    await expect(canvas.getByTestId(`account-row-${UNKNOWN.id}`)).toHaveTextContent("Unknown — Melati TikTok");
    // Its own card says it, not a banner (the-accounts-page-has-no-banners).
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.UNKNOWN}`)).toBeVisible();
    await expect(canvas.queryByTestId("unknown-warning")).toBeNull();
    await expect(canvas.getByTestId(`account-shop-${UNKNOWN.id}-25`)).toHaveTextContent("Melati TikTok");

    await openMenu(canvas, UNKNOWN.id);
    await expect(screen.getByTestId(`account-identify-${UNKNOWN.id}`)).toBeVisible();
    await expect(screen.getByTestId(`account-transfer-${UNKNOWN.id}`)).toBeVisible();
    await expect(screen.queryByTestId(`account-reconcile-${UNKNOWN.id}`)).toBeNull();
    await expect(screen.queryByTestId(`account-mark-operational-${UNKNOWN.id}`)).toBeNull();
  },
};

// Every account says when it was last checked — "never" is a state, not a blank.
/**
 * THE TYPE IS A TAB ROW, AND ITS CARD LEADS (owner, `the-accounts-type-is-a-tab-row`,
 * `the-total-leads-until-a-type-is-picked`) — Total saldo leads until a type is picked; then that type's card
 * does, and the table holds only that type.
 */
export const TheTypeTabNarrowsAndLeads: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-total-team")).toHaveAttribute("data-emphasis");
    await expect(canvas.getByTestId("account-total-team")).toHaveTextContent("Total balance");
    // The whole first, then what it is made of (the-total-saldo-comes-first).
    await expect(canvas.getByTestId("account-totals").firstElementChild).toHaveAttribute("data-testid", "account-total-team");

    const tab = canvas.getByTestId(`account-type-tab-${FinancialAccountType.UNKNOWN}`);
    await userEvent.click(tab);
    // The picked tab in the main tone — rose-700 text (a-selected-tab-is-in-the-main-tone).
    await waitFor(() => expect(getComputedStyle(tab).color).toBe("rgb(190, 18, 60)"));

    await waitFor(() => expect(canvas.queryByTestId(`account-row-${BCA_OPS.id}`)).toBeNull());
    await expect(canvas.getByTestId(`account-row-${UNKNOWN.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.UNKNOWN}`)).toHaveAttribute("data-emphasis");
    await expect(canvas.getByTestId("account-total-team")).not.toHaveAttribute("data-emphasis");

    await userEvent.click(canvas.getByTestId("account-type-tab-all"));
    await waitFor(() => expect(canvas.getByTestId("account-total-team")).toHaveAttribute("data-emphasis"));
  },
};

/** The rows on screen, in order, by id. */
function rowIds(canvas: ReturnType<typeof within>): string[] {
  return canvas
    .getAllByTestId(/^account-row-\d+$/)
    .map((r: HTMLElement) => r.getAttribute("data-testid")!.replace("account-row-", ""));
}

/**
 * EVERY FILTER THE CONTRACT HAS (owner, `the-accounts-list-has-every-filter-the-contract-has`) — the search,
 * the type, the shop, operational only, and archived; Clear resets them all.
 */
export const EveryFilterTheContractHas: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-search")).toBeVisible();
    await expect(canvas.getByTestId("account-type-tabs")).toBeVisible();
    await expect(canvas.getByTestId("account-shop-filter")).toBeVisible();

    await userEvent.click(canvas.getByText("Operational only"));
    await waitFor(() => expect(canvas.queryByTestId(`account-row-${BCA_GAJI.id}`)).toBeNull());
    for (const id of rowIds(canvas)) {
      await expect(canvas.getByTestId(`account-operational-${id}`)).toBeVisible();
    }

    await userEvent.click(canvas.getByTestId("account-filters-clear"));
    await waitFor(() => expect(canvas.getByTestId(`account-row-${BCA_GAJI.id}`)).toBeVisible());
  },
};

/**
 * THE SORT IS IN THE HEADINGS (owner, `the-accounts-table-sorts-from-its-headings`) — Akun and Penyedia, A to
 * Z first, then flipped; the server orders the whole set.
 */
export const SortsFromItsHeadings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const byName = canvas.getByTestId("account-sort-name");

    await userEvent.click(byName);
    await expect(byName).toHaveAttribute("data-sort", "asc");
    await waitFor(() => expect(rowIds(canvas)[0]).toBe(BCA_GAJI.id.toString()));

    await userEvent.click(byName);
    await expect(byName).toHaveAttribute("data-sort", "desc");
    await waitFor(() => expect(rowIds(canvas)[0]).toBe(UNKNOWN.id.toString()));

    await expect(canvas.getByRole("columnheader", { name: "Balance" }).querySelector("button")).toBeNull();
  },
};

export const LastCheckedIsAlwaysSaid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-checked-${BCA_GAJI.id}`)).toHaveTextContent("Never checked");
    await expect(canvas.getByTestId(`account-checked-${BCA_OPS.id}`)).toHaveTextContent("yesterday");
  },
};

// Archived accounts are hidden until asked — they are restored from here, and an archived row offers
// Restore and nothing else.
export const ArchivedAccountsAreHiddenUntilAsked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId(`account-row-${BNI.id}`)).toBeNull();
    await userEvent.click(canvas.getByText("Show archived accounts"));
    await canvas.findByTestId(`account-archived-${BNI.id}`);

    await openMenu(canvas, BNI.id);
    await expect(screen.getByTestId(`account-restore-${BNI.id}`)).toBeVisible();
    await expect(screen.queryByTestId(`account-transfer-${BNI.id}`)).toBeNull();
  },
};

// an-account-is-archived-only-at-zero: BCA Gaji holds 600.000, so Archive is offered disabled and says why.
// Transfer the 600.000 out, and Archive opens — then confirms, and the row leaves the live list.
export const ArchiveOnlyAtZero: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await openMenu(canvas, BCA_GAJI.id);
    const archive = screen.getByTestId(`account-archive-${BCA_GAJI.id}`);
    await expect(archive).toHaveAttribute("data-disabled");
    await expect(archive).toHaveTextContent("only at zero");

    await userEvent.click(screen.getByTestId(`account-transfer-${BCA_GAJI.id}`));
    const to = await screen.findByTestId("transfer-to");
    await waitFor(() => expect(to).toBeVisible());
    await userEvent.click(to);
    const target = await screen.findByTestId(`transfer-to-option-${BCA_OPS.id}`);
    await waitFor(() => expect(target).toBeVisible());
    await userEvent.click(target);
    await userEvent.type(screen.getByTestId("transfer-amount"), "600000", { delay: 20 });
    await userEvent.click(screen.getByTestId("transfer-save"));

    await waitFor(() => expect(canvas.getByTestId(`account-balance-${BCA_GAJI.id}`)).toHaveTextContent(rp(0)));

    await openMenu(canvas, BCA_GAJI.id);
    const enabled = screen.getByTestId(`account-archive-${BCA_GAJI.id}`);
    await waitFor(() => expect(enabled).not.toHaveAttribute("data-disabled"));
    await userEvent.click(enabled);

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByTestId(`account-row-${BCA_GAJI.id}`)).toBeNull());
  },
};

// Two legs, one act: both balances move, and the team's total does not — it is the team's own money.
export const ATransferMovesBothBalancesNotTheTotal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await openMenu(canvas, BCA_OPS.id);
    await userEvent.click(screen.getByTestId(`account-transfer-${BCA_OPS.id}`));

    const to = await screen.findByTestId("transfer-to");
    await waitFor(() => expect(to).toBeVisible());
    await userEvent.click(to);
    const target = await screen.findByTestId(`transfer-to-option-${SHOPEEPAY.id}`);
    await waitFor(() => expect(target).toBeVisible());
    await userEvent.click(target);
    await userEvent.type(screen.getByTestId("transfer-amount"), "500000", { delay: 20 });
    await expect(screen.getByTestId("transfer-after")).toHaveTextContent(rp(10_943_500));
    await userEvent.click(screen.getByTestId("transfer-save"));

    await waitFor(() => expect(canvas.getByTestId(`account-balance-${SHOPEEPAY.id}`)).toHaveTextContent(rp(350_000)));
    await expect(canvas.getByTestId(`account-balance-${BCA_OPS.id}`)).toHaveTextContent(rp(10_943_500));
    await expect(canvas.getByTestId("account-total-team-value")).toHaveTextContent(rp(16_443_500));
    // ShopeePay is above zero now, so the warning goes with it.
    await waitFor(() => expect(canvas.queryByTestId("below-zero-warning")).toBeNull());
  },
};

// The dialog warns BEFORE a transfer takes an account below zero — and still lets it through.
export const ATransferBelowZeroIsWarnedNotBlocked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await openMenu(canvas, BCA_GAJI.id);
    await userEvent.click(screen.getByTestId(`account-transfer-${BCA_GAJI.id}`));
    const to = await screen.findByTestId("transfer-to");
    await waitFor(() => expect(to).toBeVisible());
    await userEvent.click(to);
    const target = await screen.findByTestId(`transfer-to-option-${BCA_OPS.id}`);
    await waitFor(() => expect(target).toBeVisible());
    await userEvent.click(target);
    await userEvent.type(screen.getByTestId("transfer-amount"), "1000000", { delay: 20 });

    await expect(screen.getByTestId("transfer-below-zero")).toBeVisible();
    await expect(screen.getByTestId("transfer-save")).not.toBeDisabled();
    await userEvent.click(screen.getByTestId("transfer-save"));

    await waitFor(() => expect(canvas.getByTestId(`account-balance-${BCA_GAJI.id}-below-zero`)).toBeVisible());
  },
};

// an-account-opens-with-a-log-row: a new account appears with its opening balance — posted as its first row.
export const ANewAccountOpensWithItsBalance: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-account"));
    const name = await screen.findByTestId("account-name");
    await waitFor(() => expect(name).toBeVisible());
    await userEvent.type(name, "Kas Toko", { delay: 20 });
    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.CASH}`));
    await userEvent.click(screen.getByTestId("account-provider"));
    const cash = await screen.findByTestId("account-provider-option-1");
    await waitFor(() => expect(cash).toBeVisible());
    await userEvent.click(cash);
    // A cash box has no number to ask for.
    await expect(screen.queryByTestId("account-number")).toBeNull();
    const opening = screen.getByTestId("account-opening");
    await userEvent.clear(opening);
    await userEvent.type(opening, "250000", { delay: 20 });
    await userEvent.click(screen.getByTestId("account-form-save"));

    const row = await canvas.findByText("Kas Toko");
    await waitFor(() => expect(row).toBeVisible());
    await waitFor(() => expect(canvas.getByTestId("account-total-team-value")).toHaveTextContent(rp(16_693_500)));
  },
};

// a-real-account-is-recorded-once: a number recorded in ANOTHER team is refused, and the dialog says so.
export const ARecordedNumberIsRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-account"));
    const name = await screen.findByTestId("account-name");
    await waitFor(() => expect(name).toBeVisible());
    await userEvent.type(name, "Jago Baru", { delay: 20 });
    await userEvent.click(screen.getByTestId("account-provider"));
    const jago = await screen.findByTestId("account-provider-option-4");
    await waitFor(() => expect(jago).toBeVisible());
    await userEvent.click(jago);
    // Jago Kenanga's number — Toko Kenanga's account, not this team's.
    await userEvent.type(screen.getByTestId("account-number"), "1029384756", { delay: 20 });
    await userEvent.click(screen.getByTestId("account-form-save"));

    await expect(await screen.findByTestId("account-form-error")).toHaveTextContent("already recorded");
  },
};

// operational-accounts-pay-for-operations: marking an account adds it to a restock's Paid from.
export const MarkAnAccountOperational: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId(`account-operational-${BCA_GAJI.id}`)).toBeNull();
    await openMenu(canvas, BCA_GAJI.id);
    await userEvent.click(screen.getByTestId(`account-mark-operational-${BCA_GAJI.id}`));

    await canvas.findByTestId(`account-operational-${BCA_GAJI.id}`);
  },
};

// seeing-is-team-wide-moving-is-admin-and-up: a CS sees every account and balance — and no button.
export const AMemberSeesButDoesNotMove: Story = {
  beforeEach: asRole(Role.TEAM_CUSTOMER_SERVICE),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-total-team-value")).toHaveTextContent(rp(16_443_500));
    await expect(canvas.queryByTestId("open-create-account")).toBeNull();
    await expect(canvas.queryByTestId(`account-actions-${BCA_OPS.id}`)).toBeNull();
  },
};

// A detail view is a page: the row opens the account.
export const ARowOpensTheAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByText(BCA_OPS.name));
    await canvas.findByTestId("at-account-detail");
  },
};

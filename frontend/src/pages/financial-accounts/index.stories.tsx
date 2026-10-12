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
  parameters: { signedIn: true, dataRouter: true },
  // Toko Melati's Admin — a selling team's, who moves its money.
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_ADMIN)();
  },
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

// ── Mobile ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// The `viewport` global sizes the story's canvas in the test run too (the orders list's phone story asserts on it), so
// these play against the phone layout.

// MOBILE (`a-phone-filters-from-a-sheet`, `a-phone-reads-each-line-as-a-block`) — the search stays in the row and
// everything else is behind the Filter button; every account is a block, its balance and its ⋯ on screen.
//
// Two bugs pinned here (owner: *"deskripsi di mobile bug, actionnya masih bug juga"*, *"di mobile header masih ada"*):
//   the header — the title block took no room, the subtitle shrank to one word a line and Laporan sat on the title;
//   the table — 929px in a 318px screen under its headings, the balance and every action off to the right.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The subtitle reads as a sentence, and the actions sit under the title rather than over it.
    const heading = canvas.getByTestId("financial-accounts-heading").getBoundingClientRect();
    const subtitle = canvas.getByTestId("financial-accounts-subtitle").getBoundingClientRect();
    const report = canvas.getByTestId("open-account-report").getBoundingClientRect();
    await expect(subtitle.width).toBeGreaterThan(250);
    await expect(report.top).toBeGreaterThanOrEqual(subtitle.bottom - 1);
    await expect(report.top).toBeGreaterThan(heading.bottom);

    await expect(canvas.getByTestId("account-search")).toBeVisible();
    await expect(canvas.getByTestId("account-filters-open")).toBeVisible();
    await expect(canvas.queryByTestId("account-shop-filter")).toBeNull();
    await expect(canvas.getByTestId("account-type-tabs")).toBeVisible();

    // A block per account: no headings, the balance and the menu inside the screen.
    const list = canvas.getByTestId("financial-accounts-table");
    await expect(within(list).queryAllByRole("columnheader")).toHaveLength(0);
    const balance = canvas.getByTestId(`account-balance-${BCA_OPS.id}`).getBoundingClientRect();
    await expect(balance.right).toBeLessThanOrEqual(window.innerWidth);
    const menu = canvas.getByTestId(`account-actions-${BCA_OPS.id}`).getBoundingClientRect();
    await expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(canvas.getByTestId("account-pager")).toBeVisible();

    // Below zero says the fact alone on a phone — no "check it against the bank" (owner: *"tidak perlu cocokkan dengan
    // bank jika mobile"*).
    const shopeepay = canvas.getByTestId(`account-row-${SHOPEEPAY.id}`);
    await expect(shopeepay).toHaveTextContent("Below zero");
    await expect(shopeepay).not.toHaveTextContent("check it against the bank");
  },
};

// Mobile: the shop, Operational only and the sort open from the Filter button, full width — the sort a select
// there, because a phone has no column headings to press.
export const MobileFiltersAreASheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-filters-open"));
    const sheet = await screen.findByTestId("account-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("account-shop-filter")).toBeVisible();
    await expect(within(sheet).getByTestId("account-operational-only")).toBeVisible();
    await expect(within(sheet).getByTestId("account-sort-select")).toBeVisible();

    await userEvent.click(within(sheet).getByTestId("account-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("account-filters-sheet")).toBeNull());
  },
};

export const AsAWarehouse: Story = {
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
};

// the-warehouse-admin-equals-the-owner-except-money: the warehouse Admin keeps and reconciles the accounts, and moves
// no money between them — no Transfer, no Capital. Reconcile stays the row's button
// (`transfer-and-reconcile-sit-on-the-row`); the menu never repeats it, so it is looked for on the row.
export const TheWarehouseAdminNeitherTransfersNorAddsCapital: Story = {
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("account-reconcile-button-1307", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.queryByTestId("account-transfer-button-1307")).toBeNull();

    await userEvent.click(canvas.getByTestId("account-actions-1307"));
    await waitFor(() => expect(screen.getByTestId("account-edit-1307")).toBeVisible());
    await expect(screen.queryByTestId("account-transfer-1307")).toBeNull();
    await expect(screen.queryByTestId("account-capital-1307")).toBeNull();
  },
};

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

// a-shop-with-no-account-gets-an-unknown-one, read as LAINNYA (owner, `the-unknown-account-reads-lainnya`): shown
// by its shop's name — no "Unknown —", no badge — its provider badge and card saying *Other*, and a warning
// where the holder would be. On the row, Transfer out; in the menu, Set account and Archive
// (`the-unknown-row-warns-and-sets-from-the-menu`) — no reconcile, never operational.
export const AnUnknownAccountIsWarned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const row = canvas.getByTestId(`account-row-${UNKNOWN.id}`);

    // The server names it by the shop's id; the row shows only the shop's name.
    await expect(row).toHaveTextContent("Melati TikTok");
    await expect(row).not.toHaveTextContent("Unknown");
    await expect(row).not.toHaveTextContent("Bank not named");
    await expect(row).toHaveTextContent("Other");
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.UNKNOWN}`)).toHaveTextContent("Other");
    await expect(canvas.getByTestId(`account-shop-${UNKNOWN.id}-25`)).toHaveTextContent("Melati TikTok");

    await expect(canvas.getByTestId(`account-not-set-${UNKNOWN.id}`)).toHaveTextContent("No account set yet");
    await expect(canvas.queryByTestId(`account-not-set-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`account-identify-button-${UNKNOWN.id}`)).toBeNull();
    await expect(canvas.getByTestId(`account-transfer-button-${UNKNOWN.id}`)).toHaveTextContent("Transfer Out");
    await expect(canvas.queryByTestId(`account-reconcile-button-${UNKNOWN.id}`)).toBeNull();

    await openMenu(canvas, UNKNOWN.id);
    await expect(screen.getByTestId(`account-archive-${UNKNOWN.id}`)).toBeVisible();
    await expect(screen.getByTestId(`account-identify-${UNKNOWN.id}`)).toHaveTextContent("Set Account");
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

    // Operational only and archived live in ONE panel behind its own trigger
    // (operational-and-archived-share-one-filter-panel).
    await userEvent.click(canvas.getByTestId("account-options-trigger"));
    const operational = await screen.findByText("Operational only");
    await waitFor(() => expect(operational).toBeVisible());
    await userEvent.click(operational);
    await waitFor(() => expect(canvas.queryByTestId(`account-row-${BCA_GAJI.id}`)).toBeNull());
    await expect(canvas.getByTestId("account-options-count")).toHaveTextContent("1");
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

    // Penyedia — the provider's stored word, A to Z: bca first; flipped, "unknown" first — Mandiri Usaha (provider
    // Lainnya) before the Melati TikTok account, the name breaking the tie A to Z as the server does.
    const byProvider = canvas.getByTestId("account-sort-provider");
    await userEvent.click(byProvider);
    await waitFor(() => expect(rowIds(canvas)[0]).toBe(BCA_GAJI.id.toString()));
    await userEvent.click(byProvider);
    await waitFor(() => expect(rowIds(canvas)[0]).toBe(account("Mandiri Usaha").id.toString()));
  },
};

/**
 * THE PROVIDER CELL CARRIES THE NUMBER, AND THE BALANCE IS BOLD (owner, `the-provider-cell-carries-the-number`,
 * `a-balance-is-bold`) — one column for where the money is, the figure the row is read for in bold.
 */
export const TheProviderCellCarriesTheNumber: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByRole("columnheader", { name: "Number" })).toBeNull();
    const number = canvas.getByTestId(`account-number-${BCA_OPS.id}`);
    await expect(number).toHaveTextContent("1234567890");
    await expect(number.closest("td")).toHaveTextContent("BCA");
    // A cash box has no number — the cell is the badge alone.
    await expect(canvas.queryByTestId(`account-number-${account("Kas Melati").id}`)).toBeNull();

    const figure = canvas.getByTestId(`account-balance-${BCA_OPS.id}`).querySelector("p")!;
    await expect(getComputedStyle(figure).fontWeight).toBe("700");
  },
};

export const LastCheckedIsAlwaysSaid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-checked-${BCA_GAJI.id}`)).toHaveTextContent("Never checked");
    await expect(canvas.getByTestId(`account-checked-${BCA_OPS.id}`)).toHaveTextContent("yesterday");
  },
};

/**
 * THE ARCHIVE IS ITS OWN VIEW (owner, `the-archive-is-its-own-view`) — the Archive button beside New Account turns
 * this screen into the archived list: no totals, no Filter panel, the search, the shop and the type tabs, and the
 * pending mark saying the contract cannot list archived accounts alone. An archived row offers Restore and
 * nothing else. Active Accounts goes back.
 */
export const ArchivedAccountsAreHiddenUntilAsked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId(`account-row-${BNI.id}`)).toBeNull();
    await userEvent.click(canvas.getByTestId("open-archived-accounts"));

    await canvas.findByTestId(`account-archived-${BNI.id}`);
    await expect(canvas.getByTestId("financial-accounts-heading")).toHaveTextContent("Archived Accounts");
    await expect(canvas.queryByTestId(`account-row-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId("account-totals")).toBeNull();
    await expect(canvas.queryByTestId("account-options-trigger")).toBeNull();
    await expect(canvas.getByTestId("account-search")).toBeVisible();
    await expect(canvas.getByTestId("account-type-tab-all")).toHaveTextContent("1");
    await expect(canvas.getByLabelText(/Not implemented, number 1/)).toBeVisible();

    // Restore is the only thing an archived account offers — a button, and no menu.
    await expect(canvas.getByTestId(`account-restore-button-${BNI.id}`)).toBeVisible();
    await expect(canvas.queryByTestId(`account-actions-${BNI.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`account-transfer-button-${BNI.id}`)).toBeNull();

    await userEvent.click(canvas.getByTestId("back-to-active-accounts"));
    await waitFor(() => expect(canvas.getByTestId(`account-row-${BCA_OPS.id}`)).toBeVisible());
    await expect(canvas.queryByTestId(`account-row-${BNI.id}`)).toBeNull();
    await expect(canvas.getByTestId("account-totals")).toBeVisible();
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
    await userEvent.keyboard("{Escape}");

    await userEvent.click(canvas.getByTestId(`account-transfer-button-${BCA_GAJI.id}`));
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

    await userEvent.click(canvas.getByTestId(`account-transfer-button-${BCA_OPS.id}`));

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

    await userEvent.click(canvas.getByTestId(`account-transfer-button-${BCA_GAJI.id}`));
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

/**
 * TERHUBUNG KE — THREE, THEN "+N" (owner, `the-linked-column-shows-three-then-more`). BCA Operasional is
 * operational and three shops withdraw into it: three badges, a +1, and the dialog lists all four.
 */
export const TheLinkedColumnShowsThreeThenMore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("columnheader", { name: "Linked to" })).toBeVisible();
    await expect(canvas.getByTestId(`account-operational-${BCA_OPS.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`account-shop-${BCA_OPS.id}-22`)).toBeVisible();
    await expect(canvas.queryByTestId(`account-shop-${BCA_OPS.id}-23`)).toBeNull();

    const more = canvas.getByTestId(`account-links-more-${BCA_OPS.id}`);
    await expect(more).toHaveTextContent("+1");
    await userEvent.click(more);

    const dialog = await screen.findByTestId(`account-links-dialog-${BCA_OPS.id}`);
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(within(dialog).getByTestId("account-links-shop-23")).toHaveTextContent("Melati Grosir");
    await expect(dialog).toHaveTextContent("Operational");
    // The row did not open the account's page underneath.
    await expect(canvas.queryByTestId("at-account-detail")).toBeNull();
  },
};

/**
 * TRANSFER AND RECONCILE SIT ON THE ROW (owner, `transfer-and-reconcile-sit-on-the-row`) — the menu holds the
 * rest, never a second copy of either.
 */
export const TransferAndReconcileSitOnTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-transfer-button-${BCA_OPS.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`account-reconcile-button-${BCA_OPS.id}`)).toBeVisible();

    await openMenu(canvas, BCA_OPS.id);
    await expect(screen.getByTestId(`account-capital-${BCA_OPS.id}`)).toBeVisible();
    await expect(screen.queryByTestId(`account-transfer-${BCA_OPS.id}`)).toBeNull();
    await expect(screen.queryByTestId(`account-reconcile-${BCA_OPS.id}`)).toBeNull();
  },
};

/**
 * THE PAGER GROWS WITH THE PAGES OPENED (owner, `the-accounts-pager-grows-with-the-pages-opened`) — five accounts
 * are one page: ‹ [1] ›, both arrows off, still on screen.
 */
export const ThePagerGrowsWithThePagesOpened: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-pager-page-1")).toBeVisible();
    await expect(canvas.queryByTestId("account-pager-page-2")).toBeNull();
    await expect(canvas.getByTestId("account-pager-prev")).toBeDisabled();
    await expect(canvas.getByTestId("account-pager-next")).toBeDisabled();
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
    // A cash box's provider is Kas by itself (the-type-decides-the-provider) — no provider field at all.
    await waitFor(() => expect(screen.queryByTestId("account-provider")).toBeNull());
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

/**
 * THE TYPE DECIDES THE PROVIDER (owner, `the-type-decides-the-provider`) — a bank account picks among BCA, BNI and
 * Jago; a digital wallet among ShopeePay; a cash box is Kas by itself; type Lainnya is Lainnya by itself, its number
 * optional — and marked unimplemented, the server refusing it.
 */
export const TheTypeDecidesTheProvider: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-account"));
    await userEvent.click(await screen.findByTestId("account-provider"));
    await waitFor(() => expect(screen.getByTestId("account-provider-option-2")).toBeVisible());
    // A bank account: the banks only.
    await expect(screen.queryByTestId("account-provider-option-5")).toBeNull();
    await expect(screen.queryByTestId("account-provider-option-6")).toBeNull();
    await userEvent.keyboard("{Escape}");

    // A digital wallet keeps its picker, ShopeePay already picked — the only one there is.
    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.WALLET}`));
    await waitFor(() => expect(screen.getByTestId("account-provider")).toHaveTextContent("ShopeePay"));

    // Kas and Lainnya set their own provider — no field (kas-and-lainnya-ask-no-provider).
    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.CASH}`));
    await waitFor(() => expect(screen.queryByTestId("account-provider")).toBeNull());
    await expect(screen.queryByTestId("account-number")).toBeNull();

    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.UNKNOWN}`));
    await expect(screen.queryByTestId("account-provider")).toBeNull();
    await expect(screen.getByTestId("account-number")).toBeVisible();
    const warning = screen.getByTestId("account-other-type-warning");
    await expect(warning).toHaveTextContent("does not accept type Other yet");
    await expect(within(warning).getByLabelText(/Not implemented, number 2/)).toBeInTheDocument();
  },
};

/**
 * THE DEMO OF LAINNYA (owner: *"untuk lainnya buat aja dulu demonya saja"*) — Mandiri Usaha, type Lainnya, provider
 * Lainnya: shown by its own name with its holder under it, no warning (it holds no shop's withdrawals), counted
 * under Other. And in the demo a new one saves without a number — the real server does not accept it yet.
 */
export const AnotherBankReadsOtherInTheDemo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const mandiri = account("Mandiri Usaha");
    const row = canvas.getByTestId(`account-row-${mandiri.id}`);

    await expect(row).toHaveTextContent("Mandiri Usaha");
    await expect(row).toHaveTextContent("PT Melati Sejahtera");
    await expect(row).toHaveTextContent("Other");
    await expect(canvas.queryByTestId(`account-not-set-${mandiri.id}`)).toBeNull();

    await userEvent.click(canvas.getByTestId("open-create-account"));
    const name = await screen.findByTestId("account-name");
    await waitFor(() => expect(name).toBeVisible());
    await userEvent.type(name, "BRI Usaha", { delay: 20 });
    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.UNKNOWN}`));
    await userEvent.click(screen.getByTestId("account-form-save"));

    await waitFor(() => expect(canvas.getByText("BRI Usaha")).toBeVisible());
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

// operational-accounts-pay-for-operations: marking an account adds it to a restock's Paid from — and it asks
// first (owner, `operational-asks-before-it-changes`), saying what the mark does.
export const MarkAnAccountOperational: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId(`account-operational-${BCA_GAJI.id}`)).toBeNull();
    await openMenu(canvas, BCA_GAJI.id);
    await userEvent.click(screen.getByTestId(`account-mark-operational-${BCA_GAJI.id}`));

    // Nothing changes until it is confirmed.
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(canvas.queryByTestId(`account-operational-${BCA_GAJI.id}`)).toBeNull();
    await expect(screen.getByText(/can then be picked to pay restocks and expenses/)).toBeVisible();
    await userEvent.click(confirm);

    await canvas.findByTestId(`account-operational-${BCA_GAJI.id}`);
  },
};

// seeing-is-team-wide-moving-is-admin-and-up: a CS sees every account and balance — and no button.
export const AMemberSeesButDoesNotMove: Story = {
  beforeEach: asRole(Role.SELLING_CS),
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

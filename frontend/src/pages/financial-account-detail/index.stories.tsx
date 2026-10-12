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
  parameters: { signedIn: true, dataRouter: true },
  // Toko Melati's Admin — a selling team's, who moves its money.
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_ADMIN)();
  },
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

// ── Mobile ──────────────────────────────────────────────────────────────────────────────────────
//
// The `viewport` global sizes the story's canvas in the test run too, so these play against the phone layout.

// MOBILE (owner, `the-account-page-follows-the-screen-rules`) — the header is the name and its ⋯, every action inside
// the menu (`the-phone-header-is-one-row`); the two cards two to a row; the statement's filters behind one button;
// the statement three columns under their headings, the change right under the balance, and a tap opening the rest
// (`a-phone-statement-row-opens-its-detail`).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    // No action buttons on a phone — the ⋯ on the name's row holds them, Transfer and Cocokkan Saldo included.
    await expect(canvas.queryByTestId(`account-reconcile-button-${BCA_OPS.id}`)).toBeNull();
    const heading = canvas.getByTestId("account-name-heading").getBoundingClientRect();
    const menu = canvas.getByTestId(`account-actions-${BCA_OPS.id}`).getBoundingClientRect();
    await expect(menu.top).toBeLessThan(heading.bottom);
    await userEvent.click(canvas.getByTestId(`account-actions-${BCA_OPS.id}`));
    await waitFor(() => expect(screen.getByTestId(`account-reconcile-${BCA_OPS.id}`)).toBeVisible());
    await expect(screen.getByTestId(`account-transfer-${BCA_OPS.id}`)).toBeVisible();
    await userEvent.keyboard("{Escape}");

    // Toko terhubung takes the whole row under the two cards.
    const balanceCard = canvas.getByTestId("account-detail-balance-card").getBoundingClientRect();
    const shops = canvas.getByTestId("account-shops").getBoundingClientRect();
    await expect(shops.top).toBeGreaterThan(balanceCard.bottom);
    await expect(shops.width).toBeGreaterThan(balanceCard.width * 1.8);

    await expect(canvas.getByTestId("account-log-filters-open")).toBeVisible();
    await expect(canvas.getByTestId("account-log-pager")).toBeVisible();
  },
};

// MOBILE STATEMENT (owner, `a-phone-statement-row-opens-its-detail`, `the-type-sits-under-the-date-on-a-phone`) — the
// headings stay, Tanggal · Saldo; the type right under the date, the change right under the balance; no description
// on the row — a tap opens it, with who and when it was typed.
export const MobileStatementRowOpensItsDetail: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    const log = canvas.getByTestId("account-log-table");
    await expect(within(log).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Date", "Balance"]);

    const row = canvas.getByTestId("account-log-row-1428");
    await expect(row).not.toHaveTextContent("Reconcile");
    const [left, right] = within(row).getAllByRole("cell");

    // The type sits right under the date, on the same left edge.
    const [date, type] = Array.from(left!.firstElementChild!.children);
    await expect(date).toHaveTextContent("Oct");
    await expect(type).toHaveTextContent("Adjustment");
    const d = date!.getBoundingClientRect();
    const ty = type!.getBoundingClientRect();
    await expect(ty.top).toBeGreaterThanOrEqual(d.bottom - 1);
    await expect(Math.abs(ty.left - d.left)).toBeLessThan(2);

    // The change sits right under the balance, on the same right edge.
    const [balance, change] = Array.from(right!.firstElementChild!.children);
    await expect(balance).toHaveTextContent(rp(11_443_500));
    await expect(change).toHaveTextContent(`−${rp(6_500)}`);
    const b = balance!.getBoundingClientRect();
    const c = change!.getBoundingClientRect();
    await expect(c.top).toBeGreaterThanOrEqual(b.bottom - 1);
    await expect(Math.abs(c.right - b.right)).toBeLessThan(2);

    // A tap opens the whole row.
    await userEvent.click(row);
    const detail = await screen.findByTestId("account-log-detail");
    await waitFor(() => expect(detail).toBeVisible());
    await expect(within(detail).getByTestId("account-log-detail-description")).toHaveTextContent("Reconcile — the app showed");
    await expect(within(detail).getByTestId("account-log-detail-way")).toHaveTextContent("by hand · Ani Rahayu");
    await expect(within(detail).getByTestId("account-log-detail-balance")).toHaveTextContent(rp(11_443_500));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("account-log-detail")).toBeNull());
  },
};

// Mobile: the type and the window open from the Filter button, full width, in a bottom sheet.
export const MobileFiltersAreASheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await userEvent.click(canvas.getByTestId("account-log-filters-open"));
    const sheet = await screen.findByTestId("account-log-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("account-log-type-filter")).toBeVisible();
    await expect(within(sheet).getByTestId("account-log-range")).toBeVisible();

    await userEvent.click(within(sheet).getByTestId("account-log-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("account-log-filters-sheet")).toBeNull());
  },
};

export const BelowZero: Story = { render: () => <AtShopeePay /> };

export const Unknown: Story = { render: () => <AtUnknown /> };

export const AWarehouseCashBox: Story = {
  beforeEach: asTeam(11n),
  render: () => <AtKasGudang />,
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// TOKO TERHUBUNG IS THE THIRD CARD (owner, `linked-shops-sit-beside-the-cards`) — as wide and as tall as the two beside
// it, in their row; two shops then "+1", each chip in its marketplace's colour; "Point a Shop ›" at the end of its label
// row, only the word pressed.
export const LinkedShopsAreTheThirdCard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    const cards = Array.from(canvas.getByTestId("account-detail-summary").children).map((el) => el.getBoundingClientRect());
    await expect(cards).toHaveLength(3);
    await expect(Math.abs(cards[2]!.width - cards[0]!.width)).toBeLessThan(2);
    await expect(Math.abs(cards[2]!.top - cards[0]!.top)).toBeLessThan(2);
    await expect(Math.abs(cards[2]!.height - cards[0]!.height)).toBeLessThan(2);

    const shops = canvas.getByTestId("account-shops");
    await expect(shops).toHaveTextContent("Linked shops");
    await expect(within(shops).getByTestId(`account-shop-${BCA_OPS.id}-21`)).toHaveTextContent("Melati Official");
    await expect(within(shops).getByTestId(`account-shop-${BCA_OPS.id}-22`)).toHaveTextContent("Melati Store");
    await expect(within(shops).queryByTestId(`account-shop-${BCA_OPS.id}-23`)).toBeNull();
    await expect(within(shops).getByTestId(`account-links-more-${BCA_OPS.id}`)).toHaveTextContent("+1");
    await expect(within(shops).getByTestId("account-shops-count")).toHaveTextContent("3 shops");

    // Shopee and Tokopedia: two marketplaces, two colours.
    const official = getComputedStyle(within(shops).getByTestId(`account-shop-${BCA_OPS.id}-21`)).backgroundColor;
    const store = getComputedStyle(within(shops).getByTestId(`account-shop-${BCA_OPS.id}-22`)).backgroundColor;
    await expect(official).not.toBe(store);

    await expect(within(shops).getByTestId("open-shop-set")).toHaveTextContent("Point a Shop");
  },
};

// A date speaks the app's language, not the browser's (owner: *"yesterday tidak ikut i18n?"*) — in Indonesian the last
// check reads "kemarin", its date "7 Okt 2026"-style.
export const DatesFollowTheAppsLanguage: Story = {
  globals: { locale: "id" },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.getByTestId("account-detail-checked")).toHaveTextContent("kemarin");
    await expect(canvas.getByTestId("account-detail-checked")).not.toHaveTextContent("yesterday");
  },
};

// SEVERAL TYPES AT ONCE (owner, `the-statement-filters-several-types`) — a search select: typing narrows the nine, each
// option is the type's own badge, and the picks sit in the field as the same badges, four at most and "+N" past that.
// Expense + Ads is "what did we spend": BCA Operasional's packing material and its Shopee ads top-up.
export const TheStatementFiltersSeveralTypes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);
    const rows = () => within(canvas.getByTestId("account-log-table")).getAllByRole("row");
    const height = (testId: string) => Math.round(canvas.getByTestId(testId).getBoundingClientRect().height);

    // It starts at the date field's height — the recipe's own input minimum made it 42 against the date's 36.
    await expect(height("account-log-type-field")).toBe(height("account-log-range"));

    // Typing narrows the list to what matches.
    await userEvent.click(canvas.getByTestId("account-log-type-filter"));
    await userEvent.type(canvas.getByTestId("account-log-type-filter"), "Expense", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`account-log-type-option-${T.WITHDRAWAL}`)).toBeNull());
    const expense = await canvas.findByTestId(`account-log-type-option-${T.EXPENSE}`);
    await waitFor(() => expect(expense).toBeVisible());
    await userEvent.click(expense);

    // A pick starts the list over, and the panel stays open for the next one.
    const ads = await canvas.findByTestId(`account-log-type-option-${T.ADS_EXPENSE}`);
    await waitFor(() => expect(ads).toBeVisible());
    await userEvent.click(ads);
    await waitFor(() => expect(rows()).toHaveLength(1 + 2));

    // The picks are badges in the field, in the statement's colours.
    await expect(canvas.getByTestId(`account-log-type-chip-${T.EXPENSE}`)).toHaveTextContent("Expense");
    await expect(canvas.getByTestId(`account-log-type-chip-${T.ADS_EXPENSE}`)).toHaveTextContent("Ads");

    // Two picks still fit one line, at the field's height.
    await expect(height("account-log-type-field")).toBe(height("account-log-range"));

    // Four badges at most; the fifth and after are "+N".
    for (const c of [T.WITHDRAWAL, T.RESTOCK, T.TRANSFER]) {
      const option = canvas.getByTestId(`account-log-type-option-${c}`);
      await waitFor(() => expect(option).toBeVisible());
      await userEvent.click(option);
    }
    await waitFor(() => expect(canvas.getByTestId("account-log-type-more")).toHaveTextContent("+1"));
    await expect(within(canvas.getByTestId("account-log-type-picks")).getAllByTestId(/^account-log-type-chip-/)).toHaveLength(4);

    // The × and the ⌄ are not in the box the picks wrap in — they hold the field's right edge.
    const picks = canvas.getByTestId("account-log-type-picks");
    const indicators = canvas.getByTestId("account-log-type-indicators");
    await expect(picks.contains(indicators)).toBe(false);
    await expect(indicators.getBoundingClientRect().left).toBeGreaterThanOrEqual(picks.getBoundingClientRect().right);

    // A pick is taken back by its ✓ in the list; Clear takes the rest.
    for (const c of [T.WITHDRAWAL, T.RESTOCK, T.TRANSFER, T.ADS_EXPENSE]) {
      await userEvent.click(canvas.getByTestId(`account-log-type-option-${c}`));
    }
    await waitFor(() => expect(rows()).toHaveLength(1 + 1));
    await expect(canvas.queryByTestId(`account-log-type-chip-${T.ADS_EXPENSE}`)).toBeNull();
    await expect(canvas.queryByTestId("account-log-type-more")).toBeNull();

    await userEvent.click(canvas.getByTestId("account-log-filters-clear"));
    await waitFor(() => expect(canvas.queryByTestId(`account-log-type-chip-${T.EXPENSE}`)).toBeNull());
    await waitFor(() => expect(rows().length).toBeGreaterThan(1 + 2));
  },
};

// THE ACCOUNT PAGE FOLLOWS THE SCREEN RULES (owner, `the-account-page-follows-the-screen-rules`) — the figures are the
// order list's cards, the balance leading; the statement's filters the shared FilterBar, Clear red and bold while one is
// set; the pages grow as they are opened.
export const TheAccountPageFollowsTheScreenRules: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    // Saldo, Terakhir dicek — and Toko terhubung beside them (`linked-shops-sit-beside-the-cards`).
    await expect(canvas.getByTestId("account-detail-summary").children).toHaveLength(3);
    await expect(canvas.getByTestId("account-detail-balance-card")).toHaveAttribute("data-emphasis");
    await expect(canvas.getByTestId("account-detail-checked-card")).not.toHaveAttribute("data-emphasis");

    await expect(canvas.queryByTestId("account-log-filters-clear")).toBeNull();
    await userEvent.click(canvas.getByTestId("account-log-type-filter"));
    const withdrawal = await canvas.findByTestId(`account-log-type-option-${T.WITHDRAWAL}`);
    await waitFor(() => expect(withdrawal).toBeVisible());
    await userEvent.click(withdrawal);
    await waitFor(() => expect(within(canvas.getByTestId("account-log-table")).getAllByRole("row")).toHaveLength(1 + 3));

    await userEvent.click(canvas.getByTestId("account-log-filters-clear"));
    await waitFor(() => expect(within(canvas.getByTestId("account-log-table")).getAllByRole("row").length).toBeGreaterThan(1 + 3));
    await expect(canvas.getByTestId("account-log-pager")).toBeVisible();
  },
};

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

// A statement row lights up under the pointer, every cell of it (owner: *"hoverable juga"*, `a-statement-row-lights-up`);
// the last column reads Saldo (owner: *"saldo setelah jadi saldo saja"*).
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const AStatementRowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    const headers = within(canvas.getByTestId("account-log-table")).getAllByRole("columnheader");
    await expect(headers.at(-1)).toHaveTextContent(/^Balance$/);

    const row = firstRow(canvas);
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[4]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
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

    await expect(canvas.getByTestId("account-shop-1301-21")).toHaveTextContent("Melati Official");
    await expect(canvas.getByTestId("account-shop-1301-22")).toHaveTextContent("Melati Store");
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

    await canvas.findByTestId(`account-shop-${BCA_GAJI.id}-21`);
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
  beforeEach: asRole(Role.SELLING_CS),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.queryByTestId(`account-actions-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`account-reconcile-button-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId("open-shop-set")).toBeNull();
  },
};

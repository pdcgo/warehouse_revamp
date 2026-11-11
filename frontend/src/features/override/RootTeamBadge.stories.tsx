import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { liabilityTermsChanges, orderDetailExtras } from "../../../.storybook/fixtures";
import { rackHistoryRowByForStory } from "../../../.storybook/rackStub";
import { expenseByForStory } from "../../../.storybook/expenseStub";
import { restockLogByForStory } from "../../../.storybook/restockStub";
import { accountLogByForStory } from "../../../.storybook/financialAccountStub";
import { bundleCreatedByForStory } from "../../../.storybook/bundleStub";
import { bundleFixture } from "../../../.storybook/bundleFixtures";
import { shopEntriesBook, withShopEntriesBook } from "../../../.storybook/shopEntriesStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { SHOP_ENTRIES_PATH } from "../settlement/shopEntries";
import { OrderDetailPage } from "../../pages/order-detail";
import { RackDetailPage } from "../../pages/rack-detail";
import { ExpensesPage } from "../../pages/expenses";
import { SettlementShopEntriesPage } from "../../pages/settlement-shop-entries";
import { UsersPage } from "../../pages/users";
import { LiabilityDetailPage } from "../../pages/liability-detail";
import { RestockSellingDetailPage } from "../../pages/restock-selling-detail";
import { FinancialAccountDetailPage } from "../../pages/financial-account-detail";
import { BundlesPage } from "../../pages/bundles";

// THE "BY ROOT TEAM" BADGE ON THE LIVE SCREENS (an-override-shows-a-platform-badge, accepted as
// the-override-badge-is-accepted-as-by-root-team). Every read a screen names a person from serves the record's
// `is_override`; here the stubs serve it for ONE record per screen — Root (Fajar) or the System Administrator (Gita)
// acting inside a team they hold no role in — beside records the team's own people wrote. The badge must sit on that
// record only, and say what it means: a tooltip on a desktop, a tap on a phone.
//
//   | story               | the screen                              | the override record                            |
//   | ------------------- | --------------------------------------- | ---------------------------------------------- |
//   | OrderTimeline       | Toko Melati's order 101, Timeline       | "Confirmed" — Fajar, in Gudang Pusat           |
//   | StockHistory        | Gudang Pusat's shelf A-01-1, history    | the sugar received — Fajar                     |
//   | Expenses            | Toko Melati's Expenses, Recorded by     | Electricity — recorded by Gita                 |
//   | SettlementEntries   | Toko Melati's Entri Toko                | the manual system adjustment — posted by Gita  |
//   | MemberLog           | Gudang Pusat's Membership History       | Fajar removing a staff member                  |
//   | TermsLog            | Gudang Pusat ↔ Toko Melati, Limits      | change 3, the cap lifted — Fajar               |
//   | RestockTimeline     | Toko Melati's restock 502, Timeline     | the arrival signed for — Fajar                 |
//   | AccountLog          | BCA Operasional's log                   | the transfer to BCA Gaji — by hand, Gita       |
//   | Bundles             | Toko Melati's bundles, Created by       | Paket Hemat — made by Fajar                    |

const FAJAR = 66n; // Root — in the root team only
const GITA = 67n; // the System Administrator — in the root team only
const DEWI = 64n; // owns Gudang Pusat and Toko Melati
const BUDI = 62n; // Gudang Pusat's Admin, Toko Melati's Admin

const meta = {
  title: "Pages/RootTeamBadge",
  parameters: { signedIn: true, dataRouter: true },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const DESKTOP = { viewport: { value: "desktop1440" } };
const PHONE = { viewport: { value: "mobile2" } };

/** Open the badge's sentence as the device does — a hover on a desktop, a tap on a phone — and return it. */
async function explainBadge(badge: HTMLElement): Promise<HTMLElement> {
  if (badge.tagName === "BUTTON") {
    await userEvent.click(badge);
  } else {
    await userEvent.hover(badge);
  }
  const hint = await screen.findByTestId("root-team-badge-hint", {}, { timeout: 3000 });
  await waitFor(() => expect(hint).toBeVisible());

  return hint;
}

/** The badge sits on `row` and on no other record of the screen; it reads "by Root team"; its sentence says who acted. */
async function badgeOnlyOn(scope: HTMLElement, row: HTMLElement, name: RegExp | string) {
  const badge = await within(row).findByTestId("root-team-badge", {}, { timeout: 4000 });
  await expect(row).toHaveTextContent(name);
  await expect(badge).toHaveTextContent("by Root team");
  await expect(within(scope).getAllByTestId("root-team-badge")).toHaveLength(1);

  const hint = await explainBadge(badge);
  await expect(hint).toHaveTextContent("Root or the System Administrator did this inside this team");
}

// ── The scenes ───────────────────────────────────────────────────────────────────────────────────────────────────────

// Order 101's confirm (timeline row 3) was Budi's; here Fajar confirmed it from outside Gudang Pusat.
const AtOrder101 = routedPage(
  [{ path: "/orders/:orderId", element: <OrderDetailPage /> }, marker("/orders", "at-order-list")],
  "/orders/101",
);
function orderScene() {
  asTeam(12n)();
  const log = orderDetailExtras["101"]!.timelineLogs!.find((l) => l.id === 3n)!;
  const before = { actorId: log.actorId, isOverride: log.isOverride };
  log.actorId = FAJAR;
  log.isOverride = true;

  return () => {
    log.actorId = before.actorId;
    log.isOverride = before.isOverride;
  };
}
async function orderTimeline(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const rail = await canvas.findByTestId("timeline-rail", {}, { timeout: 4000 });
  await waitFor(() => expect(rail).toHaveTextContent("Fajar Nugroho"), { timeout: 4000 });

  return rail;
}

// Shelf A-01-1's three receipts were the signed-in person's; Fajar received the sugar (movement 9001), an override.
const AtRack41 = routedPage(
  [{ path: "/inventories/racks/:rackId", element: <RackDetailPage /> }, marker("/inventories/racks", "at-rack-list")],
  "/inventories/racks/41",
);
function stockScene() {
  asTeam(11n)();
  asRole(Role.WAREHOUSE_STAFF)();
  rackHistoryRowByForStory(9001n, FAJAR, true);
}
async function stockHistory(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  // The rack page is one page of sections (hfrada's racks redesign): its history is drawn in place, no tab to open.
  const table = await canvas.findByTestId("rack-history-table", {}, { timeout: 4000 });
  await waitFor(() => expect(table).toHaveTextContent("Fajar Nugroho"), { timeout: 4000 });

  return table;
}

// Toko Melati's expenses: each names who recorded it — Budi and Dewi, and Gita for Electricity, from outside the team.
const AtExpenses = routedPage([{ path: "/expenses", element: <ExpensesPage /> }], "/expenses");
function expenseScene() {
  asTeam(12n)();
  asRole(Role.SELLING_OWNER)();
  expenseByForStory(
    { "480": BUDI, "481": BUDI, "501": BUDI, "502": DEWI, "503": GITA, "504": DEWI, "505": BUDI, "506": DEWI },
    [503n],
  );
}
async function expenses(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("expense-row-503", {}, { timeout: 4000 });

  return canvas.getByTestId("expenses-table");
}

// Entri Toko's manual system adjustment (7106) was Rina's; here Gita posted it, from outside the team.
const AtShopEntries = routedPage(
  [{ path: SHOP_ENTRIES_PATH, element: <SettlementShopEntriesPage /> }, marker("/settlement/imports/:fileId", "at-import")],
  SHOP_ENTRIES_PATH,
);
function settlementScene() {
  asTeam(12n)();
  asRole(Role.SELLING_OWNER)();
  withShopEntriesBook(
    shopEntriesBook().map((e) =>
      e.id === 7106n ? { ...e, actorId: GITA, actorName: "Gita Ramadhani", isOverride: true } : e,
    ),
  );
}
async function shopEntries(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const row = await canvas.findByTestId("shop-entry-7106", {}, { timeout: 4000 });
  await waitFor(() => expect(row).toHaveTextContent("Gita Ramadhani"), { timeout: 4000 });

  return canvas.getByTestId("shop-entries-table");
}

// Gudang Pusat's membership history — its served flag: Fajar removed a staff member two days ago.
const AtUsers = routedPage([{ path: "/users", element: <UsersPage /> }, marker("/users/:id", "at-user-detail")], "/users");
function memberScene() {
  asTeam(11n)();
  asRole(Role.WAREHOUSE_OWNER)();
}
async function memberLog(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByTestId("users-tab-history", {}, { timeout: 4000 }));
  const log = await canvas.findByTestId("member-log", {}, { timeout: 4000 });
  await waitFor(() => expect(log).toHaveTextContent(/fajar removed/i), { timeout: 4000 });

  return log;
}
const fajarsRow = (log: HTMLElement) =>
  within(log)
    .getAllByTestId(/^member-log-\d+$/)
    .find((row) => /fajar removed/i.test(row.textContent ?? ""))!;

// Gudang Pusat ↔ Toko Melati's limit log — its served flag on change 3. The fixture's actors are bare ids nobody
// resolves (#1, #2); the scene names them Dewi, and Fajar for the override.
const AtPair = routedPage(
  [{ path: "/liability/:counterpartyId", element: <LiabilityDetailPage /> }, marker("/liability", "at-liability-list")],
  "/liability/12",
);
function termsScene() {
  asTeam(11n)();
  asRole(Role.WAREHOUSE_OWNER)();
  const before = liabilityTermsChanges.map((c) => c.actorId);
  for (const c of liabilityTermsChanges) c.actorId = c.override ? FAJAR : DEWI;

  return () => {
    liabilityTermsChanges.forEach((c, i) => {
      c.actorId = before[i]!;
    });
  };
}
async function termsLog(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByTestId("liability-detail-tab-limits", {}, { timeout: 4000 }));
  const log = await canvas.findByTestId("terms-history-table", {}, { timeout: 4000 });
  await waitFor(() => expect(canvas.getByTestId("terms-change-3")).toHaveTextContent("Fajar Nugroho"), { timeout: 4000 });

  return log;
}

// Restock 502's trail: raised by its seller, signed for on arrival (row 2) by Fajar from outside the warehouse, edited.
const AtRestock502 = routedPage(
  [
    { path: "/inventories/restock/:requestId", element: <RestockSellingDetailPage /> },
    marker("/inventories/restock", "at-restock-list"),
  ],
  "/inventories/restock/502",
);
function restockScene() {
  asTeam(12n)();
  asRole(Role.SELLING_OWNER)();
  restockLogByForStory(502n, 2n, FAJAR, true);
}

// BCA Operasional's log: the transfer to BCA Gaji (1412) was moved by hand by Gita, from outside the team.
const AtBcaOps = routedPage(
  [{ path: "/financial-accounts/:accountId", element: <FinancialAccountDetailPage /> }],
  "/financial-accounts/1301",
);
function accountScene() {
  asTeam(12n)();
  asRole(Role.SELLING_ADMIN)();
  accountLogByForStory(1412n, GITA, true);
}

// Toko Melati's bundles: Paket Hemat made by Fajar from outside the team; the rest by its own people.
const HEMAT = bundleFixture("Paket Hemat");
function bundleScene() {
  asTeam(12n)();
  asRole(Role.SELLING_OWNER)();
  bundleCreatedByForStory(HEMAT.id, FAJAR, true);
}

// ── The stories ──────────────────────────────────────────────────────────────────────────────────────────────────────

// THE ORDER TIMELINE: the confirm row names Fajar with the badge; the seller's own placement names Ani, plain.
export const OrderTimeline: Story = {
  globals: DESKTOP,
  render: () => <AtOrder101 />,
  beforeEach: orderScene,
  play: async ({ canvasElement }) => {
    const rail = await orderTimeline(canvasElement);
    await expect(within(rail).getByTestId("order-timeline-pending")).toHaveTextContent("Ani Rahayu");
    await expect(within(within(rail).getByTestId("order-timeline-pending")).queryByTestId("root-team-badge")).toBeNull();
    await badgeOnlyOn(rail, within(rail).getByTestId("order-timeline-processed"), "Fajar Nugroho");
  },
};

export const OrderTimelinePhone: Story = {
  globals: PHONE,
  render: () => <AtOrder101 />,
  beforeEach: orderScene,
  play: async ({ canvasElement }) => {
    const rail = await orderTimeline(canvasElement);
    await badgeOnlyOn(rail, within(rail).getByTestId("order-timeline-processed"), "Fajar Nugroho");
  },
};

// A STOCK HISTORY — the one stock ledger (MovementTable), so every ledger that has a By column carries it.
export const StockHistory: Story = {
  globals: DESKTOP,
  render: () => <AtRack41 />,
  beforeEach: stockScene,
  play: async ({ canvasElement }) => {
    const table = await stockHistory(canvasElement);
    await badgeOnlyOn(table, within(table).getByTestId("rack-history-row-9001"), "Fajar Nugroho");
  },
};

// AN EXPENSE — the Recorded by column names each row's person; Gita's carries the badge, Dewi's does not.
export const Expenses: Story = {
  globals: DESKTOP,
  render: () => <AtExpenses />,
  beforeEach: expenseScene,
  play: async ({ canvasElement }) => {
    const table = await expenses(canvasElement);
    await waitFor(() => expect(within(table).getByTestId("expense-by-503")).toHaveTextContent("Gita Ramadhani"));
    await expect(within(table).getByTestId("expense-by-502")).toHaveTextContent("Dewi Lestari");
    await expect(within(within(table).getByTestId("expense-by-502")).queryByTestId("root-team-badge")).toBeNull();
    await badgeOnlyOn(table, within(table).getByTestId("expense-row-503"), "Gita Ramadhani");
  },
};

// On a phone the person is a line under the expense, and the badge's sentence opens on a tap.
export const ExpensesPhone: Story = {
  globals: PHONE,
  render: () => <AtExpenses />,
  beforeEach: expenseScene,
  play: async ({ canvasElement }) => {
    const table = await expenses(canvasElement);
    await waitFor(() => expect(within(table).getByTestId("expense-by-503")).toHaveTextContent("Gita Ramadhani"));
    await badgeOnlyOn(table, within(table).getByTestId("expense-row-503"), "Gita Ramadhani");
  },
};

// A SETTLEMENT ROW — Entri Toko's manual row, "by Gita Ramadhani", badged; the imported rows name their uploader, plain.
export const SettlementEntries: Story = {
  globals: DESKTOP,
  render: () => <AtShopEntries />,
  beforeEach: settlementScene,
  play: async ({ canvasElement }) => {
    const table = await shopEntries(canvasElement);
    await badgeOnlyOn(table, within(table).getByTestId("shop-entry-7106"), "Gita Ramadhani");
  },
};

export const SettlementEntriesPhone: Story = {
  globals: PHONE,
  render: () => <AtShopEntries />,
  beforeEach: settlementScene,
  play: async ({ canvasElement }) => {
    const table = await shopEntries(canvasElement);
    await badgeOnlyOn(table, within(table).getByTestId("shop-entry-7106"), "Gita Ramadhani");
  },
};

// THE MEMBER LOG draws the shared badge: Fajar's removal carries it, and the log's old "override" word is gone.
export const MemberLog: Story = {
  globals: DESKTOP,
  render: () => <AtUsers />,
  beforeEach: memberScene,
  play: async ({ canvasElement }) => {
    const log = await memberLog(canvasElement);
    await expect(within(log).queryByText("override")).toBeNull();
    await badgeOnlyOn(log, fajarsRow(log), /fajar removed/i);
  },
};

// THE TEAM BALANCE LIMIT LOG draws it too: change 3 names Fajar with the shared badge; the purple Override is gone.
export const TermsLog: Story = {
  globals: DESKTOP,
  render: () => <AtPair />,
  beforeEach: termsScene,
  play: async ({ canvasElement }) => {
    const log = await termsLog(canvasElement);
    await expect(within(canvasElement).queryByTestId("terms-override-3")).toBeNull();
    await badgeOnlyOn(log, within(log).getByTestId("terms-change-3"), "Fajar Nugroho");
  },
};

export const TermsLogPhone: Story = {
  globals: PHONE,
  render: () => <AtPair />,
  beforeEach: termsScene,
  play: async ({ canvasElement }) => {
    const log = await termsLog(canvasElement);
    await badgeOnlyOn(log, within(log).getByTestId("terms-change-3"), "Fajar Nugroho");
  },
};

// A RESTOCK'S TIMELINE: the arrival Fajar signed for from outside the warehouse is badged; the seller's own rows are not.
export const RestockTimeline: Story = {
  globals: DESKTOP,
  render: () => <AtRestock502 />,
  beforeEach: restockScene,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The restock page is one page of sections: the timeline is drawn in place, no tab to open.
    await canvas.findByTestId("restock-detail-page", {}, { timeout: 4000 });
    const trail = await canvas.findByTestId("restock-timeline-2", {}, { timeout: 4000 });
    await waitFor(() => expect(trail).toHaveTextContent("Fajar Nugroho"), { timeout: 4000 });
    await badgeOnlyOn(canvasElement, trail, "Fajar Nugroho");
  },
};

// AN ACCOUNT'S LOG: "by hand · Gita Ramadhani" on the transfer, badged; the automatic rows name nobody and carry none.
export const AccountLog: Story = {
  globals: DESKTOP,
  render: () => <AtBcaOps />,
  beforeEach: accountScene,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = await canvas.findByTestId("account-log-table", {}, { timeout: 4000 });
    const way = await canvas.findByTestId("account-log-way-1412", {}, { timeout: 4000 });
    await waitFor(() => expect(way).toHaveTextContent("Gita Ramadhani"), { timeout: 4000 });
    await expect(within(canvas.getByTestId("account-log-way-1409")).queryByTestId("root-team-badge")).toBeNull();
    await badgeOnlyOn(table, way, "Gita Ramadhani");
  },
};

// THE BUNDLES LIST's Created by: Paket Hemat names Fajar with the badge; the team's own bundles name their maker, plain.
export const Bundles: Story = {
  globals: DESKTOP,
  render: () => <BundlesPage />,
  parameters: { dataRouter: false },
  beforeEach: bundleScene,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = await canvas.findByTestId("bundles-table", {}, { timeout: 4000 });
    const creator = await canvas.findByTestId(`bundle-row-${HEMAT.id}-creator`, {}, { timeout: 4000 });
    await waitFor(() => expect(creator).toHaveTextContent("Fajar Nugroho"), { timeout: 4000 });
    await badgeOnlyOn(table, creator, "Fajar Nugroho");
  },
};

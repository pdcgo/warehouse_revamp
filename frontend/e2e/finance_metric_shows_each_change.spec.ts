import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { addMetric, asRoot, rupiah, signInAs, today } from "./metric_ground";
import { importThroughDialog } from "./settlement_import_helpers";
import { SHOPEE_WITHDRAWAL, shopeeStatement } from "./settlement_statements";

// ── add analytic metric, the finance metrics — the checks behind docs/acceptances/analytic/finance_metric.md ─────────────
//
// add analytic metric's checks for the two FINANCE metrics on Analytic › Finance — *Account changes*
// (metrics/financial_accounts: the opening balance, one signed column per change type, the net change and the closing
// balance) and *Change types* (metrics/financial_accounts/types: the same money, one row per type). An acceptance has no
// test file of its own (docs/acceptances/guide.md): one test.describe per given + when (named as the given, its case in
// parentheses VERBATIM), per role a test — selling:all = owner, admin, cs; warehouse:all = owner, admin, staff — and one
// test.step("then: …") per then, stored verbatim (acceptance_mark.py matches the literal text). A step that is no then is
// named `regression: …`. finance_metrics.spec.ts is the metrics' own regression spec (the RPCs, the account filter, the
// report on the same reads); this one is the acceptance, as each role does it.
//
// Business rules (docs/business/analytic/rpc_provide_decision.md):
// - financial-accounts-serve-their-changes-and-their-types — Account changes: `opening_balance` / `closing_balance` are
//   POSITIONS, one money field per change type (expense, ads_expense, adjustment, withdrawal, restock, account_opening,
//   transfer, team_payment, capital, money_in), `change` the net; Change types: `amount`, grouped by change type.
// - the-balance-series-is-a-running-sum — a day opens where the one before closed.
// - every-team-reads-its-own-finance — a selling team and a warehouse each read their own accounts (a warehouse role
//   reads every field: none is warehouse-hidden).
// - Money in is positive, money out negative (the acceptance file's header): Analytic writes a negative with the
//   typographic minus before Rp (−Rp 300.000) and a positive bare (Rp 1.000.000) — so a then's "+Rp …" reads "Rp …".
//
// GROUND (beforeAll, as root, through the API from the test runner): per given a team of its own with a user per role
// the given names, so each team's figures are exactly that given's. Its accounts open 10 days ago (outside the 7-day
// window, so the window opens on their balance) unless the given is the opening itself; every paying account is set
// operational (a restock is paid only from one). The restocks go to warehouse W13 (given 13's), whose own accounts they
// never touch. The money posted by a LISTENER (an expense, a restock and its edits, a withdrawal, a team payment) is
// waited for in beforeAll through MetricData, so a role's read is the settled figure:
//   1   S1: bank opens with Rp 1.000.000, today an expense of Rp 300.000 from it. W1 (a warehouse): cash opens with
//       Rp 1.000.000, today Rp 300.000 taken out of it (FinancialAccountCapital OUT — a warehouse records no expense).
//   2   S2: today an expense of Rp 200.000 (electricity) from bank.
//   3   S3: today an ads expense of Rp 150.000 (content / endorse, the Iklan group) from bank.
//   4   S4: bank holds Rp 5.000.000; today it is reconciled at Rp 4.990.000 (Rp 10.000 short).
//   5   S5: a Shopee shop that names bank as the account it withdraws into (FinancialAccountShopSet); a statement with
//       one completed Penarikan Dana of Rp 1.000.000 imported through Penyelesaian › Impor by S5's owner.
//   6   S6: a restock of Rp 300.000 paid from bank.
//   7   S7: per role a bank of its own and a restock of Rp 300.000 paid from it; the role's test raises its shipping
//       cost by Rp 50.000 (RestockRequestUpdate).
//   8   S8: per role a bank A and a bank B of its own and a restock of Rp 300.000 paid from A; the role's test moves the
//       payment to B (RestockRequestUpdate's account).
//   9   S9: per role a bank of its own and a restock of Rp 300.000 paid from it; the role's test cancels it, the money
//       returned (RestockRequestCancel moneyReturned).
//   10  S10: an account opened today with Rp 1.000.000.
//   11  S11: bank (Rp 1.000.000) and a ShopeePay wallet; today Rp 100.000 transferred from bank to ShopeePay.
//   12  S12 (also given 15's): bank opened the day before this month; a restock of Rp 300.000 paid from bank to W13,
//       accepted with a Rp 500.000 courier charge paid at the door (S12 now owes W13 Rp 500.000, *Restock Accepted*
//       pushed to liability as the broker would); S12 records a payment of Rp 500.000 from bank, W13 accepts it into its
//       cash (*Liability Payment Accepted* pushed to the accounts as the broker would); today an expense of Rp 200.000.
//   13  W13: the warehouse that accepted S12's payment — its cash takes the Rp 500.000.
//   14  S14: today the owner adds Rp 2.000.000 of capital to bank (FinancialAccountCapital IN — capital recorded on the
//       account itself, the file's note).
//
// A DAY CANNOT BE BACK-DATED: a restock is paid the moment it is raised (no RPC dates its payment), so the restock that
// givens 7–9 change was raised on the run day too. Their thens name the CHANGE's own figure ("−Rp 50.000 on the edit
// day", "+Rp 300.000 on the cancel day", "+Rp 300.000 on bank A"): each role reads its account BEFORE the change, root
// makes the given's change, then the role adds the metric and reads again — the then holds when the difference is the
// change (the pattern of inventory_metric_shows_the_restock_before_the_accept.spec.ts givens 10 and 13). Givens 7 and 9
// read the window of the edit / cancel day alone (today..today).
//
// THE WHEN, as the person does it: Analytic over the last 7 days (given 15: this month), grouped as the given says
// (daily, by account, by change type), then Add Metric › Finance › Account changes (given 15: Change types), Done.

const DIGITS = Date.now().toString().slice(-6);
// This spec's own letter: usernames, names and account numbers carry it, so no other spec collides.
const SUFFIX = `${DIGITS}m`;
const PASSWORD = "e2e-finance-metric-pass-1";
const CHANGES = "metrics/financial_accounts";
const TYPES = "metrics/financial_accounts/types";

const SELLING = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "so" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sa" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "sc" },
] as const;
const WAREHOUSE = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wo" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wa" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "ws" },
] as const;
type Role = (typeof SELLING)[number] | (typeof WAREHOUSE)[number];

// The givens' cases, VERBATIM (· is U+00B7, − is U+2212), and their thens.
const G1 = {
  case: "group: daily · add type: account changes · opening Rp 1.000.000 · Rp 300.000 out today",
  thenNet: "then: net change −Rp 300.000",
  thenClosing: "then: closing balance Rp 700.000",
};
const G2 = { case: "group: account · add type: account changes · expense Rp 200.000 from bank", then: "then: expense −Rp 200.000 on bank" };
const G3 = {
  case: "group: account · add type: account changes · ads expense Rp 150.000 from bank",
  then: "then: ads expense −Rp 150.000 on bank",
};
const G4 = {
  case: "group: account · add type: account changes · reconcile finds bank Rp 10.000 short",
  then: "then: adjustment −Rp 10.000 on bank",
};
const G5 = {
  case: "group: account · add type: account changes · withdrawal of Rp 1.000.000 imported",
  then: "then: withdrawal +Rp 1.000.000 on the shop's account",
};
const G6 = { case: "group: account · add type: account changes · restock Rp 300.000 paid from bank", then: "then: restock −Rp 300.000 on bank" };
const G7 = {
  case: "group: account · add type: account changes · restock shipping cost raised Rp 50.000",
  then: "then: restock −Rp 50.000 on the edit day",
};
const G8 = {
  case: "group: account · add type: account changes · restock Rp 300.000 payment moved from bank A to bank B",
  then: "then: restock +Rp 300.000 on bank A, −Rp 300.000 on bank B",
};
const G9 = { case: "group: account · add type: account changes · restock Rp 300.000 cancelled", then: "then: restock +Rp 300.000 on the cancel day" };
const G10 = {
  case: "group: account · add type: account changes · new account opened with Rp 1.000.000",
  then: "then: account opened +Rp 1.000.000",
};
const G11 = {
  case: "group: account · add type: account changes · Rp 100.000 transferred from bank to ShopeePay",
  thenLegs: "then: transfer −Rp 100.000 on bank, +Rp 100.000 on ShopeePay",
  thenTotal: "then: team's transfer total 0",
};
const G12 = {
  case: "group: account · add type: account changes · payment Rp 500.000 accepted by the warehouse",
  then: "then: team payment −Rp 500.000 on the paying account",
};
const G13 = {
  case: "group: account · add type: account changes · payment Rp 500.000 accepted",
  then: "then: team payment +Rp 500.000 on the receiving account",
};
const G14 = { case: "group: account · add type: account changes · owner adds capital Rp 2.000.000", then: "then: capital +Rp 2.000.000" };
const G15 = {
  case: "group: change type · add type: change types · expense, restock and team payment this month",
  then: "then: one row per change type with its amount",
};

const OPENING = 1_000_000;
const BIG = 5_000_000;
const OUT = 300_000;
const EXPENSE = 200_000;
const ADS = 150_000;
const SHORT = 10_000;
const WITHDRAWAL = 1_000_000;
const RESTOCK = 300_000;
const SHIPPING = 50_000;
const TRANSFER = 100_000;
const PAYMENT = 500_000;
const CAPITAL = 2_000_000;
// The change types' numbers (FinancialAccountChangeType) — a row's key when a table is grouped by change type.
const TYPE_EXPENSE = "1";
const TYPE_RESTOCK = "5";
const TYPE_TEAM_PAYMENT = "8";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** A Jakarta day `ago` days before today. */
const day = (ago: number) =>
  new Date(Date.now() - ago * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
/** This month's first day, and the day before it (a day no figure of this month's window holds). */
const monthStart = () => `${today().slice(0, 8)}01`;
const beforeMonth = () =>
  new Date(Date.parse(`${monthStart()}T00:00:00+07:00`) - 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// A figure as Analytic writes it: a negative carries the typographic minus before Rp.
const money = (n: number) => (n < 0 ? `−${rupiah(-n)}` : rupiah(n));
// A figure read back off the screen ("−Rp 300.000" → −300000).
const valueOf = (text: string | null) => {
  const t = (text ?? "").trim();
  const n = Number(t.replace(/[^0-9]/g, ""));
  return t.startsWith("−") ? -n : n;
};
// proto3 JSON leaves a zero out — read it as 0; an int64 arrives as a string.
const num = (v: unknown) => Number(v ?? 0);

const username = (g: number, key: string) => `e2efm${g}${key}${SUFFIX}`;

interface Raised {
  id: string;
  itemId: string;
  product: string;
  productCode: string;
  name: string;
}

const ground = {
  teams: {} as Record<string, string>, // "1".."14" a selling team; "w1", "w13" a warehouse
  // `<given>` or `<given>-<role key>` (or `<given>-<role key>-b` for given 8's bank B) → account id
  accounts: {} as Record<string, string>,
  restocks: {} as Record<string, Raised>,
  users: {} as Record<string, string>, // username → user id
  shop5: "",
  rack: "",
  category: "",
};

async function team(g: number, side: "S" | "W"): Promise<string> {
  const type = side === "S" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE";
  const id = String(
    (
      await asRoot("team.v1.TeamService/TeamCreate", {
        name: `E2E Finance Metric ${side}${g} ${SUFFIX}`,
        teamCode: `N${g}${side}${DIGITS}`,
        type,
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  for (const r of side === "S" ? SELLING : WAREHOUSE) {
    const made = await asRoot("user.v1.UserService/CreateUser", {
      teamId: id,
      username: username(g, r.key),
      password: PASSWORD,
      name: `Finance Metric ${g} ${r.key} ${SUFFIX}`,
      role: r.role,
    });
    ground.users[username(g, r.key)] = String(made.user.id);
  }

  return id;
}

const KIND = {
  bank: { type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT", provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA" },
  wallet: { type: "FINANCIAL_ACCOUNT_TYPE_WALLET", provider: "FINANCIAL_ACCOUNT_PROVIDER_SHOPEEPAY" },
  cash: { type: "FINANCIAL_ACCOUNT_TYPE_CASH", provider: "FINANCIAL_ACCOUNT_PROVIDER_CASH" },
} as const;

/** An account of the team's — the name says the given and its tag; a bank or cash one is set operational. */
async function account(teamId: string, tag: string, opening: number, openingOn: string, kind: keyof typeof KIND = "bank") {
  const id = String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId,
        ...KIND[kind],
        name: `E2E FM ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: kind === "cash" ? "" : `E2E-FM-${tag}-${SUFFIX}`,
        openingBalance: opening,
        openingOn,
      })
    ).account.id,
  );
  if (kind !== "wallet") {
    await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId, accountId: id, operational: true });
  }

  return id;
}

async function expense(teamId: string, accountId: string, kind: string, type: string, amount: number) {
  await asRoot("expense.v1.ExpenseService/ExpenseCreate", {
    teamId,
    kind,
    type,
    amount,
    occurredAt: today(),
    note: `E2E finance metric ${SUFFIX}`,
    financeAccountId: accountId,
  });
}

/** A product of the team's and its restock of 10 units for Rp 300.000 at W13, paid from `accountId` — raised now. */
async function raise(teamId: string, accountId: string, tag: string): Promise<Raised> {
  const name = `Sabun Keuangan ${tag} ${SUFFIX}`;
  const product = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId,
      productCodePart: `FM${tag.replace(/-/g, "").toUpperCase()}${DIGITS}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  const made = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId,
    warehouseId: ground.teams.w13,
    financeAccountId: accountId,
    items: [{ productId: product.id, productCode: product.productCode, name, count: 10, total: RESTOCK }],
  });

  return {
    id: String(made.request.id),
    itemId: String(made.request.items[0].id),
    product: String(product.id),
    productCode: String(product.productCode),
    name,
  };
}

/** The restock's line as RestockRequestUpdate takes it back — unchanged. */
const lineOf = (r: Raised) => [{ id: r.itemId, productId: r.product, productCode: r.productCode, name: r.name, count: 10, total: RESTOCK }];

/** An event as the broker pushes it to `subscription`'s endpoint. */
async function push(subscription: string, eventType: string, event: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/event/${subscription}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        data: Buffer.from(JSON.stringify(event)).toString("base64"),
        attributes: { event_type: eventType },
        messageId: `${String(event.eventId)}-${Date.now()}`,
      },
      subscription: `projects/warehouse-dev/subscriptions/${subscription}`,
    }),
  });
  expect(res.status, `push ${subscription}: ${await res.text()}`).toBe(200);
}

/** The payer's proof, uploaded and shared with the creditor (a-payment-must-carry-proof). */
async function proof(ownerTeam: string, shareWith: string): Promise<string> {
  const bytes = Buffer.from(PNG, "base64");
  const requested = await asRoot("document.v1.DocumentService/RequestUpload", {
    teamId: ownerTeam,
    filename: "transfer.png",
    contentType: "image/png",
    sizeBytes: String(bytes.length),
    resourceType: "DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF",
  });
  const put = await fetch(requested.uploadUrl, { method: requested.method, headers: requested.headers ?? {}, body: bytes });
  expect(put.status).toBeLessThan(300);
  const confirmed = await asRoot("document.v1.DocumentService/ConfirmUpload", { uploadToken: requested.uploadToken });
  await asRoot("document.v1.DocumentService/ShareDocument", { teamId: ownerTeam, documentId: confirmed.document.id, withTeamId: shareWith });

  return String(confirmed.document.id);
}

/** Account changes by account, as root — each asked account's figures over [from, to]. */
async function byAccount(teamId: string, ids: string[], from = day(6), to = today()) {
  const res = await asRoot("financial_account.v1.FinancialAccountAnalyticService/MetricData", {
    teamId,
    groupBy: "GROUP_TYPE_ACCOUNT",
    filters: [{ dateRangeFilter: { dateMin: from, dateMax: to } }],
    keys: { ids: { ids } },
    metricIds: [CHANGES],
  });

  return (res.metricDatas?.[0]?.changesById?.items ?? {}) as Record<string, Record<string, unknown>>;
}

/** One field of one account this week, as root — for the waits on a listener's posting. */
const figure = async (teamId: string, accountId: string, field: string) => num((await byAccount(teamId, [accountId]))[accountId]?.[field]);

async function seed(browser: Browser) {
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Finance Metric ${SUFFIX}` })).category.id);

  // W13 first: every restock below goes to it.
  ground.teams.w13 = await team(13, "W");
  ground.accounts["13"] = await account(ground.teams.w13, "13", OPENING, day(10), "cash");
  ground.rack = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: ground.teams.w13, code: `fm-${DIGITS}` })).rack.id);

  // GIVEN 1 — a selling team and a warehouse, each opening at Rp 1.000.000 and Rp 300.000 out today.
  ground.teams["1"] = await team(1, "S");
  ground.accounts["1"] = await account(ground.teams["1"], "1", OPENING, day(10));
  await expense(ground.teams["1"], ground.accounts["1"], "EXPENSE_KIND_OPERATIONAL", "EXPENSE_TYPE_ELECTRICITY", OUT);
  ground.teams.w1 = await team(1, "W");
  ground.accounts.w1 = await account(ground.teams.w1, "1W", OPENING, day(10), "cash");
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCapital", {
    teamId: ground.teams.w1,
    accountId: ground.accounts.w1,
    direction: "CAPITAL_DIRECTION_OUT",
    amount: OUT,
    occurredOn: today(),
    note: `E2E money out ${SUFFIX}`,
  });

  // GIVEN 2 — an expense from bank; GIVEN 3 — an ads expense from bank.
  ground.teams["2"] = await team(2, "S");
  ground.accounts["2"] = await account(ground.teams["2"], "2", BIG, day(10));
  await expense(ground.teams["2"], ground.accounts["2"], "EXPENSE_KIND_OPERATIONAL", "EXPENSE_TYPE_ELECTRICITY", EXPENSE);
  ground.teams["3"] = await team(3, "S");
  ground.accounts["3"] = await account(ground.teams["3"], "3", BIG, day(10));
  await expense(ground.teams["3"], ground.accounts["3"], "EXPENSE_KIND_ADS", "EXPENSE_TYPE_CONTENT_ENDORSE", ADS);

  // GIVEN 4 — bank reconciled today at Rp 10.000 under what it holds.
  ground.teams["4"] = await team(4, "S");
  ground.accounts["4"] = await account(ground.teams["4"], "4", BIG, day(10));
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountReconcile", {
    teamId: ground.teams["4"],
    accountId: ground.accounts["4"],
    actualBalance: BIG - SHORT,
    asOf: today(),
    note: `E2E counted short ${SUFFIX}`,
  });

  // GIVEN 5 — a shop that withdraws into bank; a statement with its withdrawal imported by the team's owner.
  ground.teams["5"] = await team(5, "S");
  ground.accounts["5"] = await account(ground.teams["5"], "5", OPENING, day(10));
  ground.shop5 = String(
    (
      await asRoot("selling.v1.ShopService/ShopCreate", {
        teamId: ground.teams["5"],
        name: `E2E Finance Metric Shop ${SUFFIX}`,
        shopCode: `FM5${DIGITS}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  // Root first (the first grant is the shop's primary CS), then the owner who imports.
  await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: ground.teams["5"], shopId: ground.shop5, userId: ROOT_USER_ID });
  await asRoot("selling.v1.ShopService/ShopUserAdd", {
    teamId: ground.teams["5"],
    shopId: ground.shop5,
    userId: ground.users[username(5, "so")],
  });
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountShopSet", {
    teamId: ground.teams["5"],
    shopId: ground.shop5,
    accountId: ground.accounts["5"],
  });
  const importer = await browser.newPage();
  await signInAs(importer, username(5, "so"), PASSWORD, ground.teams["5"]);
  const dialog = await importThroughDialog(
    importer,
    ground.shop5,
    shopeeStatement([{ kind: SHOPEE_WITHDRAWAL, description: `Penarikan Dana E2E FM ${SUFFIX}`, amount: -WITHDRAWAL }]),
  );
  await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByTestId("tally-posted-value")).toHaveText("1");
  await importer.close();

  // GIVEN 6 — a restock paid from bank.
  ground.teams["6"] = await team(6, "S");
  ground.accounts["6"] = await account(ground.teams["6"], "6", BIG, day(10));
  ground.restocks["6"] = await raise(ground.teams["6"], ground.accounts["6"], "6");

  // GIVENS 7–9 — per role its own bank (given 8: bank A and bank B) and a restock paid from it; the change is the role's test's.
  for (const g of [7, 8, 9]) {
    ground.teams[String(g)] = await team(g, "S");
    for (const r of SELLING) {
      const at = `${g}-${r.key}`;
      ground.accounts[at] = await account(ground.teams[String(g)], at, BIG, day(10));
      if (g === 8) ground.accounts[`${at}-b`] = await account(ground.teams[String(g)], `${at}-b`, OPENING, day(10));
      ground.restocks[at] = await raise(ground.teams[String(g)], ground.accounts[at], at);
    }
  }

  // GIVEN 10 — an account opened today; GIVEN 11 — bank → ShopeePay; GIVEN 14 — the owner's capital in.
  ground.teams["10"] = await team(10, "S");
  ground.accounts["10"] = await account(ground.teams["10"], "10", OPENING, today());
  ground.teams["11"] = await team(11, "S");
  ground.accounts["11"] = await account(ground.teams["11"], "11", OPENING, day(10));
  ground.accounts["11-pay"] = await account(ground.teams["11"], "11-pay", OPENING, day(10), "wallet");
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountTransfer", {
    teamId: ground.teams["11"],
    fromAccountId: ground.accounts["11"],
    toAccountId: ground.accounts["11-pay"],
    amount: TRANSFER,
    occurredOn: today(),
    note: `E2E top-up ${SUFFIX}`,
  });
  ground.teams["14"] = await team(14, "S");
  ground.accounts["14"] = await account(ground.teams["14"], "14", OPENING, day(10));
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCapital", {
    teamId: ground.teams["14"],
    accountId: ground.accounts["14"],
    direction: "CAPITAL_DIRECTION_IN",
    amount: CAPITAL,
    occurredOn: today(),
    note: `E2E owner's capital ${SUFFIX}`,
  });

  // GIVENS 12, 13, 15 — S12 restocks at W13, owes it the courier's Rp 500.000, pays it, and W13 accepts; an expense too.
  const s12 = (ground.teams["12"] = await team(12, "S"));
  const bank12 = (ground.accounts["12"] = await account(s12, "12", BIG, beforeMonth()));
  const r12 = (ground.restocks["12"] = await raise(s12, bank12, "12"));
  const accepted = await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.teams.w13,
    requestId: r12.id,
    warehouseAdditionalCost: PAYMENT,
    warehouseAdditionalCostNote: `courier asked at the door ${SUFFIX}`,
    lines: [{ itemId: r12.itemId, receivedCount: 10, placements: [{ placementId: ground.rack, quantity: 10 }] }],
  });
  const a = accepted.request;
  const acceptedAt = new Date(Number(a.acceptedAtUnix) * 1000);
  await push("liability-restock-accepted", "warehouse.events.v1.RestockAccepted", {
    eventId: `restock-accepted:${a.id}`,
    occurredAt: acceptedAt.toISOString(),
    aggregateId: `restock:${a.id}`,
    restockAccepted: {
      restockId: a.id,
      teamId: a.requestingTeamId,
      warehouseId: a.warehouseId,
      acceptedOn: acceptedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      acceptedAtUnix: a.acceptedAtUnix,
      warehouseAdditionalCost: a.warehouseAdditionalCost,
      warehouseAdditionalCostNote: a.warehouseAdditionalCostNote,
      actorId: a.acceptedByUserId,
    },
  });
  await expect
    .poll(async () => num((await asRoot("liability.v1.LiabilityService/LiabilityPositionList", { teamId: s12, page: { page: 1, limit: 50 } })).totalPayable), {
      timeout: 30_000,
      message: "S12 owes W13 the courier's charge",
    })
    .toBe(PAYMENT);
  const recorded = await asRoot("liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
    teamId: s12,
    creditorTeamId: ground.teams.w13,
    amount: String(PAYMENT),
    note: `E2E paying the courier ${SUFFIX}`,
    documentIds: [await proof(s12, ground.teams.w13)],
    fromAccountId: bank12,
  });
  const confirmed = await asRoot("liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
    teamId: ground.teams.w13,
    paymentId: recorded.payment.id,
    toAccountId: ground.accounts["13"],
  });
  const p = confirmed.payment;
  await push("financial-account-team-payment", "warehouse.events.v1.LiabilityPaymentAccepted", {
    eventId: `liability-payment-accepted:${p.id}`,
    occurredAt: new Date(Number(p.confirmedAtUnix) * 1000).toISOString(),
    aggregateId: `liability-payment:${p.id}`,
    liabilityPaymentAccepted: {
      paymentId: p.id,
      payerTeamId: p.payerTeamId,
      creditorTeamId: p.creditorTeamId,
      amount: p.amount,
      fromAccountId: p.fromAccountId,
      toAccountId: p.toAccountId,
      actorId: p.confirmedBy,
    },
  });
  await expense(s12, bank12, "EXPENSE_KIND_OPERATIONAL", "EXPENSE_TYPE_ELECTRICITY", EXPENSE);

  // The money a listener posts, waited for: every role then reads the settled figure.
  const waits: [string, () => Promise<number>, number][] = [
    ["1 S expense", () => figure(ground.teams["1"], ground.accounts["1"], "expense"), -OUT],
    ["2 expense", () => figure(ground.teams["2"], ground.accounts["2"], "expense"), -EXPENSE],
    ["3 ads expense", () => figure(ground.teams["3"], ground.accounts["3"], "adsExpense"), -ADS],
    ["5 withdrawal", () => figure(ground.teams["5"], ground.accounts["5"], "withdrawal"), WITHDRAWAL],
    ["6 restock", () => figure(ground.teams["6"], ground.accounts["6"], "restock"), -RESTOCK],
    ...[7, 8, 9].flatMap((g) =>
      SELLING.map(
        (r): [string, () => Promise<number>, number] => [
          `${g}-${r.key} restock`,
          () => figure(ground.teams[String(g)], ground.accounts[`${g}-${r.key}`], "restock"),
          -RESTOCK,
        ],
      ),
    ),
    ["12 restock", () => figure(s12, bank12, "restock"), -RESTOCK],
    ["12 expense", () => figure(s12, bank12, "expense"), -EXPENSE],
    ["12 team payment", () => figure(s12, bank12, "teamPayment"), -PAYMENT],
    ["13 team payment", () => figure(ground.teams.w13, ground.accounts["13"], "teamPayment"), PAYMENT],
  ];
  for (const [what, read, want] of waits) {
    await expect.poll(read, { timeout: 60_000, message: `given ${what} posted` }).toBe(want);
  }
}

/** Signed in as the role, working in `teamId`. */
async function sign(page: Page, g: number, r: Role, teamId: string) {
  await signInAs(page, username(g, r.key), PASSWORD, teamId);
}

/** THE WHEN — Analytic grouped and ranged by `query`, then Add Metric › Finance › `metric`, Done. */
async function when(page: Page, g: number, r: Role, query: string, metric = CHANGES) {
  await page.goto(`/analytic?${query}`);
  await expect(page.getByTestId("current-user")).toHaveText(username(g, r.key));
  await addMetric(page, "finance", metric);
}

const cell = (page: Page, key: string, field: string) => page.getByTestId(`analytic-cell-${key}-${field}`);

/** The page (its address carries the metric) re-read until `key`'s `field` reads `want` — then its figure. */
async function reads(page: Page, key: string, field: string, want: string): Promise<number> {
  await expect(async () => {
    await page.reload();
    await expect(cell(page, key, field)).toHaveText(want, { timeout: 3_000 });
  }).toPass({ timeout: 40_000 });

  return valueOf(await cell(page, key, field).textContent());
}

/** BEFORE the change: Account changes by account over `range`, read as the role, until `key`'s `field` reads `want`. */
async function before(page: Page, g: number, r: Role, range: string, key: string, field: string, want: string): Promise<number> {
  await page.goto(`/analytic?g=account&m=${CHANGES}&r=${range}`);
  await expect(page.getByTestId("current-user")).toHaveText(username(g, r.key));

  return reads(page, key, field, want);
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(360_000);
  await seed(browser);
});

// ── 1 · opening Rp 1.000.000 · Rp 300.000 out today, by day ──────────────────────────────────────────────────────────

test.describe(`selling:all · warehouse:all wants to see statistics (${G1.case})`, () => {
  for (const r of [...SELLING, ...WAREHOUSE]) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const d = today();
      const warehouse = r.key.startsWith("w");
      await sign(page, 1, r, warehouse ? ground.teams.w1 : ground.teams["1"]);
      await when(page, 1, r, "g=daily&r=7d");

      await test.step("regression: today opens on the Rp 1.000.000 the day before closed on", async () => {
        await expect.soft(cell(page, d, "opening_balance")).toHaveText(money(OPENING));
        await expect.soft(cell(page, day(1), "closing_balance")).toHaveText(money(OPENING));
      });
      await test.step(G1.thenNet, async () => {
        await expect.soft(cell(page, d, "change")).toHaveText(money(-OUT));
        await expect.soft(page.getByTestId("analytic-sort-change")).toHaveText("Net change");
      });
      await test.step(G1.thenClosing, async () => {
        await expect.soft(cell(page, d, "closing_balance")).toHaveText(money(OPENING - OUT));
        // The whole window closes there too: nothing else moved the team's money this week.
        await expect.soft(page.getByTestId("analytic-headline-closing_balance-value")).toHaveText(money(OPENING - OUT));
      });
    });
  }
});

// ── 2–6, 10, 14 · one change on one account, by account ─────────────────────────────────────────────────────────────

const ONE_CHANGE = [
  { g: 2, given: G2, field: "expense", label: "Expense", want: -EXPENSE },
  { g: 3, given: G3, field: "ads_expense", label: "Ads", want: -ADS },
  { g: 4, given: G4, field: "adjustment", label: "Adjustment", want: -SHORT },
  { g: 5, given: G5, field: "withdrawal", label: "Withdrawal", want: WITHDRAWAL },
  { g: 6, given: G6, field: "restock", label: "Restock", want: -RESTOCK },
  { g: 10, given: G10, field: "account_opening", label: "Account opened", want: OPENING },
  { g: 14, given: G14, field: "capital", label: "Capital", want: CAPITAL },
] as const;

for (const c of ONE_CHANGE) {
  test.describe(`selling:all wants to see statistics (${c.given.case})`, () => {
    for (const r of SELLING) {
      test(`${r.given} add analytic metric`, async ({ page }) => {
        const acc = ground.accounts[String(c.g)]!;
        await sign(page, c.g, r, ground.teams[String(c.g)]!);
        await when(page, c.g, r, "g=account&r=7d");

        await test.step(c.given.then, async () => {
          // The account's row, named for it, carries the change in its own column.
          await expect.soft(page.getByTestId(`analytic-row-${acc}`)).toContainText(`E2E FM ${c.g} ${SUFFIX}`);
          await expect.soft(cell(page, acc, c.field)).toHaveText(money(c.want));
          await expect.soft(page.getByTestId(`analytic-sort-${c.field}`)).toHaveText(c.label);
          // The team's one account: the headline is the same figure.
          await expect.soft(page.getByTestId(/^analytic-row-/)).toHaveCount(1);
          await expect.soft(page.getByTestId(`analytic-headline-${c.field}-value`)).toHaveText(money(c.want));
          if (c.g === 5) {
            // The shop's own account took it — the first withdrawal made no "Unknown — shop #…" account beside it
            // (a-shop-names-the-account-it-withdraws-into).
            await expect.soft(page.getByTestId("analytic-table")).not.toContainText(`shop #${ground.shop5}`);
          }
        });
      });
    }
  });
}

// ── 7 · restock shipping cost raised Rp 50.000 ───────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G7.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const d = today();
      const at = `7-${r.key}`;
      const acc = ground.accounts[at]!;
      const raised = ground.restocks[at]!;
      await sign(page, 7, r, ground.teams["7"]!);

      // BEFORE — the edit day (today) holds the restock's payment.
      const was = await before(page, 7, r, `${d}..${d}`, acc, "restock", money(-RESTOCK));

      // The given — the shipping cost raised from Rp 0 to Rp 50.000.
      await asRoot("inventory.v1.RestockRequestService/RestockRequestUpdate", {
        teamId: ground.teams["7"],
        requestId: raised.id,
        warehouseId: ground.teams.w13,
        financeAccountId: acc,
        items: lineOf(raised),
        shipmentCost: SHIPPING,
      });

      await when(page, 7, r, `g=account&r=${d}..${d}`);

      await test.step(G7.then, async () => {
        // The edit day's Restock moved by the raise alone: −Rp 50.000 on top of the payment.
        const now = await reads(page, acc, "restock", money(-(RESTOCK + SHIPPING)));
        expect.soft(now - was).toBe(-SHIPPING);
      });
    });
  }
});

// ── 8 · restock payment moved from bank A to bank B ─────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G8.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const at = `8-${r.key}`;
      const accA = ground.accounts[at]!;
      const accB = ground.accounts[`${at}-b`]!;
      const raised = ground.restocks[at]!;
      await sign(page, 8, r, ground.teams["8"]!);

      // BEFORE — A carries the payment, B nothing.
      const wasA = await before(page, 8, r, "7d", accA, "restock", money(-RESTOCK));
      const wasB = await reads(page, accB, "restock", money(0));

      // The given — the payment moved to bank B.
      await asRoot("inventory.v1.RestockRequestService/RestockRequestUpdate", {
        teamId: ground.teams["8"],
        requestId: raised.id,
        warehouseId: ground.teams.w13,
        financeAccountId: accB,
        items: lineOf(raised),
      });

      await when(page, 8, r, "g=account&r=7d");

      await test.step(G8.then, async () => {
        // The move: A given the Rp 300.000 back, B charged it.
        const nowB = await reads(page, accB, "restock", money(-RESTOCK));
        const nowA = await reads(page, accA, "restock", money(0));
        expect.soft(nowA - wasA).toBe(RESTOCK);
        expect.soft(nowB - wasB).toBe(-RESTOCK);
      });
    });
  }
});

// ── 9 · restock Rp 300.000 cancelled ─────────────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G9.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const d = today();
      const at = `9-${r.key}`;
      const acc = ground.accounts[at]!;
      await sign(page, 9, r, ground.teams["9"]!);

      // BEFORE — the cancel day (today) holds the restock's payment.
      const was = await before(page, 9, r, `${d}..${d}`, acc, "restock", money(-RESTOCK));

      // The given — cancelled, the money returned.
      await asRoot("inventory.v1.RestockRequestService/RestockRequestCancel", {
        teamId: ground.teams["9"],
        requestId: ground.restocks[at]!.id,
        moneyReturned: true,
      });

      await when(page, 9, r, `g=account&r=${d}..${d}`);

      await test.step(G9.then, async () => {
        // The cancel day's Restock took the Rp 300.000 back.
        const now = await reads(page, acc, "restock", money(0));
        expect.soft(now - was).toBe(RESTOCK);
      });
    });
  }
});

// ── 11 · Rp 100.000 from bank to ShopeePay ───────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G11.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const bank = ground.accounts["11"]!;
      const pay = ground.accounts["11-pay"]!;
      await sign(page, 11, r, ground.teams["11"]!);
      await when(page, 11, r, "g=account&r=7d");

      await test.step(G11.thenLegs, async () => {
        await expect.soft(cell(page, bank, "transfer")).toHaveText(money(-TRANSFER));
        await expect.soft(cell(page, pay, "transfer")).toHaveText(money(TRANSFER));
        await expect.soft(page.getByTestId(`analytic-row-${pay}`)).toContainText(`E2E FM 11-pay ${SUFFIX}`);
      });
      await test.step(G11.thenTotal, async () => {
        // Both legs are the team's own accounts: the team's Transfer nets to nothing, and so does its money.
        await expect.soft(page.getByTestId("analytic-headline-transfer-value")).toHaveText(money(0));
        await expect.soft(page.getByTestId("analytic-headline-change-value")).toHaveText(money(0));
      });
    });
  }
});

// ── 12 · 13 · a payment of Rp 500.000 accepted, read by the payer and by the warehouse ───────────────────────────────

test.describe(`selling:all wants to see statistics (${G12.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const bank = ground.accounts["12"]!;
      await sign(page, 12, r, ground.teams["12"]!);
      await when(page, 12, r, "g=account&r=7d");

      await test.step(G12.then, async () => {
        await expect.soft(cell(page, bank, "team_payment")).toHaveText(money(-PAYMENT));
        await expect.soft(page.getByTestId("analytic-sort-team_payment")).toHaveText("Team payment");
      });
    });
  }
});

test.describe(`warehouse:all wants to see statistics (${G13.case})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const cash = ground.accounts["13"]!;
      await sign(page, 13, r, ground.teams.w13);
      await when(page, 13, r, "g=account&r=7d");

      await test.step(G13.then, async () => {
        await expect.soft(page.getByTestId(`analytic-row-${cash}`)).toContainText(`E2E FM 13 ${SUFFIX}`);
        await expect.soft(cell(page, cash, "team_payment")).toHaveText(money(PAYMENT));
      });
      await test.step("regression: the warehouse reads only its own account — none of the payer's", async () => {
        await expect.soft(page.getByTestId(/^analytic-row-/)).toHaveCount(1);
        await expect.soft(page.getByTestId(`analytic-row-${ground.accounts["12"]}`)).toHaveCount(0);
      });
    });
  }
});

// ── 15 · this month's change types ───────────────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G15.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      await sign(page, 12, r, ground.teams["12"]!);
      await when(page, 12, r, `g=change_type&r=${monthStart()}..${today()}`, TYPES);

      await test.step(G15.then, async () => {
        // The three types that moved this month, each its own row, named for it, with its signed amount — and no other.
        for (const [type, label, amount] of [
          [TYPE_EXPENSE, "Expense", -EXPENSE],
          [TYPE_RESTOCK, "Restock", -RESTOCK],
          [TYPE_TEAM_PAYMENT, "Team payment", -PAYMENT],
        ] as const) {
          await expect.soft(page.getByTestId(`analytic-row-${type}`)).toContainText(label);
          await expect.soft(cell(page, type, "amount")).toHaveText(money(amount));
        }
        await expect.soft(page.getByTestId(/^analytic-row-/)).toHaveCount(3);
        await expect.soft(page.getByTestId("analytic-headline-amount-value")).toHaveText(money(-(EXPENSE + RESTOCK + PAYMENT)));
      });
    });
  }
});

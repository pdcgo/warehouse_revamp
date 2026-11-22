import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── confirm payment — the checks behind docs/acceptances/balance/payment.md ────────────────────────────────────────────
//
// confirm payment's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then, run as EVERY role the
// given names (status-is-per-then). The rows' statuses are set from the tester's green results, or by the owner.
//
// Business rules (docs/business/balance/context_decision.md):
// - the-debtor-claims-the-creditor-decides — the team that is OWED accepts; accepting posts both mirrored entries, so
//   the pair moves now and only now. The CREDITOR is the scope of the confirm.
// - an-accepted-payment-is-final — once accepted it cannot move again: a second accept of the same payment is refused
//   ("only a recorded payment can be confirmed"), and the row lock makes two at once accept it once.
// - a-payment-always-moves-money (and financial_account's a-team-payment-posts-on-accept) — the accept names the account
//   the money landed in; *Liability Payment Accepted* posts a `team_payment` row on BOTH accounts: the payer's goes down,
//   the creditor's goes up.
// - the-block-stops-orders-only — a team at its credit limit cannot order; the accepted payment lowers the debt, so it
//   can again.
// - warehouse-roles-count-as-their-own-team — a selling team accepts a warehouse's payment through the same flow;
//   the-cross-markup-belongs-to-the-product — a borrowed product's fee is owed to (and paid to) the team that lent it.
//
// The WHEN, as the person does it: the creditor's /liability/<payer> page → Their payments → Accept on the pending row →
// Accept Payment, into the team's one operational account (pre-picked). The payment itself is recorded beforehand
// (the given's "pending"), through the API.
//
// GROUND (beforeAll, as root, through the API) — every given and role its own paying team, so no balance read here is
// moved by another test:
//   warehouse W (PQW…, a warehouse:owner and a warehouse:admin user, one operational account);
//   per warehouse role, selling teams q (pays the whole debt) · l (pays less) · m (pays more) · k (at its credit
//   limit, Rp 50.000 of Rp 50.000), each owing W a courier's Rp 50.000 — a restock accepted with the courier paid at the
//   door, *Restock Accepted* pushed to liability as the broker would — and its pending payment recorded;
//   one team r (accepted by 2 people at once), the same;
//   per selling role, a team e (the role's own) that owed W Rp 50.000, paid Rp 80.000 and was accepted → W owes it
//   Rp 30.000, and W's pending payment of that Rp 30.000;
//   cross team X (PQX…, a selling:owner and a selling:admin user, one operational account) and, per selling role, a team
//   d owing X Rp 24.000 product fee — two units of X's borrowed product (20% markup on Rp 10.000) ordered at warehouse
//   WX (PQV…) by root — and d's pending payment of it.
//   Every team pays from, and is paid into, its OWN operational account.
//
// Where each then is read:
// - `payment accepted` — the creditor's Their payments: the row reads Accepted and offers no Accept / Reject any more;
//   the server lists it CONFIRMED, into the creditor's account, by the person who accepted; the payer's My payments
//   reads Accepted too.
// - `liability balance decreases by payment` — the pair balance on the creditor's page (and the payer's), before and
//   after, and the server's position.
// - `selling team's account decreases by payment` / `warehouse's operational account increases by payment` — each
//   account's balance before and after (the accept's event pushed as the broker would).
// - `payment recorded in liability history` — the pair's ledger (All) on both sides: one `Payment #<id>` entry of the
//   amount, the balance after it Rp 0.
// - `payment recorded in both accounts' history` — each account's own page: one `Team payment #<id>` row, to the
//   creditor on the payer's account and from the payer on the warehouse's.
// - `recorded in finance analytic metric` — Analytic › Finance › Account changes by account, this week, each team its
//   own (every-team-reads-its-own-finance): the warehouse role reads W's account's Team payment up by the payment (W's
//   account takes every given's payments, so read before and after), the payer reads its own account's −the payment.
// - `selling team still owes the rest` — the payer's page: the rest, You owe them, Make Payment still offered.
// - `liability balance flips` / `warehouse owes selling team` — the direction turns on both pages; W now owes the
//   overpayment and is the one offered Make Payment.
// - `selling team can create orders again` — the seller's own order on W, refused by the credit limit before the
//   accept (the given), created after it.
// - `payment accepted once` — the owner and the admin press Accept Payment on the same payment at once: one answer is
//   accepted, the other refused with the server's words; the pair, the ledger and the account move ONCE.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-payconf-pass-1";
// What a paying team owes W: the courier's charge at the door.
const DEBT = 50_000;
// Less than the debt, and what is left after it.
const LESS = 20_000;
const REST = DEBT - LESS;
// More than the debt, and what W owes after it.
const OVER = 80_000;
const FLIP = OVER - DEBT;
// What W owes a team e that paid Rp 80.000 on Rp 50.000.
const W_OWES = OVER - DEBT;
// The borrowed product: Rp 10.000 a unit + 20% markup, two units.
const CROSS_MARKUP_BPS = 2_000;
const CROSS_DEBT = 24_000;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SELLING = [
  { key: "own", code: "O", given: "selling:owner", role: "ROLE_SELLING_OWNER" },
  { key: "adm", code: "A", given: "selling:admin", role: "ROLE_SELLING_ADMIN" },
] as const;
const WAREHOUSE = [
  { key: "own", code: "O", given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER" },
  { key: "adm", code: "A", given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN" },
] as const;

const user = (tag: string) => `e2epq${tag}${SUFFIX}`;
const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
// The warehouse's person for a warehouse role; the cross team's for a selling role.
const whUser = (key: string) => user(key === "own" ? "who" : "wha");
const crossUser = (key: string) => user(key === "own" ? "xo" : "xa");

interface Payer {
  team: string;
  name: string;
  account: string;
  accountName: string;
  // the team's person: the one who reads its side (a payer) or accepts (team e)
  user: string;
}

const ground = {
  wh: "",
  whName: `E2E PayConfirm WH ${SUFFIX}`,
  whAccount: "",
  whAccountName: "",
  cross: "",
  crossName: `E2E PayConfirm Cross ${SUFFIX}`,
  crossAccount: "",
  crossAccountName: "",
  // username → user id
  userIds: {} as Record<string, string>,
  // keyed `<given letter><role key>` — `qown`, `eadm`, … (and `r` for the race)
  teams: {} as Record<string, Payer>,
  // the pending payment of each team above, by the same key
  payments: {} as Record<string, string>,
  // team k's order ground, by role key
  orders: {} as Record<string, { shop: string; product: string; productCode: string }>,
};

// An RPC as the signed-in person — the status and the JSON body, never thrown.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body, API_URL] as const,
  );
}

// A call that must succeed — its JSON body.
async function ok<T = any>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// Somebody on a page of their own, signed in through the form, working in their team.
async function pageOf(browser: Browser, username: string, teamId: string) {
  const p = await browser.newPage();
  await signIn(p, username, PASSWORD);
  await useTeam(p, teamId);

  return p;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// The account's balance as its team reads it — proto3 JSON leaves a zero out.
async function accountBalance(page: Page, teamId: string, accountId: string) {
  const res = await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOverview", {
    teamId,
    filter: { accountIds: [accountId] },
    metricRequest: ["FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_BALANCE"],
  });

  return Number(res.items?.[0]?.balance?.mapData?.[accountId]?.balance ?? 0);
}

// What a team owes in total, by the server. `+ 0` because a magnitude of nothing comes back as -0.
async function totalPayable(page: Page, teamId: string) {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", { teamId, page: { page: 1, limit: 50 } });

  return Number(res.totalPayable ?? 0) + 0;
}

// The team's balance with ONE counterparty, by the server — positive: they owe the team; negative: the team owes.
async function balanceWith(page: Page, teamId: string, counterpartyId: string) {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", {
    teamId,
    filter: { counterpartyId },
    page: { page: 1, limit: 50 },
  });
  const map = (res.items as { position?: { mapData: Record<string, Record<string, any>> } }[] | undefined)?.find(
    (it) => it.position,
  )?.position?.mapData;

  return Number(map?.[counterpartyId]?.balance ?? 0) + 0;
}

// What `debtor` owes `creditor` right now, as the order form and the create's check read it.
async function debtTo(page: Page, debtor: string, creditor: string): Promise<number> {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityCreditByIds", {
    teamId: debtor,
    filter: { ids: [creditor] },
    dataRequest: ["LIABILITY_CREDIT_BY_IDS_DATA_TYPE_CREDIT"],
  });
  for (const item of res.items?.[creditor]?.items ?? []) {
    const credit = item.credit?.mapData?.[creditor];
    if (credit) return Number(credit.debt ?? 0);
  }

  return 0;
}

// One payment of the pair, as `teamId` lists it.
async function paymentOn(page: Page, teamId: string, counterpartyId: string, id: string): Promise<Record<string, any>> {
  const res = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentList", {
    teamId,
    filter: { counterpartyId },
    page: { page: 1, limit: 50 },
  });
  const map = (res.items as { payment?: { mapData: Record<string, Record<string, any>> } }[]).find((it) => it.payment)
    ?.payment?.mapData;
  const found = Object.values(map ?? {}).find((p) => String(p.id) === id);
  expect(found, `payment ${id} on team ${teamId}'s list with ${counterpartyId}`).toBeTruthy();

  return found!;
}

// The payer's proof, uploaded and shared with the creditor (a-payment-must-carry-proof).
async function uploadProof(page: Page, ownerTeam: string, shareWith: string) {
  const requested = await ok(page, "document.v1.DocumentService/RequestUpload", {
    teamId: ownerTeam,
    filename: "transfer.png",
    contentType: "image/png",
    sizeBytes: "70",
    resourceType: "DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF",
  });

  const put = await page.evaluate(
    async ([url, method, headers, png]) => {
      const bytes = Uint8Array.from(atob(png as string), (c) => c.charCodeAt(0));
      const res = await fetch(url as string, { method: method as string, headers: headers as Record<string, string>, body: bytes });

      return res.status;
    },
    [requested.uploadUrl, requested.method, requested.headers ?? {}, PNG] as const,
  );
  expect(put).toBeLessThan(300);

  const confirmed = await ok(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: requested.uploadToken });
  await ok(page, "document.v1.DocumentService/ShareDocument", {
    teamId: ownerTeam,
    documentId: confirmed.document.id,
    withTeamId: shareWith,
  });

  return String(confirmed.document.id);
}

// *Restock Accepted* as the broker pushes it to liability's listener — built from the restock the server returned.
function pushRestockAccepted(restock: Record<string, string | number>) {
  const acceptedAt = new Date(Number(restock.acceptedAtUnix) * 1000);
  const event = {
    eventId: `restock-accepted:${restock.id}`,
    occurredAt: acceptedAt.toISOString(),
    aggregateId: `restock:${restock.id}`,
    restockAccepted: {
      restockId: restock.id,
      teamId: restock.requestingTeamId,
      warehouseId: restock.warehouseId,
      acceptedOn: acceptedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      acceptedAtUnix: restock.acceptedAtUnix,
      warehouseAdditionalCost: restock.warehouseAdditionalCost,
      warehouseAdditionalCostNote: restock.warehouseAdditionalCostNote,
      actorId: restock.acceptedByUserId,
    },
  };

  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString("base64"),
      attributes: { event_type: "warehouse.events.v1.RestockAccepted" },
      messageId: `${event.eventId}-${Date.now()}`,
    },
    subscription: "projects/warehouse-dev/subscriptions/liability-restock-accepted",
  };
}

// *Liability Payment Accepted* as the broker pushes it to the financial accounts — the money leaving the payer's
// account and landing in the creditor's. Its event id is liability's own, so a second delivery posts nothing.
function pushPaymentAccepted(payment: Record<string, string>) {
  const event = {
    eventId: `liability-payment-accepted:${payment.id}`,
    occurredAt: new Date(Number(payment.confirmedAtUnix) * 1000).toISOString(),
    aggregateId: `liability-payment:${payment.id}`,
    liabilityPaymentAccepted: {
      paymentId: payment.id,
      payerTeamId: payment.payerTeamId,
      creditorTeamId: payment.creditorTeamId,
      amount: payment.amount,
      fromAccountId: payment.fromAccountId,
      toAccountId: payment.toAccountId,
      actorId: payment.confirmedBy,
    },
  };

  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString("base64"),
      attributes: { event_type: "warehouse.events.v1.LiabilityPaymentAccepted" },
      messageId: `${event.eventId}-${Date.now()}`,
    },
    subscription: "projects/warehouse-dev/subscriptions/financial-account-team-payment",
  };
}

// The accepted payment's two account rows, posted as the broker would deliver the accept.
async function postToAccounts(page: Page, payment: Record<string, string>) {
  const res = await page.request.post(`${API_URL}/event/financial-account-team-payment/push`, {
    data: pushPaymentAccepted(payment),
  });
  expect(res.status()).toBe(200);
}

// The pair page, loaded: its balance has rendered.
async function openPair(page: Page, counterpartyId: string) {
  await page.goto(`/liability/${counterpartyId}`);
  await expect(page.getByTestId("liability-detail-tab-all")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("liability-detail-balance")).toBeVisible();
}

// The payer's view of its own payments: the pair page, My payments.
async function openMine(page: Page, counterpartyId: string) {
  await openPair(page, counterpartyId);
  await page.getByTestId("liability-detail-tab-mine").click();

  return page.getByTestId("liability-detail-mine");
}

// The creditor's view of the payer's payments: the pair page, Their payments.
async function openTheirs(page: Page, counterpartyId: string) {
  await openPair(page, counterpartyId);
  await page.getByTestId("liability-detail-tab-team").click();

  return page.getByTestId("liability-detail-team");
}

// The pair balance as the page shows it — the figure and which way it runs.
async function pairReads(page: Page, amount: number, direction: "They owe you" | "You owe them" | "Square") {
  await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText(rp(amount));
  await expect.soft(page.getByTestId("liability-detail-direction")).toHaveText(direction);
}

const isConfirm = (url: string) => url.endsWith("/warehouse.liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm");

// Up to the press: Their payments → Accept on the pending row → the dialog, its account (the team's one operational
// account) pre-picked. Returns Accept Payment, ready.
async function openAccept(page: Page, payerTeam: string, paymentId: string, accountName: string) {
  const theirs = await openTheirs(page, payerTeam);
  await expect(theirs.getByTestId(`liability-detail-payment-status-${paymentId}`)).toHaveText("Pending");
  await theirs.getByTestId(`liability-detail-confirm-${paymentId}`).click();

  await expect(page.getByTestId("liability-detail-confirm-account")).toContainText(accountName);
  const submit = page.getByTestId("liability-detail-confirm-submit");
  await expect(submit).toBeEnabled();

  return submit;
}

// THE WHEN — the creditor accepts the pending payment into its operational account. Returns the payment as the server
// then lists it; its account rows are posted as the broker would deliver the accept.
async function accept(page: Page, creditorTeam: string, payerTeam: string, paymentId: string, accountName: string) {
  const submit = await openAccept(page, payerTeam, paymentId, accountName);
  const answer = page.waitForResponse((r) => isConfirm(r.url()));
  await submit.click();
  expect((await answer).status()).toBe(200);
  await expect(submit).toBeHidden();

  const paid = await paymentOn(page, creditorTeam, payerTeam, paymentId);
  await postToAccounts(page, paid);

  return paid;
}

// `payment accepted`, on the creditor's Their payments and the server's record.
async function acceptedOnTheirs(page: Page, payerTeam: string, paid: Record<string, any>, into: string, by: string) {
  expect.soft(paid.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");
  expect.soft(String(paid.toAccountId)).toBe(into);
  expect.soft(String(paid.confirmedBy)).toBe(ground.userIds[by]);

  const theirs = await openTheirs(page, payerTeam);
  await expect.soft(theirs.getByTestId(`liability-detail-payment-status-${paid.id}`)).toHaveText("Accepted");
  await expect.soft(theirs.getByTestId(`liability-detail-confirm-${paid.id}`)).toHaveCount(0);
  await expect.soft(theirs.getByTestId(`liability-detail-reject-${paid.id}`)).toHaveCount(0);
}

// …and on the payer's My payments.
async function acceptedOnMine(page: Page, creditorTeam: string, paymentId: string) {
  const mine = await openMine(page, creditorTeam);
  await expect.soft(mine.getByTestId(`liability-detail-payment-status-${paymentId}`)).toHaveText("Accepted");
  await expect.soft(mine.getByTestId(`liability-detail-cancel-${paymentId}`)).toHaveCount(0);
}

// The payment's entry on a pair's ledger (All).
async function ledgerEntry(page: Page, counterpartyId: string, paymentId: string): Promise<Locator> {
  await openPair(page, counterpartyId);

  return page
    .getByTestId("liability-detail-all")
    .locator('[data-testid^="liability-detail-entry-"]', { hasText: new RegExp(`Payment #${paymentId}(?!\\d)`) });
}

// The payment's row on an account's own page.
async function accountRow(page: Page, accountId: string, text: string): Promise<Locator> {
  await page.goto(`/financial-accounts/${accountId}`);
  await expect(page.getByTestId("financial-account-page")).toBeVisible();

  return page.getByTestId("account-log-table").locator('[data-testid^="account-log-row-"]', { hasText: new RegExp(`${text}(?!\\d)`) });
}

// Analytic › Finance › Account changes, by account, filtered to the one account, this week — the signed-in team's own
// (every-team-reads-its-own-finance). Its Team payment cell is signed: money in positive, money OUT NEGATIVE (−Rp …).
const FINANCE = "metrics/financial_accounts";
const signed = (text: string) => (/^\s*[−-]/.test(text) ? -1 : 1) * Number(text.replace(/[^0-9]/g, "") || 0) + 0;

async function financeTeamPayment(page: Page, accountId: string): Promise<number> {
  await page.goto(`/analytic?g=account&m=${FINANCE}&r=7d&acc=${accountId}`);
  const cell = page.getByTestId(`analytic-cell-${accountId}-team_payment`);
  await expect(cell).toBeVisible();

  return signed(await cell.innerText());
}

// …re-read until the accept's posting lands on the figure.
async function financeTeamPaymentReads(page: Page, accountId: string, expected: number) {
  await expect(async () => {
    expect(await financeTeamPayment(page, accountId)).toBe(expected);
  }).toPass({ timeout: 30_000 });
}

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ browser, request }) => {
  test.setTimeout(480_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const member = async (teamId: string, username: string, role: string) => {
    const created = await ok(page, "user.v1.UserService/CreateUser", {
      teamId,
      username,
      password: PASSWORD,
      name: `PayConfirm ${username}`,
      role,
    });
    ground.userIds[username] = String(created.user.id);
  };
  const account = async (teamId: string, tag: string) => {
    const name = `E2E PayConfirm ${tag} BCA ${SUFFIX}`;
    const id = String(
      (
        await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name,
          holderName: "PT E2E",
          accountNumber: `E2E-PYC-${tag}-${SUFFIX}`,
          openingBalance: 1_000_000,
          openingOn: today(),
        })
      ).account.id,
    );
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId,
      accountId: id,
      operational: true,
    });

    return { id, name };
  };

  // ── W, its two people, its operational account, and its fee (team k orders from it).
  ground.wh = await team(ground.whName, `PQW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await member(ground.wh, user("who"), "ROLE_WAREHOUSE_OWNER");
  await member(ground.wh, user("wha"), "ROLE_WAREHOUSE_ADMIN");
  const wa = await account(ground.wh, "W");
  ground.whAccount = wa.id;
  ground.whAccountName = wa.name;
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.wh, feePercent: 10, minFee: 0 });

  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.wh, code: `pq-${SUFFIX}` })).rack.id);
  const category = String((await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E PayConfirm ${SUFFIX}` })).category.id);

  // A selling team with its person and its operational account.
  const payer = async (letter: string, code: string, role: string): Promise<Payer> => {
    const name = `E2E PayConfirm ${letter.toUpperCase()}${code} ${SUFFIX}`;
    const id = await team(name, `PQ${letter.toUpperCase()}${code}${SUFFIX}`, "TEAM_TYPE_SELLING");
    const username = user(`${letter}${code.toLowerCase()}`);
    await member(id, username, role);
    const acc = await account(id, `${letter.toUpperCase()}${code}`);

    return { team: id, name, account: acc.id, accountName: acc.name, user: username };
  };

  // The courier's Rp 50.000 at the door: a restock counted in, *Restock Accepted* pushed to liability. Returns the
  // product it brought in (2 units on W's rack).
  const owesWarehouse = async (p: Payer, code: string) => {
    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId: p.team,
        productCodePart: `PQ${code}P${SUFFIX}`,
        name: "Widget",
        categoryId: category,
      })
    ).product;
    const created = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: p.team,
      warehouseId: ground.wh,
      financeAccountId: p.account,
      items: [{ productId: product.id, productCode: product.productCode, name: "Widget", count: 2, total: 20_000 }],
    });
    const accepted = await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.wh,
      requestId: created.request.id,
      warehouseAdditionalCost: DEBT,
      warehouseAdditionalCostNote: "courier asked at the door",
      lines: (created.request.items as { id: string; count: string }[]).map((item) => ({
        itemId: item.id,
        receivedCount: item.count,
        placements: [{ placementId: rack, quantity: item.count }],
      })),
    });

    // Balance posts the courier's charge from *Restock Accepted* — once, however often it arrives.
    const res = await request.post(`${API_URL}/event/liability-restock-accepted/push`, {
      data: pushRestockAccepted(accepted.request),
    });
    expect(res.status()).toBe(200);
    await expect.poll(() => totalPayable(page, p.team), { timeout: 20_000 }).toBe(DEBT);

    return { id: String(product.id), productCode: String(product.productCode) };
  };

  // A payment recorded and left pending — from the payer's operational account, its proof shared with the creditor.
  const pending = async (payerTeam: string, creditor: string, fromAccountId: string, amount: number, note: string) => {
    const proof = await uploadProof(page, payerTeam, creditor);
    const recorded = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
      teamId: payerTeam,
      creditorTeamId: creditor,
      amount: String(amount),
      note,
      documentIds: [proof],
      fromAccountId,
    });
    expect(recorded.payment.status).toBe("LIABILITY_PAYMENT_STATUS_RECORDED");

    return String(recorded.payment.id);
  };

  // ── per warehouse role: q (the whole debt) · l (less) · m (more) · k (at its credit limit) owe W and have paid.
  const amounts: Record<string, number> = { q: DEBT, l: LESS, m: OVER, k: DEBT };
  for (const r of WAREHOUSE) {
    for (const letter of ["q", "l", "m", "k"]) {
      const p = await payer(letter, r.code, "ROLE_SELLING_OWNER");
      const key = `${letter}${r.key}`;
      ground.teams[key] = p;
      const product = await owesWarehouse(p, `${letter.toUpperCase()}${r.code}`);

      if (letter === "k") {
        // At its limit: Rp 50.000 owed of Rp 50.000 — and the ground for its own order on W.
        await ok(page, "liability.v1.LiabilityTermsService/LiabilityTermsSet", {
          teamId: ground.wh,
          counterpartyId: p.team,
          creditLimit: DEBT,
          reason: "e2e acceptance: at credit limit",
        });
        await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: p.team, warehouseId: ground.wh });
        const shop = String(
          (
            await ok(page, "selling.v1.ShopService/ShopCreate", {
              teamId: p.team,
              name: `E2E PayConfirm Shop K${r.code} ${SUFFIX}`,
              shopCode: `PQS${r.code}${SUFFIX}`,
              marketplace: "MARKETPLACE_SHOPEE",
            })
          ).shop.id,
        );
        // The owner is on its shop already or is added now — either way it writes there.
        await call(page, "selling.v1.ShopService/ShopUserAdd", { teamId: p.team, shopId: shop, userId: ground.userIds[p.user] });
        ground.orders[r.key] = { shop, product: product.id, productCode: product.productCode };
      }

      ground.payments[key] = await pending(p.team, ground.wh, p.account, amounts[letter]!, `transfer BCA, ${letter}`);
    }
  }

  // ── one team r, its whole debt paid — accepted by the owner and the admin at once.
  const race = await payer("r", "X", "ROLE_SELLING_OWNER");
  ground.teams.r = race;
  await owesWarehouse(race, "RX");
  ground.payments.r = await pending(race.team, ground.wh, race.account, DEBT, "transfer BCA, race");

  // ── per selling role: a team e (the role's own) that owed W Rp 50.000 and paid Rp 80.000, accepted → W owes it
  // Rp 30.000; then W's payment of it, pending.
  for (const r of SELLING) {
    const e = await payer("e", r.code, r.role);
    const key = `e${r.key}`;
    ground.teams[key] = e;
    await owesWarehouse(e, `E${r.code}`);

    const over = await pending(e.team, ground.wh, e.account, OVER, "paid too much");
    const confirmed = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
      teamId: ground.wh,
      paymentId: over,
      toAccountId: ground.whAccount,
    });
    await postToAccounts(page, confirmed.payment);
    await expect.poll(() => balanceWith(page, ground.wh, e.team)).toBe(-W_OWES);

    ground.payments[key] = await pending(ground.wh, e.team, ground.whAccount, W_OWES, "returning the overpayment");
  }

  // ── the product-fee pairs: X lends its product; per selling role a team d orders 2 units of it at WX, and pays.
  ground.cross = await team(ground.crossName, `PQX${SUFFIX}`, "TEAM_TYPE_SELLING");
  await member(ground.cross, user("xo"), "ROLE_SELLING_OWNER");
  await member(ground.cross, user("xa"), "ROLE_SELLING_ADMIN");
  const crossAccount = await account(ground.cross, "X");
  ground.crossAccount = crossAccount.id;
  ground.crossAccountName = crossAccount.name;
  const wx = await team(`E2E PayConfirm WX ${SUFFIX}`, `PQV${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const wxRack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: wx, code: `pqx-${SUFFIX}` })).rack.id);
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wx, feePercent: 10, minFee: 0 });

  const product = async (owner: string, code: string, cross: boolean) =>
    String(
      (
        await ok(page, "product.v1.ProductService/ProductCreate", {
          teamId: owner,
          productCodePart: code,
          name: `E2E ${code}`,
          categoryId: category,
          ...(cross ? { crossMarkupBps: CROSS_MARKUP_BPS } : {}),
        })
      ).product.id,
    );
  const crossCode = `PQXP${SUFFIX}`;
  const crossProduct = await product(ground.cross, crossCode, true);
  const supplier = String(
    (await ok(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.cross, name: `E2E PayConfirm Supplier ${SUFFIX}` }))
      .supplier.id,
  );
  const raised = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.cross,
    warehouseId: wx,
    financeAccountId: ground.crossAccount,
    items: [{ productId: crossProduct, productCode: crossCode, name: `E2E ${crossCode}`, count: 10, total: 100_000, supplierId: supplier }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: wx,
    requestId: raised.request.id,
    lines: (raised.request.items as { id: string }[]).map((item) => ({
      itemId: item.id,
      receivedCount: 10,
      placements: [{ placementId: wxRack, quantity: 10 }],
    })),
  });

  for (const [i, r] of SELLING.entries()) {
    const d = await payer("d", r.code, "ROLE_SELLING_OWNER");
    ground.teams[`d${r.key}`] = d;
    // A team with no return warehouse cannot order, and a borrowed line needs its return mapping.
    await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: d.team, warehouseId: wx });
    const own = await product(d.team, `PQM${r.code}${SUFFIX}`, false);
    await ok(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
      teamId: d.team,
      sharedProductId: crossProduct,
      ownProductId: own,
    });
    const shop = String(
      (
        await ok(page, "selling.v1.ShopService/ShopCreate", {
          teamId: d.team,
          name: `E2E PayConfirm Shop D${r.code} ${SUFFIX}`,
          shopCode: `PQT${i + 1}${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-pq-${SUFFIX}-x${r.key}`,
      shipmentChannelId: "1",
      teamId: d.team,
      shopId: shop,
      warehouseId: wx,
      customerName: `E2E PayConfirm Buyer ${r.key}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `PQ${SUFFIX}X${r.code}`,
      items: [{ productId: crossProduct, productCode: crossCode, name: `E2E ${crossCode}`, quantity: 2 }],
    });
  }
  // The product fee lands through the ledger's listener — wait until each debt reads, then d pays it.
  for (const r of SELLING) {
    const d = ground.teams[`d${r.key}`]!;
    await expect.poll(() => debtTo(page, d.team, ground.cross), { timeout: 60_000 }).toBe(CROSS_DEBT);
    ground.payments[`d${r.key}`] = await pending(d.team, ground.cross, d.account, CROSS_DEBT, "the borrowed widgets");
  }

  await page.close();
});

test.describe("warehouse:owner · warehouse:admin wants to accept a payment (pending · amount equals debt · into operational account)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} confirm payment`, async ({ page, browser }) => {
      const t = ground.teams[`q${r.key}`]!;
      const paymentId = ground.payments[`q${r.key}`]!;
      await signIn(page, whUser(r.key), PASSWORD);
      await useTeam(page, ground.wh);
      const seller = await pageOf(browser, t.user, t.team);

      // THE GIVEN, on W's page: the team owes Rp 50.000 and its payment of it is pending.
      await openPair(page, t.team);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));
      await expect(page.getByTestId("liability-detail-direction")).toHaveText("They owe you");
      const whBefore = await accountBalance(page, ground.wh, ground.whAccount);
      const sellerBefore = await accountBalance(seller, t.team, t.account);
      // W's Team payment this week before the accept — W's account takes every given's payments, so the then reads
      // the difference; the payer's own account has moved by no payment yet.
      const whFinanceBefore = await financeTeamPayment(page, ground.whAccount);
      expect(await financeTeamPayment(seller, t.account)).toBe(0);

      const paid = await accept(page, ground.wh, t.team, paymentId, ground.whAccountName);

      await test.step("then: payment accepted", async () => {
        await acceptedOnTheirs(page, t.team, paid, ground.whAccount, whUser(r.key));
        await acceptedOnMine(seller, ground.wh, paymentId);
      });

      await test.step("then: liability balance decreases by payment", async () => {
        await openPair(page, t.team);
        await pairReads(page, 0, "Square");
        expect.soft(await balanceWith(page, ground.wh, t.team)).toBe(0);

        // …and on the payer's side of the pair.
        await openPair(seller, ground.wh);
        await pairReads(seller, 0, "Square");
        expect.soft(await totalPayable(seller, t.team)).toBe(0);
      });

      await test.step("then: selling team's account decreases by payment", async () => {
        await expect.poll(() => accountBalance(seller, t.team, t.account)).toBe(sellerBefore - DEBT);
      });

      await test.step("then: warehouse's operational account increases by payment", async () => {
        await expect.poll(() => accountBalance(page, ground.wh, ground.whAccount)).toBe(whBefore + DEBT);
      });

      await test.step("then: payment recorded in liability history", async () => {
        const onW = await ledgerEntry(page, t.team, paymentId);
        await expect.soft(onW).toHaveCount(1);
        await expect.soft(onW).toContainText(rp(DEBT));
        await expect.soft(onW.locator('[data-testid^="liability-detail-balance-after-"]')).toContainText(rp(0));

        const onSeller = await ledgerEntry(seller, ground.wh, paymentId);
        await expect.soft(onSeller).toHaveCount(1);
        await expect.soft(onSeller).toContainText(rp(DEBT));
        await expect.soft(onSeller.locator('[data-testid^="liability-detail-balance-after-"]')).toContainText(rp(0));
      });

      await test.step("then: payment recorded in both accounts' history", async () => {
        const out = await accountRow(seller, t.account, `Team payment #${paymentId} to team #${ground.wh}`);
        await expect.soft(out).toHaveCount(1);
        await expect.soft(out).toContainText("Team payment");
        await expect.soft(out).toContainText(rp(DEBT));

        const into = await accountRow(page, ground.whAccount, `Team payment #${paymentId} from team #${t.team}`);
        await expect.soft(into).toHaveCount(1);
        await expect.soft(into).toContainText("Team payment");
        await expect.soft(into).toContainText(rp(DEBT));
      });

      await test.step("then: recorded in finance analytic metric", async () => {
        // The warehouse role on Analytic › Finance › Account changes: W's operational account's Team payment up by it…
        await financeTeamPaymentReads(page, ground.whAccount, whFinanceBefore + DEBT);
        await expect.soft(page.getByTestId(`analytic-cell-${ground.whAccount}-team_payment`)).toHaveText(rp(whFinanceBefore + DEBT));

        // …and the paying team's own Finance: its account's Team payment out by it, money out negative.
        await financeTeamPaymentReads(seller, t.account, -DEBT);
        await expect.soft(seller.getByTestId(`analytic-cell-${t.account}-team_payment`)).toHaveText(new RegExp(`^[−-]${rp(DEBT).replace(/\./g, "\\.")}$`));
      });

      await seller.close();
    });
  }
});

test.describe("warehouse:owner · warehouse:admin wants to accept a payment (pending · amount less than debt · into operational account)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} confirm payment`, async ({ page, browser }) => {
      const t = ground.teams[`l${r.key}`]!;
      const paymentId = ground.payments[`l${r.key}`]!;
      await signIn(page, whUser(r.key), PASSWORD);
      await useTeam(page, ground.wh);

      // THE GIVEN: Rp 50.000 owed, Rp 20.000 of it paid and pending.
      await openPair(page, t.team);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));

      const paid = await accept(page, ground.wh, t.team, paymentId, ground.whAccountName);
      expect(paid.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");

      await test.step("then: liability balance decreases by payment", async () => {
        await openPair(page, t.team);
        await pairReads(page, REST, "They owe you");
        expect.soft(await balanceWith(page, ground.wh, t.team)).toBe(REST);

        const entry = await ledgerEntry(page, t.team, paymentId);
        await expect.soft(entry).toHaveCount(1);
        await expect.soft(entry).toContainText(rp(LESS));
        await expect.soft(entry.locator('[data-testid^="liability-detail-balance-after-"]')).toContainText(rp(REST));
      });

      await test.step("then: selling team still owes the rest", async () => {
        const seller = await pageOf(browser, t.user, t.team);
        await openPair(seller, ground.wh);
        await pairReads(seller, REST, "You owe them");
        // Still the debtor, so still the one offered Make Payment.
        await expect.soft(seller.getByTestId("liability-detail-make-payment")).toBeVisible();
        expect.soft(await totalPayable(seller, t.team)).toBe(REST);
        expect.soft(await debtTo(seller, t.team, ground.wh)).toBe(REST);
        await seller.close();
      });
    });
  }
});

test.describe("warehouse:owner · warehouse:admin wants to accept a payment (pending · amount more than debt · into operational account)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} confirm payment`, async ({ page, browser }) => {
      const t = ground.teams[`m${r.key}`]!;
      const paymentId = ground.payments[`m${r.key}`]!;
      await signIn(page, whUser(r.key), PASSWORD);
      await useTeam(page, ground.wh);

      // THE GIVEN: Rp 50.000 owed, Rp 80.000 paid and pending.
      await openPair(page, t.team);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));
      await expect(page.getByTestId("liability-detail-direction")).toHaveText("They owe you");

      const paid = await accept(page, ground.wh, t.team, paymentId, ground.whAccountName);
      expect(paid.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");
      const seller = await pageOf(browser, t.user, t.team);

      await test.step("then: liability balance flips", async () => {
        // W's side: it was owed Rp 50.000 and now owes Rp 30.000.
        await openPair(page, t.team);
        await pairReads(page, FLIP, "You owe them");
        expect.soft(await balanceWith(page, ground.wh, t.team)).toBe(-FLIP);

        // The payer's side turns the other way.
        await openPair(seller, ground.wh);
        await pairReads(seller, FLIP, "They owe you");
        expect.soft(await balanceWith(seller, t.team, ground.wh)).toBe(FLIP);
      });

      await test.step("then: warehouse owes selling team", async () => {
        // W is the debtor now — the one offered Make Payment; the payer owes nothing and is offered none.
        await openPair(page, t.team);
        await expect.soft(page.getByTestId("liability-detail-make-payment")).toBeVisible();
        await openPair(seller, ground.wh);
        await expect.soft(seller.getByTestId("liability-detail-make-payment")).toHaveCount(0);
        expect.soft(await totalPayable(seller, t.team)).toBe(0);
      });

      await seller.close();
    });
  }
});

test.describe("warehouse:owner · warehouse:admin wants to accept a payment (pending · selling team at credit limit · into operational account)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} confirm payment`, async ({ page, browser }) => {
      const t = ground.teams[`k${r.key}`]!;
      const paymentId = ground.payments[`k${r.key}`]!;
      const o = ground.orders[r.key]!;
      const order = (tag: string) => ({
        idempotencyKey: `e2e-pq-${SUFFIX}-k${r.key}-${tag}`,
        shipmentChannelId: "1",
        teamId: t.team,
        shopId: o.shop,
        warehouseId: ground.wh,
        customerName: `E2E PayConfirm Buyer K${r.code}`,
        platformTotal: 100_000,
        platformCreatedAtUnix: Math.floor(Date.now() / 1000),
        orderExternalRefId: `PQ${SUFFIX}K${r.code}`,
        items: [{ productId: o.product, productCode: o.productCode, name: "Widget", quantity: 1 }],
      });

      // THE GIVEN, as the seller: at its limit with W, its own order there refused by the credit limit.
      const seller = await pageOf(browser, t.user, t.team);
      const held = await call(seller, "selling.v1.OrderService/OrderCreate", order("held"));
      expect(held.status, JSON.stringify(held.body)).toBe(400);
      expect(held.body.code).toBe("failed_precondition");
      expect(held.body.message).toContain("credit limit reached");

      await signIn(page, whUser(r.key), PASSWORD);
      await useTeam(page, ground.wh);
      await openPair(page, t.team);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));

      const paid = await accept(page, ground.wh, t.team, paymentId, ground.whAccountName);
      expect(paid.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");

      await test.step("then: selling team can create orders again", async () => {
        await expect.poll(() => debtTo(seller, t.team, ground.wh), { timeout: 30_000 }).toBe(0);
        const created = await call(seller, "selling.v1.OrderService/OrderCreate", order("again"));
        expect.soft(created.status, JSON.stringify(created.body)).toBe(200);
        expect.soft(created.body.order?.id).toBeTruthy();
      });

      await seller.close();
    });
  }
});

test.describe("warehouse:owner · warehouse:admin wants to accept a payment (pending · accepted by 2 people at once)", () => {
  test("warehouse:owner and warehouse:admin confirm payment at once", async ({ page, browser }) => {
    const t = ground.teams.r!;
    const paymentId = ground.payments.r!;
    await signIn(page, whUser("own"), PASSWORD);
    await useTeam(page, ground.wh);
    const admin = await pageOf(browser, whUser("adm"), ground.wh);
    const people = [
      { page, user: whUser("own") },
      { page: admin, user: whUser("adm") },
    ];

    await openPair(page, t.team);
    await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));
    const whBefore = await accountBalance(page, ground.wh, ground.whAccount);

    // THE WHEN, twice at once: both have the dialog open on the same pending payment, and both press Accept Payment.
    const submits: Locator[] = [];
    for (const p of people) submits.push(await openAccept(p.page, t.team, paymentId, ground.whAccountName));
    const answers = people.map((p) => p.page.waitForResponse((res) => isConfirm(res.url())));
    await Promise.all(submits.map((s) => s.click()));
    const statuses = (await Promise.all(answers)).map((a) => a.status());

    await test.step("then: payment accepted once", async () => {
      // One answer accepts; the other is refused — an accepted payment is final.
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      const winner = people[statuses.indexOf(200)]!;
      const loser = people[1 - statuses.indexOf(200)]!;
      await expect.soft(winner.page.getByTestId("liability-detail-confirm-submit")).toBeHidden();
      await expect.soft(loser.page.getByRole("dialog")).toContainText("only a recorded payment can be confirmed");

      const paid = await paymentOn(page, ground.wh, t.team, paymentId);
      expect.soft(paid.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");
      expect.soft(String(paid.confirmedBy)).toBe(ground.userIds[winner.user]);
      await postToAccounts(page, paid);

      // The pair moved once: square, not flipped to W owing Rp 50.000.
      await openPair(page, t.team);
      await pairReads(page, 0, "Square");
      expect.soft(await balanceWith(page, ground.wh, t.team)).toBe(0);
      const entry = await ledgerEntry(page, t.team, paymentId);
      await expect.soft(entry).toHaveCount(1);

      // The account moved once.
      await expect.poll(() => accountBalance(page, ground.wh, ground.whAccount)).toBe(whBefore + DEBT);
      const into = await accountRow(page, ground.whAccount, `Team payment #${paymentId} from team #${t.team}`);
      await expect.soft(into).toHaveCount(1);
    });

    await admin.close();
  });
});

test.describe("selling:owner · selling:admin wants to accept a payment (pending · from warehouse · into operational account)", () => {
  for (const r of SELLING) {
    test(`${r.given} confirm payment`, async ({ page, browser }) => {
      const t = ground.teams[`e${r.key}`]!;
      const paymentId = ground.payments[`e${r.key}`]!;
      await signIn(page, t.user, PASSWORD);
      await useTeam(page, t.team);

      // THE GIVEN, on the selling team's page: W owes it Rp 30.000 and W's payment of it is pending.
      await openPair(page, ground.wh);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(W_OWES));
      await expect(page.getByTestId("liability-detail-direction")).toHaveText("They owe you");

      const paid = await accept(page, t.team, ground.wh, paymentId, t.accountName);

      await test.step("then: payment accepted", async () => {
        await acceptedOnTheirs(page, ground.wh, paid, t.account, t.user);
        const wh = await pageOf(browser, whUser("own"), ground.wh);
        await acceptedOnMine(wh, t.team, paymentId);
        await wh.close();
      });

      await test.step("then: liability balance decreases by payment", async () => {
        await openPair(page, ground.wh);
        await pairReads(page, 0, "Square");
        expect.soft(await balanceWith(page, t.team, ground.wh)).toBe(0);
        const entry = await ledgerEntry(page, ground.wh, paymentId);
        await expect.soft(entry).toHaveCount(1);
        await expect.soft(entry).toContainText(rp(W_OWES));
      });
    });
  }
});

test.describe("selling:owner · selling:admin wants to accept a payment (pending · from another selling team · into operational account)", () => {
  for (const r of SELLING) {
    test(`${r.given} confirm payment`, async ({ page, browser }) => {
      const d = ground.teams[`d${r.key}`]!;
      const paymentId = ground.payments[`d${r.key}`]!;
      await signIn(page, crossUser(r.key), PASSWORD);
      await useTeam(page, ground.cross);

      // THE GIVEN, on X's page: team d owes it the lent product's Rp 24.000, and d's payment of it is pending.
      await openPair(page, d.team);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(CROSS_DEBT));
      await expect(page.getByTestId("liability-detail-direction")).toHaveText("They owe you");

      const paid = await accept(page, ground.cross, d.team, paymentId, ground.crossAccountName);
      const debtor = await pageOf(browser, d.user, d.team);

      await test.step("then: payment accepted", async () => {
        await acceptedOnTheirs(page, d.team, paid, ground.crossAccount, crossUser(r.key));
        await acceptedOnMine(debtor, ground.cross, paymentId);
      });

      await test.step("then: liability balance decreases by payment", async () => {
        await openPair(page, d.team);
        await pairReads(page, 0, "Square");
        const entry = await ledgerEntry(page, d.team, paymentId);
        await expect.soft(entry).toHaveCount(1);
        await expect.soft(entry).toContainText(rp(CROSS_DEBT));

        await openPair(debtor, ground.cross);
        await pairReads(debtor, 0, "Square");
        expect.soft(await debtTo(debtor, d.team, ground.cross)).toBe(0);
      });

      await debtor.close();
    });
  }
});

import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── reject payment — the checks behind docs/acceptances/balance/payment.md ─────────────────────────────────────────────
//
// reject payment's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then, run as EVERY role the
// given names (status-is-per-then). The rows' statuses are the owner's, set by hand — never by this file.
//
// Business rules (docs/business/balance/context_decision.md):
// - the-debtor-claims-the-creditor-decides — the team that is OWED decides; `reject` is terminal and posts NOTHING: no
//   ledger entry, no account row, and the pair balance is what it was. The CREDITOR is the scope of the reject.
// - a rejected claim is history, not a deletion — the row stays, marked rejected, with the creditor's reason, which
//   the payer must be able to read; a rejected payment is not reopened — the payer records a NEW one.
// - warehouse-roles-count-as-their-own-team — a selling team refuses a payment through the same flow;
//   the-cross-markup-belongs-to-the-product — a borrowed product's fee is owed to (and paid to) the team that lent it.
//
// The WHEN, as the person does it: the creditor's /liability/<payer> page → Their payments → Reject on the pending row →
// the reason typed (required) → Reject Payment. The payment itself is recorded beforehand (the given's "pending"),
// through the API.
//
// GROUND (beforeAll, as root, through the API) — every given and role its own paying team, so no balance read here is
// moved by another test:
//   warehouse W (PJW…, a warehouse:owner and a warehouse:admin user, one operational account);
//   per warehouse role, a selling team j owing W a courier's Rp 50.000 — a restock accepted with the courier paid at
//   the door, *Restock Accepted* pushed to liability as the broker would — and its pending payment of Rp 50.000, while
//   (the given) only Rp 45.000 reached W;
//   cross team X (PJX…, a selling:owner and a selling:admin user, one operational account) and, per selling role, a team
//   d owing X Rp 24.000 product fee — two units of X's borrowed product (20% markup on Rp 10.000) ordered at warehouse
//   WX (PJV…) by root — and d's pending payment of it, its proof (the given) unreadable.
//   Every team pays from its OWN operational account.
//
// Where each then is read:
// - `payment rejected` — the creditor's Their payments: the row reads Rejected and offers no Accept / Reject any more;
//   the server lists it REJECTED with the reason, never confirmed by anybody and into no account; the payer's My
//   payments reads Rejected too, with no Cancel.
// - `reason shown to selling team` / `reason shown to the other selling team` — the payer's own My payments: the row
//   carries the reason the creditor typed, word for word.
// - `liability balance unchanged` — the pair balance on the creditor's page and the payer's, before and after, the
//   server's position, and no `Payment #<id>` entry on either side's ledger.
// - `selling team's account unchanged` — the payer's account balance before and after, and no `Team payment #<id>` row
//   on it (W's account did not move either).
// - `selling team can make a new payment` — the payer's page still offers Make Payment; a new payment of the debt,
//   made through it with its proof, is recorded as pending beside the rejected one, and W sees it to accept.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-payrej-pass-1";
// What a paying team owes W: the courier's charge at the door — and what its claim says it paid.
const DEBT = 50_000;
// The borrowed product: Rp 10.000 a unit + 20% markup, two units.
const CROSS_MARKUP_BPS = 2_000;
const CROSS_DEBT = 24_000;
// The creditors' reasons — what the payer must be able to read.
const WRONG_AMOUNT = "only Rp 45.000 reached our account, not Rp 50.000";
const UNREADABLE = "the transfer slip cannot be read, please send a clear photo";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SELLING = [
  { key: "own", code: "O", given: "selling:owner", role: "ROLE_SELLING_OWNER" },
  { key: "adm", code: "A", given: "selling:admin", role: "ROLE_SELLING_ADMIN" },
] as const;
const WAREHOUSE = [
  { key: "own", code: "O", given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER" },
  { key: "adm", code: "A", given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN" },
] as const;

const user = (tag: string) => `e2epj${tag}${SUFFIX}`;
const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
// The warehouse's person for a warehouse role; the cross team's for a selling role.
const whUser = (key: string) => user(key === "own" ? "who" : "wha");
const crossUser = (key: string) => user(key === "own" ? "xo" : "xa");

interface Payer {
  team: string;
  name: string;
  account: string;
  accountName: string;
  // the paying team's person: the one who reads its side
  user: string;
}

const ground = {
  wh: "",
  whName: `E2E PayReject WH ${SUFFIX}`,
  whAccount: "",
  cross: "",
  crossName: `E2E PayReject Cross ${SUFFIX}`,
  crossAccount: "",
  // keyed `<given letter><role key>` — `jown`, `dadm`, …
  teams: {} as Record<string, Payer>,
  // the pending payment of each team above, by the same key
  payments: {} as Record<string, string>,
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

// Every payment of the pair, as `teamId` lists it.
async function paymentsOn(page: Page, teamId: string, counterpartyId: string): Promise<Record<string, any>[]> {
  const res = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentList", {
    teamId,
    filter: { counterpartyId },
    page: { page: 1, limit: 50 },
  });
  const map = (res.items as { payment?: { mapData: Record<string, Record<string, any>> } }[]).find((it) => it.payment)
    ?.payment?.mapData;

  return Object.values(map ?? {});
}

// One payment of the pair, as `teamId` lists it.
async function paymentOn(page: Page, teamId: string, counterpartyId: string, id: string): Promise<Record<string, any>> {
  const found = (await paymentsOn(page, teamId, counterpartyId)).find((p) => String(p.id) === id);
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

const isReject = (url: string) => url.endsWith("/warehouse.liability.v1.LiabilityPaymentService/LiabilityPaymentReject");

// THE WHEN — the creditor refuses the pending payment: Their payments → Reject → the reason → Reject Payment. Returns the
// payment as the server then lists it.
async function reject(page: Page, creditorTeam: string, payerTeam: string, paymentId: string, reason: string) {
  const theirs = await openTheirs(page, payerTeam);
  await expect(theirs.getByTestId(`liability-detail-payment-status-${paymentId}`)).toHaveText("Pending");
  await theirs.getByTestId(`liability-detail-reject-${paymentId}`).click();

  // The reason is required: Reject Payment waits for it.
  const submit = page.getByTestId("liability-detail-reject-submit");
  await expect(submit).toBeDisabled();
  await page.getByTestId("liability-detail-reject-reason").fill(reason);
  await expect(submit).toBeEnabled();

  const answer = page.waitForResponse((r) => isReject(r.url()));
  await submit.click();
  expect((await answer).status()).toBe(200);
  await expect(submit).toBeHidden();

  return paymentOn(page, creditorTeam, payerTeam, paymentId);
}

// `payment rejected`, on the creditor's Their payments and the server's record: refused with the reason, accepted by
// nobody, into no account.
async function rejectedOnTheirs(page: Page, payerTeam: string, refused: Record<string, any>, reason: string) {
  expect.soft(refused.status).toBe("LIABILITY_PAYMENT_STATUS_REJECTED");
  expect.soft(refused.reason).toBe(reason);
  expect.soft(Number(refused.confirmedBy ?? 0)).toBe(0);
  expect.soft(Number(refused.toAccountId ?? 0)).toBe(0);

  const theirs = await openTheirs(page, payerTeam);
  await expect.soft(theirs.getByTestId(`liability-detail-payment-status-${refused.id}`)).toHaveText("Rejected");
  await expect.soft(theirs.getByTestId(`liability-detail-confirm-${refused.id}`)).toHaveCount(0);
  await expect.soft(theirs.getByTestId(`liability-detail-reject-${refused.id}`)).toHaveCount(0);
}

// …and on the payer's My payments: Rejected, nothing left to take back.
async function rejectedOnMine(page: Page, creditorTeam: string, paymentId: string) {
  const mine = await openMine(page, creditorTeam);
  await expect.soft(mine.getByTestId(`liability-detail-payment-status-${paymentId}`)).toHaveText("Rejected");
  await expect.soft(mine.getByTestId(`liability-detail-cancel-${paymentId}`)).toHaveCount(0);
}

// `reason shown to …` — the payer's own My payments carries the creditor's words.
async function reasonOnMine(page: Page, creditorTeam: string, paymentId: string, reason: string) {
  const mine = await openMine(page, creditorTeam);
  await expect.soft(mine.getByTestId(`liability-detail-reason-${paymentId}`)).toHaveText(reason);
}

// The payment's entries on a pair's ledger (All).
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

// Make Payment on the payer's open pair page: the amount, Paid from (the team's one operational account, pre-picked),
// a note, the proof attached. Returns the payment the server then lists, the one that was not there before.
async function makePayment(page: Page, payer: Payer, creditor: string, amount: number, note: string) {
  const mine = async () => (await paymentsOn(page, payer.team, creditor)).filter((p) => String(p.payerTeamId) === payer.team);
  const before = new Set((await mine()).map((p) => String(p.id)));

  await page.getByTestId("liability-detail-make-payment").click();
  await page.getByTestId("record-amount").fill(String(amount));
  await expect(page.getByTestId("record-from-account")).toContainText(payer.accountName);
  await page.getByTestId("record-note").fill(note);
  await page.getByTestId("record-proof-input").setInputFiles({
    name: "transfer.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG, "base64"),
  });
  await expect(page.getByTestId("record-proof-list")).toBeVisible();
  await expect(page.getByTestId("record-submit")).toBeEnabled();
  await page.getByTestId("record-submit").click();
  await expect(page.getByTestId("record-submit")).toBeHidden();

  let made: Record<string, any> | undefined;
  await expect
    .poll(async () => {
      made = (await mine()).find((p) => !before.has(String(p.id)));

      return made !== undefined;
    })
    .toBe(true);

  return made!;
}

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ browser, request }) => {
  test.setTimeout(420_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const member = async (teamId: string, username: string, role: string) => {
    await ok(page, "user.v1.UserService/CreateUser", {
      teamId,
      username,
      password: PASSWORD,
      name: `PayReject ${username}`,
      role,
    });
  };
  const account = async (teamId: string, tag: string) => {
    const name = `E2E PayReject ${tag} BCA ${SUFFIX}`;
    const id = String(
      (
        await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name,
          holderName: "PT E2E",
          accountNumber: `E2E-PYJ-${tag}-${SUFFIX}`,
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

  // A selling team with its person and its operational account.
  const payer = async (letter: string, code: string, role: string): Promise<Payer> => {
    const name = `E2E PayReject ${letter.toUpperCase()}${code} ${SUFFIX}`;
    const id = await team(name, `PJ${letter.toUpperCase()}${code}${SUFFIX}`, "TEAM_TYPE_SELLING");
    const username = user(`${letter}${code.toLowerCase()}`);
    await member(id, username, role);
    const acc = await account(id, `${letter.toUpperCase()}${code}`);

    return { team: id, name, account: acc.id, accountName: acc.name, user: username };
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

  // ── W, its two people, its operational account.
  ground.wh = await team(ground.whName, `PJW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await member(ground.wh, user("who"), "ROLE_WAREHOUSE_OWNER");
  await member(ground.wh, user("wha"), "ROLE_WAREHOUSE_ADMIN");
  ground.whAccount = (await account(ground.wh, "W")).id;
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.wh, code: `pj-${SUFFIX}` })).rack.id);
  const category = String((await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E PayReject ${SUFFIX}` })).category.id);

  // ── per warehouse role: a team j owing W the courier's Rp 50.000 at the door — a restock counted in, *Restock
  // Accepted* pushed to liability — and its claim of Rp 50.000, pending.
  for (const r of WAREHOUSE) {
    const p = await payer("j", r.code, "ROLE_SELLING_OWNER");
    ground.teams[`j${r.key}`] = p;

    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId: p.team,
        productCodePart: `PJJ${r.code}P${SUFFIX}`,
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
    const res = await request.post(`${API_URL}/event/liability-restock-accepted/push`, {
      data: pushRestockAccepted(accepted.request),
    });
    expect(res.status()).toBe(200);
    await expect.poll(() => totalPayable(page, p.team), { timeout: 20_000 }).toBe(DEBT);

    ground.payments[`j${r.key}`] = await pending(p.team, ground.wh, p.account, DEBT, "transfer BCA, the whole Rp 50.000");
  }

  // ── the product-fee pairs: X lends its product; per selling role a team d orders 2 units of it at WX, and pays.
  ground.cross = await team(ground.crossName, `PJX${SUFFIX}`, "TEAM_TYPE_SELLING");
  await member(ground.cross, user("xo"), "ROLE_SELLING_OWNER");
  await member(ground.cross, user("xa"), "ROLE_SELLING_ADMIN");
  ground.crossAccount = (await account(ground.cross, "X")).id;
  const wx = await team(`E2E PayReject WX ${SUFFIX}`, `PJV${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const wxRack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: wx, code: `pjx-${SUFFIX}` })).rack.id);
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
  const crossCode = `PJXP${SUFFIX}`;
  const crossProduct = await product(ground.cross, crossCode, true);
  const supplier = String(
    (await ok(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.cross, name: `E2E PayReject Supplier ${SUFFIX}` }))
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
    const own = await product(d.team, `PJM${r.code}${SUFFIX}`, false);
    await ok(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
      teamId: d.team,
      sharedProductId: crossProduct,
      ownProductId: own,
    });
    const shop = String(
      (
        await ok(page, "selling.v1.ShopService/ShopCreate", {
          teamId: d.team,
          name: `E2E PayReject Shop D${r.code} ${SUFFIX}`,
          shopCode: `PJT${i + 1}${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-pj-${SUFFIX}-x${r.key}`,
      shipmentChannelId: "1",
      teamId: d.team,
      shopId: shop,
      warehouseId: wx,
      customerName: `E2E PayReject Buyer ${r.key}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `PJ${SUFFIX}X${r.code}`,
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

test.describe("warehouse:owner · warehouse:admin wants to refuse a wrong payment (pending · amount does not match transfer · reason)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} reject payment`, async ({ page, browser }) => {
      const t = ground.teams[`j${r.key}`]!;
      const paymentId = ground.payments[`j${r.key}`]!;
      await signIn(page, whUser(r.key), PASSWORD);
      await useTeam(page, ground.wh);
      const seller = await pageOf(browser, t.user, t.team);

      // THE GIVEN, on W's page: the team owes Rp 50.000 and its claim of Rp 50.000 is pending — only Rp 45.000 arrived.
      await openPair(page, t.team);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));
      await expect(page.getByTestId("liability-detail-direction")).toHaveText("They owe you");
      const whBefore = await accountBalance(page, ground.wh, ground.whAccount);
      const sellerBefore = await accountBalance(seller, t.team, t.account);

      const refused = await reject(page, ground.wh, t.team, paymentId, WRONG_AMOUNT);

      await test.step("then: payment rejected", async () => {
        await rejectedOnTheirs(page, t.team, refused, WRONG_AMOUNT);
        await rejectedOnMine(seller, ground.wh, paymentId);
      });

      await test.step("then: reason shown to selling team", async () => {
        await reasonOnMine(seller, ground.wh, paymentId, WRONG_AMOUNT);
      });

      await test.step("then: liability balance unchanged", async () => {
        await openPair(page, t.team);
        await pairReads(page, DEBT, "They owe you");
        expect.soft(await balanceWith(page, ground.wh, t.team)).toBe(DEBT);
        await expect.soft(await ledgerEntry(page, t.team, paymentId)).toHaveCount(0);

        // …and on the payer's side of the pair.
        await openPair(seller, ground.wh);
        await pairReads(seller, DEBT, "You owe them");
        expect.soft(await totalPayable(seller, t.team)).toBe(DEBT);
        expect.soft(await debtTo(seller, t.team, ground.wh)).toBe(DEBT);
        await expect.soft(await ledgerEntry(seller, ground.wh, paymentId)).toHaveCount(0);
      });

      await test.step("then: selling team's account unchanged", async () => {
        expect.soft(await accountBalance(seller, t.team, t.account)).toBe(sellerBefore);
        await expect.soft(await accountRow(seller, t.account, `Team payment #${paymentId}`)).toHaveCount(0);
        // Nothing landed on W's side either: the money never moved.
        expect.soft(await accountBalance(page, ground.wh, ground.whAccount)).toBe(whBefore);
      });

      await test.step("then: selling team can make a new payment", async () => {
        // Still the debtor of the whole Rp 50.000, so still offered Make Payment — a new claim, not the old one reopened.
        await openPair(seller, ground.wh);
        await expect(seller.getByTestId("liability-detail-make-payment")).toBeVisible();
        const again = await makePayment(seller, t, ground.wh, DEBT, "transfer BCA, sent again in full");
        expect.soft(String(again.id)).not.toBe(paymentId);
        expect.soft(again.status).toBe("LIABILITY_PAYMENT_STATUS_RECORDED");
        expect.soft(Number(again.amount)).toBe(DEBT);

        // The payer's My payments: the new claim pending beside the rejected one, which stays.
        const mine = await openMine(seller, ground.wh);
        await expect.soft(mine.getByTestId(`liability-detail-payment-status-${again.id}`)).toHaveText("Pending");
        await expect.soft(mine.getByTestId(`liability-detail-payment-status-${paymentId}`)).toHaveText("Rejected");

        // W sees the new one to decide on.
        const theirs = await openTheirs(page, t.team);
        await expect.soft(theirs.getByTestId(`liability-detail-payment-status-${again.id}`)).toHaveText("Pending");
        await expect.soft(theirs.getByTestId(`liability-detail-confirm-${again.id}`)).toBeVisible();
      });

      await seller.close();
    });
  }
});

test.describe("selling:owner · selling:admin wants to refuse a wrong payment (pending · from another selling team · proof unreadable · reason)", () => {
  for (const r of SELLING) {
    test(`${r.given} reject payment`, async ({ page, browser }) => {
      const d = ground.teams[`d${r.key}`]!;
      const paymentId = ground.payments[`d${r.key}`]!;
      await signIn(page, crossUser(r.key), PASSWORD);
      await useTeam(page, ground.cross);

      // THE GIVEN, on X's page: team d owes it the lent product's Rp 24.000, and d's payment of it is pending — its slip
      // cannot be read.
      await openPair(page, d.team);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(CROSS_DEBT));
      await expect(page.getByTestId("liability-detail-direction")).toHaveText("They owe you");

      const refused = await reject(page, ground.cross, d.team, paymentId, UNREADABLE);
      const debtor = await pageOf(browser, d.user, d.team);

      await test.step("then: payment rejected", async () => {
        await rejectedOnTheirs(page, d.team, refused, UNREADABLE);
        await rejectedOnMine(debtor, ground.cross, paymentId);
      });

      await test.step("then: reason shown to the other selling team", async () => {
        await reasonOnMine(debtor, ground.cross, paymentId, UNREADABLE);
      });

      await debtor.close();
    });
  }
});

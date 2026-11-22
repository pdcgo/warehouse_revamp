import { expect, test } from "@playwright/test";
import type { Locator, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── open liability pair — the checks behind docs/acceptances/balance/position.md (the pair) ─────────────────────────
//
// open liability pair's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the
// checks for its thens live here, one test.describe per given + when, one test.step("then: …") per then, run as EVERY
// role the given names (status-is-per-then). The rows' statuses are set from the tester's green results, or by the owner.
//
// The WHEN, as the person does it: Liability › a counterparty's row → its pair page (`/liability/:counterpartyId`) —
// the net position card with its two gross sides, and the All tab (first and the default): the pair's whole running
// ledger, newest first, each entry with What caused it · Recorded by · Amount · Balance after.
//
// Business rules:
// - the-grain-is-the-team-pair, balance-manages-reports-and-takes-payments (docs/business/balance/context_decision.md) —
//   one signed balance per pair, direction in WORDS ("You owe them" / "They owe you"), never a sign.
// - the-ledger-speaks-the-business-words — each entry says what caused it ("Order fee · order #N", "Payment #N").
// - the-order-fee-posts-at-creation-and-reverses-on-cancel — a cancel posts the opposite entry; both stay on the books,
//   and the reversal is LABELLED, not left to be read from a sign.
// - every-entry-names-who-posted-it, the-team-balance-recorded-by-is-accepted (docs/technical/balance/
//   team_balance_design_decision.md) — the person whose act moved the money: the order's placer for its fee, the
//   creditor's person who accepted a payment for the payment, named like any other when they are of the other team.
// - the-team-balance-screens-are-accepted — the All tab runs in order with Balance after on every row.
//
// GROUND (beforeAll, as root through the API, plus two named people per side who act with their own token) — one team
// per side, read by both its roles (nothing here writes):
//   selling team PS (LPS…; a selling:owner, a selling:admin, and a selling:admin clerk who places the given-12 order):
//     - owes warehouse PA (LPA…) Rp 300.000: the courier's charge at PA's door for PS's restock (given 11);
//     - with warehouse PB (LPB…): the clerk's order of one unit at PB (landed Rp 50.000, PB's fee 10% → an order fee of
//       Rp 5.000), then PS's payment of Rp 300.000, accepted by PB's own admin (given 12) — PB owes PS Rp 295.000;
//     - with warehouse PC (LPC…): an order of one unit at PC (fee Rp 5.000), then cancelled (given 13) — square.
//   warehouse team PW (LPW…; a warehouse:owner, a warehouse:admin, and a warehouse:admin clerk who accepts payments):
//     - owes selling team PD (LPD…) Rp 300.000: PD owed PW a courier's Rp 50.000, paid Rp 350.000, PW accepted it
//       (given 11 — a warehouse owes only what a seller overpaid: every posting's debtor is a selling team);
//     - with selling team PE (LPE…): PE's clerk orders one unit at PW (PW's fee 10% → Rp 5.000 owed to PW), then PE pays
//       Rp 300.000 and PW's clerk accepts it (given 12) — PW owes PE Rp 295.000;
//     - with selling team PF (LPF…): an order of one unit at PW (fee Rp 5.000), then cancelled (given 13) — square.
//
// Where each then is read (the role's own pair page, desktop):
// - `net position Rp 300.000, "you owe them"` — the Net position card: `liability-detail-balance` "Rp 300.000" and its
//   line `liability-detail-direction` "You owe them".
// - `payable Rp 300.000` — the Payable card's figure (`liability-detail-payable-card-value`); the Receivable card reads
//   Rp 0 beside it.
// - `each entry with what caused it, who recorded it and its amount` — the All tab holds the pair's two entries: the
//   order fee ("Order fee · order #N", the clerk who placed the order, Rp 5.000 — a minus for the seller, a plus for
//   the warehouse) and the payment ("Payment #N", the creditor's person who accepted it, Rp 300.000 the other way).
// - `balance after runs row to row` — newest first, every row's Balance after is the one below it plus its own Amount,
//   the first entry's is its own amount (the pair started at zero), and the top one is the net position.
// - `reversal labelled` — the cancelled order's two entries, both "Order fee · order #N": the newer one carries the
//   Reversal badge and the opposite amount, the original carries none.
//
// filter liability history (givens 14–15) — the same page, narrowed: its Receivable tab, and the date range above the
// tabs (`liability-detail-range`, picked on its calendar and applied, as a person does). Both are the SERVER's cuts
// (backlog #34): each check first waits for the LiabilityLogList read that carries the cut, then reads the rows. Both
// read given 12's pair, whose two entries run both ways (nothing here writes):
// - `only what they owe us listed` — the Receivable tab (`"direction":"LIABILITY_LOG_DIRECTION_RECEIVABLE"`) holds only
//   the entry that moved the pair toward them owing us: the order fee for the warehouse (+Rp 5.000 — the seller owes
//   it), the seller's own payment for the seller (+Rp 300.000 — it paid past the fee, so the warehouse owes it the
//   rest; a warehouse owes a seller only what it overpaid). The other entry is not on it; a regression step finds it on
//   Payable.
// - `only that week's entries` — no RPC back-dates an entry (each is stamped when it is posted), so the given's October
//   and November entries cannot be seeded: the run's own entries all carry today's Jakarta day. The check proves the
//   week on that day's edges instead: the week ENDING on it lists every entry of the pair (each one's day, from the
//   screen's own answer, inside the week), and the week before it (ending the day before) lists none — the empty line,
//   no row — though the pair holds them.
// - `net position still the whole pair's` — with that empty week in force, the Net position card still reads the pair's
//   Rp 295.000 and its direction, and both narrowed answers carry the whole pair's balance.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-liabpair-pass-1";
const OWE = 300_000;
// Given 12's order: 10 units restocked for Rp 500.000 (Rp 50.000 landed a unit), the warehouse's fee 10% of one unit.
const UNITS = 10;
const RESTOCK_TOTAL = 500_000;
const FEE = 5_000;
const PAYMENT = 300_000;
// Given 11 on W's side: PD owed W the courier's Rp 50.000 and paid Rp 350.000.
const PD_OWED = 50_000;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Side = "selling" | "warehouse";
const ROLES = [
  { key: "so", given: "selling:owner", role: "ROLE_SELLING_OWNER", side: "selling" },
  { key: "sa", given: "selling:admin", role: "ROLE_SELLING_ADMIN", side: "selling" },
  { key: "wo", given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", side: "warehouse" },
  { key: "wa", given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", side: "warehouse" },
] as const;
const MANAGERS = "selling:owner · selling:admin · warehouse:owner · warehouse:admin";

const user = (key: string) => `e2elp${key}${SUFFIX}`;
const personName = (key: string) => `LiabPair ${key} ${SUFFIX}`;
const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
const signed = (n: number) => `${n < 0 ? "−" : "+"}${rp(Math.abs(n))}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// A figure as the ledger prints it — "−Rp 5.000", "+Rp 300.000", "Rp 295.000" — back as a number.
function money(text: string | null): number {
  const t = (text ?? "").trim();
  const m = /^([+−-]?)Rp ([\d.]+)(?:,(\d+))?$/.exec(t);
  if (!m) throw new Error(`not a rupiah figure: "${t}"`);
  const n = Number(m[2]!.replace(/\./g, "")) + (m[3] ? Number(`0.${m[3]}`) : 0);

  return m[1] === "−" || m[1] === "-" ? -n : n;
}

interface Order {
  team: string;
  shop: string;
  warehouse: string;
  productId: string;
  productCode: string;
}

interface Ground {
  // the role's own team
  team: string;
  name: string;
  // given 11 — the team it owes Rp 300.000
  owe: string;
  oweName: string;
  // given 12 — the pair with an order fee and an accepted payment
  paid: string;
  paidName: string;
  feeOrder: string;
  feeBy: string;
  payment: string;
  paymentBy: string;
  // given 13 — the pair whose order was cancelled
  rev: string;
  revName: string;
  revOrder: string;
  // which way the order fee runs for this team: −1 the team owes it (selling), +1 it is owed (warehouse)
  feeSign: 1 | -1;
}

const blank = (feeSign: 1 | -1): Ground => ({
  team: "",
  name: "",
  owe: "",
  oweName: "",
  paid: "",
  paidName: "",
  feeOrder: "",
  feeBy: "",
  payment: "",
  paymentBy: "",
  rev: "",
  revName: "",
  revOrder: "",
  feeSign,
});
const ground: Record<Side, Ground> = { selling: blank(-1), warehouse: blank(1) };

// An RPC — the status and the JSON body, never thrown. Under the page's signed-in person, or under `token` when given
// (a named person acting with their own sign-in).
async function call(page: Page, method: string, body: unknown, token?: string) {
  return page.evaluate(
    async ([m, b, apiUrl, own]) => {
      const t =
        (own as string) ||
        window.sessionStorage.getItem("warehouse_revamp.token") ||
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
    },
    [method, body, API_URL, token ?? ""] as const,
  );
}

// A call that must succeed — its JSON body.
async function ok<T = any>(page: Page, method: string, body: unknown, token?: string): Promise<T> {
  const res = await call(page, method, body, token);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// The team's balance with ONE counterparty, by the server — positive: they owe the team; negative: the team owes.
async function balanceWith(page: Page, teamId: string, counterpartyId: string) {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", {
    teamId,
    filter: { counterpartyId },
    page: { page: 1, limit: 50 },
  });
  const out: Record<string, Record<string, any>> = {};
  for (const item of (res.items ?? []) as { position?: { mapData?: Record<string, Record<string, any>> } }[]) {
    Object.assign(out, item.position?.mapData ?? {});
  }

  return Number(out[counterpartyId]?.balance ?? 0) + 0;
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

// One unit of the order ground's product — `tag` makes its Order ID and its key its own.
const orderBody = (o: Order, tag: string) => ({
  idempotencyKey: `e2e-lp-${SUFFIX}-${tag}`,
  shipmentChannelId: "1",
  teamId: o.team,
  shopId: o.shop,
  warehouseId: o.warehouse,
  customerName: `E2E LiabPair Buyer ${tag}`,
  platformTotal: 150_000,
  platformCreatedAtUnix: Math.floor(Date.now() / 1000),
  orderExternalRefId: `LP${SUFFIX}${tag.toUpperCase()}`,
  items: [{ productId: o.productId, productCode: o.productCode, name: `E2E ${o.productCode}`, quantity: 1 }],
});

// The role's person, signed in through the form, working in its team.
async function signInAs(page: Page, key: string, side: Side) {
  await signIn(page, user(key), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground[side].team);
}

// The pair page, loaded on its All tab: the header names the counterparty and the ledger has drawn `entries` rows.
async function openPair(page: Page, counterparty: string, name: string, entries: number) {
  await page.goto(`/liability/${counterparty}`);
  await expect(page.getByTestId("liability-detail-page")).toBeVisible();
  await expect(page.getByTestId("liability-detail-header")).toContainText(name);
  await expect(page.getByTestId("liability-detail-tab-all")).toHaveAttribute("aria-selected", "true");
  await expect(rowsOf(page)).toHaveCount(entries);
}

// The All tab's entries, in the order drawn (newest first).
const rowsOf = (page: Page) => page.getByTestId("liability-detail-all").locator('[data-testid^="liability-detail-entry-"]');
// One order's entries on the All tab.
const orderRows = (page: Page, orderId: string) =>
  rowsOf(page).filter({ hasText: new RegExp(`order #${orderId}(?!\\d)`) });
// A desktop entry's cells: When · What caused it · Recorded by · Amount · Balance after.
const cells = (row: Locator) => row.locator("td");
// One payment's entry on the All tab.
const paymentRows = (page: Page, paymentId: string) =>
  rowsOf(page).filter({ hasText: new RegExp(`Payment #${paymentId}(?!\\d)`) });

// A Jakarta day, `yyyy-mm-dd` — of a unix second, or `days` on from another day (arithmetic on the label, no zone).
const jakartaDayOf = (unix: number) => new Date(unix * 1000 + 7 * 3_600_000).toISOString().slice(0, 10);
const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// A ledger read as the server answered the screen: the entries' ids in order, each one's Jakarta day, the pair balance.
async function ledgerAnswer(res: Response) {
  const body = (await res.json()) as {
    ids?: string[];
    balance?: number;
    items?: { log?: { mapData?: Record<string, { createdAtUnix?: string }> } }[];
  };
  const days: Record<string, string> = {};
  for (const item of body.items ?? []) {
    for (const [id, e] of Object.entries(item.log?.mapData ?? {})) days[id] = jakartaDayOf(Number(e.createdAtUnix ?? 0));
  }

  return { ids: (body.ids ?? []).map(String), days, balance: Number(body.balance ?? 0) + 0 };
}

// The pair's ledger read whose body carries `has` and none of `hasNot` — set up BEFORE the act that sends it.
const ledgerRead = (page: Page, has: string[], hasNot: string[] = []) =>
  page.waitForResponse((res) => {
    if (!res.url().includes("LiabilityLogList")) return false;
    const body = res.request().postData() ?? "";

    return has.every((s) => body.includes(s)) && !hasNot.some((s) => body.includes(s));
  });

// The history's date range, picked as a person does: open the picker, click the two days on its month grid (paging
// the month when a day is not drawn — back first, then forward), Apply. Resolves with the server's narrowed answer.
async function pickRange(page: Page, counterparty: string, from: string, to: string) {
  const answered = ledgerRead(page, [`"counterpartyId":"${counterparty}"`, `"from":"${from}"`, `"to":"${to}"`]);
  await page.getByTestId("liability-detail-range").click();
  await expect(page.getByTestId("liability-detail-range-panel")).toBeVisible();
  for (const day of [to, from]) {
    const cell = page.getByTestId(`liability-detail-range-day-${day}`);
    for (const [step, times] of [["prev", 2], ["next", 4]] as const) {
      for (let i = 0; i < times && (await cell.count()) === 0; i++) {
        await page.getByTestId(`liability-detail-range-${step}`).click();
      }
    }
    await cell.click();
  }
  await page.getByTestId("liability-detail-range-apply").click();

  return ledgerAnswer(await answered);
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser, request }) => {
  test.setTimeout(480_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const member = async (teamId: string, key: string, role: string) => {
    await ok(page, "user.v1.UserService/CreateUser", {
      teamId,
      username: user(key),
      password: PASSWORD,
      name: personName(key),
      role,
    });
  };
  // A named person's own sign-in, to act as them through the API.
  const tokenOf = async (key: string) =>
    String((await ok(page, "user.v1.AuthService/Login", { username: user(key), password: PASSWORD })).token);
  const account = async (teamId: string, tag: string) => {
    const id = String(
      (
        await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E LiabPair ${tag} BCA ${SUFFIX}`,
          holderName: "PT E2E",
          accountNumber: `E2E-LQP-${tag}-${SUFFIX}`,
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

    return id;
  };
  // A warehouse with its rack and a fee of 10% of the goods (no floor).
  const warehouse = async (name: string, code: string) => {
    const id = await team(name, code, "TEAM_TYPE_WAREHOUSE");
    const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: id, code: code.toLowerCase() })).rack.id);
    await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: id, feePercent: 10, minFee: 0 });

    return { id, rack };
  };
  const category = String((await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E LiabPair ${SUFFIX}` })).category.id);
  const productOf = async (teamId: string, codePart: string) => {
    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId,
        productCodePart: codePart,
        name: `E2E ${codePart}`,
        categoryId: category,
      })
    ).product;

    return { id: String(product.id), code: String(product.productCode) };
  };
  const shopOf = async (teamId: string, name: string, shopCode: string) =>
    String((await ok(page, "selling.v1.ShopService/ShopCreate", { teamId, name, shopCode, marketplace: "MARKETPLACE_SHOPEE" })).shop.id);
  // A restock counted in at the warehouse's door; a courier's `cod` paid there is pushed to liability as *Restock
  // Accepted* (nothing is posted for 0).
  const restock = async (
    teamId: string,
    fromAccount: string,
    w: { id: string; rack: string },
    product: { id: string; code: string },
    count: number,
    total: number,
    cod: number,
  ) => {
    const created = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId,
      warehouseId: w.id,
      financeAccountId: fromAccount,
      items: [{ productId: product.id, productCode: product.code, name: `E2E ${product.code}`, count, total }],
    });
    const accepted = await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: w.id,
      requestId: created.request.id,
      ...(cod > 0 ? { warehouseAdditionalCost: cod, warehouseAdditionalCostNote: "courier asked at the door" } : {}),
      lines: (created.request.items as { id: string; count: string }[]).map((item) => ({
        itemId: item.id,
        receivedCount: item.count,
        placements: [{ placementId: w.rack, quantity: item.count }],
      })),
    });
    if (cod > 0) {
      const res = await request.post(`${API_URL}/event/liability-restock-accepted/push`, {
        data: pushRestockAccepted(accepted.request),
      });
      expect(res.status()).toBe(200);
    }
  };
  // A selling team ready to order its own product at warehouse `w`: stock there, a return warehouse, a shop.
  const orderGround = async (seller: string, fromAccount: string, w: { id: string; rack: string }, tag: string) => {
    const product = await productOf(seller, `LPP${tag}${SUFFIX}`);
    await restock(seller, fromAccount, w, product, UNITS, RESTOCK_TOTAL, 0);
    await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: seller, warehouseId: w.id });

    return {
      team: seller,
      shop: await shopOf(seller, `E2E LiabPair Shop ${tag} ${SUFFIX}`, `LPT${tag}${SUFFIX}`),
      warehouse: w.id,
      productId: product.id,
      productCode: product.code,
    } satisfies Order;
  };
  // A payment recorded by root for the payer (its proof shared with the creditor), accepted by `confirmer`'s token.
  const pay = async (payer: string, creditor: string, fromAccountId: string, toAccountId: string, amount: number, confirmer?: string) => {
    const proof = await uploadProof(page, payer, creditor);
    const recorded = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
      teamId: payer,
      creditorTeamId: creditor,
      amount: String(amount),
      note: "e2e acceptance: open liability pair",
      documentIds: [proof],
      fromAccountId,
    });
    const id = String(recorded.payment.id);
    await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", { teamId: creditor, paymentId: id, toAccountId }, confirmer);

    return id;
  };
  // An order placed (by `token`'s person, else root), its fee polled onto the pair from `reader`'s side.
  const placeOrder = async (o: Order, tag: string, reader: string, other: string, feeSign: number, token?: string) => {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", orderBody(o, tag), token);
    await expect.poll(() => balanceWith(page, reader, other), { timeout: 60_000 }).toBe(feeSign * FEE);

    return String(placed.order.id);
  };
  // The order cancelled by root and its fee's reversal polled in (the pair square again).
  const cancelOrder = async (o: Order, orderId: string, reader: string, other: string) => {
    await ok(page, "selling.v1.OrderService/OrderCancel", { teamId: o.team, orderId });
    await expect.poll(() => balanceWith(page, reader, other), { timeout: 60_000 }).toBe(0);
  };

  // ── the selling side ─────────────────────────────────────────────────────────────────────────────────────────────
  const S = ground.selling;
  S.name = `E2E LiabPair Seller ${SUFFIX}`;
  S.team = await team(S.name, `LPS${SUFFIX}`, "TEAM_TYPE_SELLING");
  for (const r of ROLES.filter((r) => r.side === "selling")) await member(S.team, r.key, r.role);
  await member(S.team, "sx", "ROLE_SELLING_ADMIN");
  const sAccount = await account(S.team, "S");

  // Given 11 — S owes warehouse PA the courier's Rp 300.000 at PA's door.
  S.oweName = `E2E LiabPair Gudang A ${SUFFIX}`;
  const pa = await warehouse(S.oweName, `LPA${SUFFIX}`);
  S.owe = pa.id;
  await restock(S.team, sAccount, pa, await productOf(S.team, `LPQ${SUFFIX}`), 2, 20_000, OWE);
  await expect.poll(() => balanceWith(page, S.team, S.owe), { timeout: 20_000 }).toBe(-OWE);

  // Given 12 — S's clerk orders one unit at PB (fee Rp 5.000); S pays Rp 300.000 and PB's admin accepts it.
  S.paidName = `E2E LiabPair Gudang B ${SUFFIX}`;
  const pb = await warehouse(S.paidName, `LPB${SUFFIX}`);
  S.paid = pb.id;
  await member(S.paid, "bx", "ROLE_WAREHOUSE_ADMIN");
  const pbAccount = await account(S.paid, "B");
  const sOrder = await orderGround(S.team, sAccount, pb, "1");
  S.feeOrder = await placeOrder(sOrder, "s1", S.team, S.paid, -1, await tokenOf("sx"));
  S.feeBy = personName("sx");
  S.payment = await pay(S.team, S.paid, sAccount, pbAccount, PAYMENT, await tokenOf("bx"));
  S.paymentBy = personName("bx");
  await expect.poll(() => balanceWith(page, S.team, S.paid), { timeout: 20_000 }).toBe(PAYMENT - FEE);

  // Given 13 — an order at PC, then cancelled: its fee and the fee's reversal.
  S.revName = `E2E LiabPair Gudang C ${SUFFIX}`;
  const pc = await warehouse(S.revName, `LPC${SUFFIX}`);
  S.rev = pc.id;
  const sRev = await orderGround(S.team, sAccount, pc, "2");
  S.revOrder = await placeOrder(sRev, "s2", S.team, S.rev, -1);
  await cancelOrder(sRev, S.revOrder, S.team, S.rev);

  // ── the warehouse side ───────────────────────────────────────────────────────────────────────────────────────────
  const W = ground.warehouse;
  W.name = `E2E LiabPair Gudang ${SUFFIX}`;
  const pw = await warehouse(W.name, `LPW${SUFFIX}`);
  W.team = pw.id;
  for (const r of ROLES.filter((r) => r.side === "warehouse")) await member(W.team, r.key, r.role);
  await member(W.team, "wx", "ROLE_WAREHOUSE_ADMIN");
  const wAccount = await account(W.team, "W");

  // Given 11 — selling team PD owed W the courier's Rp 50.000 and paid Rp 350.000: W owes PD Rp 300.000.
  W.oweName = `E2E LiabPair Seller D ${SUFFIX}`;
  W.owe = await team(W.oweName, `LPD${SUFFIX}`, "TEAM_TYPE_SELLING");
  const dAccount = await account(W.owe, "D");
  await restock(W.owe, dAccount, pw, await productOf(W.owe, `LPR${SUFFIX}`), 2, 20_000, PD_OWED);
  await expect.poll(() => balanceWith(page, W.team, W.owe), { timeout: 20_000 }).toBe(PD_OWED);
  await pay(W.owe, W.team, dAccount, wAccount, PD_OWED + OWE);
  await expect.poll(() => balanceWith(page, W.team, W.owe), { timeout: 20_000 }).toBe(-OWE);

  // Given 12 — PE's clerk orders one unit at W (fee Rp 5.000 owed to W); PE pays Rp 300.000 and W's clerk accepts it.
  W.paidName = `E2E LiabPair Seller E ${SUFFIX}`;
  W.paid = await team(W.paidName, `LPE${SUFFIX}`, "TEAM_TYPE_SELLING");
  await member(W.paid, "ex", "ROLE_SELLING_ADMIN");
  const eAccount = await account(W.paid, "E");
  const wOrder = await orderGround(W.paid, eAccount, pw, "3");
  W.feeOrder = await placeOrder(wOrder, "w1", W.team, W.paid, 1, await tokenOf("ex"));
  W.feeBy = personName("ex");
  W.payment = await pay(W.paid, W.team, eAccount, wAccount, PAYMENT, await tokenOf("wx"));
  W.paymentBy = personName("wx");
  await expect.poll(() => balanceWith(page, W.team, W.paid), { timeout: 20_000 }).toBe(FEE - PAYMENT);

  // Given 13 — selling team PF orders one unit at W, then cancels it.
  W.revName = `E2E LiabPair Seller F ${SUFFIX}`;
  W.rev = await team(W.revName, `LPF${SUFFIX}`, "TEAM_TYPE_SELLING");
  const fAccount = await account(W.rev, "F");
  const wRev = await orderGround(W.rev, fAccount, pw, "4");
  W.revOrder = await placeOrder(wRev, "w2", W.team, W.rev, 1);
  await cancelOrder(wRev, W.revOrder, W.team, W.rev);

  await page.close();
});

test.describe(`${MANAGERS} wants to see what is owed (owes warehouse A Rp 300.000)`, () => {
  for (const r of ROLES) {
    test(`${r.given} open liability pair`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openPair(page, g.owe, g.oweName, r.side === "selling" ? 1 : 2);

      await test.step('then: net position Rp 300.000, "you owe them"', async () => {
        await expect.soft(page.getByTestId("liability-detail-position")).toContainText("Net position");
        await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText(rp(OWE));
        await expect.soft(page.getByTestId("liability-detail-direction")).toHaveText("You owe them");
      });

      await test.step("then: payable Rp 300.000", async () => {
        await expect.soft(page.getByTestId("liability-detail-payable-card")).toContainText("Payable");
        await expect.soft(page.getByTestId("liability-detail-payable-card-value")).toHaveText(rp(OWE));
        // Nothing runs the other way: the Receivable card beside it is Rp 0.
        await expect.soft(page.getByTestId("liability-detail-receivable-card-value")).toHaveText(rp(0));
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (order fee Rp 5.000 · payment Rp 300.000 accepted)`, () => {
  for (const r of ROLES) {
    test(`${r.given} open liability pair`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openPair(page, g.paid, g.paidName, 2);

      await test.step("then: each entry with what caused it, who recorded it and its amount", async () => {
        const head = page.getByTestId("liability-detail-all").locator("th");
        await expect.soft(head.nth(1)).toHaveText("What caused it");
        await expect.soft(head.nth(2)).toHaveText("Recorded by");
        await expect.soft(head.nth(3)).toHaveText("Amount");

        // The order fee — caused by the order, recorded by the person who placed it, Rp 5.000 (owed by the seller).
        const fee = orderRows(page, g.feeOrder);
        await expect.soft(fee).toHaveCount(1);
        await expect.soft(cells(fee).nth(1)).toHaveText(`Order fee · order #${g.feeOrder}`);
        await expect.soft(cells(fee).nth(2)).toHaveText(g.feeBy);
        await expect.soft(cells(fee).nth(3)).toHaveText(signed(g.feeSign * FEE));

        // The payment — caused by the payment, recorded by the creditor's person who accepted it, Rp 300.000.
        const paid = rowsOf(page).filter({ hasText: new RegExp(`Payment #${g.payment}(?!\\d)`) });
        await expect.soft(paid).toHaveCount(1);
        await expect.soft(cells(paid).nth(1)).toHaveText(`Payment #${g.payment}`);
        await expect.soft(cells(paid).nth(2)).toHaveText(g.paymentBy);
        await expect.soft(cells(paid).nth(3)).toHaveText(signed(-g.feeSign * PAYMENT));
      });

      await test.step("then: balance after runs row to row", async () => {
        await expect.soft(page.getByTestId("liability-detail-all").locator("th").nth(4)).toHaveText("Balance after");
        const rows = rowsOf(page);
        const n = await rows.count();
        const amounts: number[] = [];
        const after: number[] = [];
        for (let i = 0; i < n; i++) {
          amounts.push(money(await cells(rows.nth(i)).nth(3).textContent()));
          after.push(money(await cells(rows.nth(i)).nth(4).textContent()));
        }
        // Newest first: each row's balance is the one below it plus its own movement; the pair started at zero.
        for (let i = 0; i < n - 1; i++) {
          expect.soft(after[i], `row ${i + 1}'s balance after = row ${i + 2}'s + its amount`).toBe(after[i + 1]! + amounts[i]!);
        }
        expect.soft(after[n - 1], "the first entry's balance after is its own amount").toBe(amounts[n - 1]);
        // The order fee came first, the payment after it; the top row is where the pair stands now.
        expect.soft(amounts).toEqual([-g.feeSign * PAYMENT, g.feeSign * FEE]);
        expect.soft(after[0]).toBe(-g.feeSign * (PAYMENT - FEE));
        await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText(rp(PAYMENT - FEE));
        await expect
          .soft(page.getByTestId("liability-detail-direction"))
          .toHaveText(r.side === "selling" ? "They owe you" : "You owe them");
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (order fee reversed after a cancel)`, () => {
  for (const r of ROLES) {
    test(`${r.given} open liability pair`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openPair(page, g.rev, g.revName, 2);

      await test.step("then: reversal labelled", async () => {
        const both = orderRows(page, g.revOrder);
        await expect.soft(both).toHaveCount(2);
        // Newest first: the reversal is the later entry, labelled, of the opposite amount; the original carries none.
        const reversal = both.nth(0);
        const original = both.nth(1);
        await expect.soft(reversal.locator('[data-testid^="liability-detail-reversal-"]')).toHaveText("Reversal");
        await expect.soft(original.locator('[data-testid^="liability-detail-reversal-"]')).toHaveCount(0);
        for (const e of [reversal, original]) {
          await expect.soft(cells(e).nth(1)).toContainText(`Order fee · order #${g.revOrder}`);
        }
        await expect.soft(cells(original).nth(3)).toHaveText(signed(g.feeSign * FEE));
        await expect.soft(cells(reversal).nth(3)).toHaveText(signed(-g.feeSign * FEE));
      });

      await test.step("regression: the fee and its reversal net to zero — the pair is square", async () => {
        await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText(rp(0));
        await expect.soft(page.getByTestId("liability-detail-direction")).toHaveText("Square");
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (entries both ways · receivable tab)`, () => {
  for (const r of ROLES) {
    test(`${r.given} filter liability history`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openPair(page, g.paid, g.paidName, 2);

      // The pair's two entries, one each way: the order fee and the payment.
      const feeId = await orderRows(page, g.feeOrder).getAttribute("data-testid");
      const paidId = await paymentRows(page, g.payment).getAttribute("data-testid");
      expect(feeId, "the order fee's entry").toBeTruthy();
      expect(paidId, "the payment's entry").toBeTruthy();
      // What they owe us — the warehouse is owed the order fee; the seller paid past the fee, so its payment is what
      // moved the pair to the warehouse owing it.
      const owedToUs = g.feeSign > 0 ? { id: feeId!, amount: FEE } : { id: paidId!, amount: PAYMENT };
      const weOwe = g.feeSign > 0 ? { id: paidId!, amount: -PAYMENT } : { id: feeId!, amount: -FEE };

      const receivable = page.getByTestId("liability-detail-receivable");
      const asked = ledgerRead(page, [`"counterpartyId":"${g.paid}"`, '"direction":"LIABILITY_LOG_DIRECTION_RECEIVABLE"']);
      await page.getByTestId("liability-detail-tab-receivable").click();
      await expect(page.getByTestId("liability-detail-tab-receivable")).toHaveAttribute("aria-selected", "true");
      const answer = await ledgerAnswer(await asked);

      await test.step("then: only what they owe us listed", async () => {
        const rows = receivable.locator('[data-testid^="liability-detail-entry-"]');
        await expect.soft(rows).toHaveCount(1);
        await expect.soft(receivable.getByTestId(owedToUs.id)).toBeVisible();
        await expect.soft(cells(receivable.getByTestId(owedToUs.id)).nth(3)).toHaveText(signed(owedToUs.amount));
        await expect.soft(receivable.getByTestId(weOwe.id)).toHaveCount(0);
        // The server narrowed it: its answer holds that one entry alone.
        expect.soft(answer.ids.map((id) => `liability-detail-entry-${id}`)).toEqual([owedToUs.id]);
      });

      await test.step("regression: the other way is on the Payable tab", async () => {
        await page.getByTestId("liability-detail-tab-payable").click();
        const payable = page.getByTestId("liability-detail-payable");
        await expect.soft(payable.locator('[data-testid^="liability-detail-entry-"]')).toHaveCount(1);
        await expect.soft(cells(payable.getByTestId(weOwe.id)).nth(3)).toHaveText(signed(weOwe.amount));
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (entries in Oct and Nov · 1–7 Nov)`, () => {
  for (const r of ROLES) {
    test(`${r.given} filter liability history`, async ({ page }) => {
      const g = ground[r.side];
      const net = rp(PAYMENT - FEE);
      const direction = r.side === "selling" ? "They owe you" : "You owe them";
      await signInAs(page, r.key, r.side);
      // The whole pair, no range: its entries and their days, as the server stamped them.
      const loaded = ledgerRead(page, [`"counterpartyId":"${g.paid}"`], ['"from"', '"to"', '"direction"']);
      await openPair(page, g.paid, g.paidName, 2);
      const whole = await ledgerAnswer(await loaded);
      expect(whole.ids).toHaveLength(2);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(net);

      const days = Object.values(whole.days).sort();
      const week = { from: shiftDay(days[days.length - 1]!, -6), to: days[days.length - 1]! };
      const before = { from: shiftDay(days[0]!, -7), to: shiftDay(days[0]!, -1) };
      const balances: number[] = [];

      await test.step("then: only that week's entries", async () => {
        // The week ending on the entries' day: every entry of the pair, each one's day inside the week.
        const inWeek = await pickRange(page, g.paid, week.from, week.to);
        expect.soft([...inWeek.ids].sort()).toEqual([...whole.ids].sort());
        for (const [id, day] of Object.entries(inWeek.days)) {
          expect.soft(day >= week.from && day <= week.to, `entry ${id} (${day}) inside ${week.from}..${week.to}`).toBe(true);
        }
        await expect.soft(rowsOf(page)).toHaveCount(whole.ids.length);
        for (const id of whole.ids) await expect.soft(page.getByTestId(`liability-detail-entry-${id}`)).toBeVisible();
        balances.push(inWeek.balance);

        // The week before it: none of them — the empty line, no row — though the pair holds them.
        const outside = await pickRange(page, g.paid, before.from, before.to);
        expect.soft(outside.ids).toEqual([]);
        await expect.soft(page.getByTestId("liability-detail-all").getByTestId("liability-ledger-empty")).toBeVisible();
        await expect.soft(rowsOf(page)).toHaveCount(0);
        await expect.soft(page).toHaveURL(new RegExp(`range=${before.from}\\.\\.${before.to}`));
        balances.push(outside.balance);
      });

      await test.step("then: net position still the whole pair's", async () => {
        // That empty week is in force: the card still reads where the whole pair stands.
        await expect.soft(page.getByTestId("liability-detail-position")).toContainText("Net position");
        await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText(net);
        await expect.soft(page.getByTestId("liability-detail-direction")).toHaveText(direction);
        // Both narrowed answers carry the whole pair's balance, never a sum over the rows they returned.
        expect.soft(whole.balance).toBe(-g.feeSign * (PAYMENT - FEE));
        expect.soft(balances).toEqual([whole.balance, whole.balance]);
      });
    });
  }
});

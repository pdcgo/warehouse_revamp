import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── open liability · filter liability — the checks behind docs/acceptances/balance/position.md (the list) ─────────────
//
// open liability's and filter liability's regression spec (one list, one ground). An acceptance has no test file of its
// own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then, run as EVERY role the
// given names (status-is-per-then). The rows' statuses are set from the tester's green results, or by the owner.
//
// The WHEN, as the person does it: Financial accounts › Liability (`/liability`) — the summary cards over every team and
// one row per counterparty, what this team owes it (Payable) and what it owes this team (Receivable).
//
// Business rules (docs/business/balance/context_decision.md):
// - balance-manages-reports-and-takes-payments — the list totals EVERY counterparty (the cards are the server's, never a
//   sum of the page), direction is two columns, never a sign, and the oldest unsettled entry is the actionable signal.
// - a-creditor-may-request-payment — the creditor's ask reads on the debtor's row; it moves nothing.
// - the-threshold-defaults-to-unlimited / the-block-stops-orders-only — a limit of Rp 0 is no credit at all: the debtor's
//   next order that would owe this team is refused, whatever it owes.
// - Only an owner and an admin see the Liability screens (the position.md intro): a cs and a warehouse staff get no menu
//   entry, and the page by its address shows the server's refusal.
//
// GROUND (beforeAll, as root, through the API) — one team per side, read by both its roles (nothing here writes):
//   selling team S (LQS…; a selling:owner, a selling:admin, a selling:cs):
//     - owes warehouse A (LQA…) Rp 300.000: S's lent product (25% markup) restocked at A — 10 units for Rp 500.000, the
//       courier's Rp 300.000 paid at A's door (landed: Rp 80.000 a unit), *Restock Accepted* pushed to liability;
//     - selling team B (LQB…) owes S Rp 100.000: B ordered ONE unit of S's product at A (the goods with markup);
//     - B's payment of Rp 40.000 to S is recorded and pending (awaiting S's confirmation — it moves nothing);
//     - A has asked S to pay; S's limit on B is Rp 0 (B's next order of S's goods is refused).
//   warehouse team W (LQW…; a warehouse:owner, a warehouse:admin, a warehouse:staff):
//     - selling team B (LQD…) owes W Rp 100.000: the courier's charge at W's door for B's restock;
//     - W owes selling team A (LQC…) Rp 300.000: A owed W Rp 50.000, paid Rp 350.000, W accepted it;
//     - B's payment of Rp 40.000 to W is recorded and pending; A has asked W to pay; W's limit on B is Rp 0.
//   Each side's B carries "Melati" in its name (the search's given); A does not.
//   Each side also has a SQUARE pair (filter liability's given 10) — a courier's charge of Rp 50.000 paid in full and
//   accepted, so the pair is back at Rp 0 and the default "Unsettled only" hides it:
//     - S owed warehouse E (LQE…) the courier at E's door for S's restock there; S paid it, E accepted;
//     - selling team F (LQF…) owed W the courier at W's door for F's restock; F paid it, W accepted.
//   ⚠ For the WAREHOUSE roles, "warehouse A" is a SELLING team: every posting's debtor is a selling team (a restock's,
//   a transfer's, a return's and a custom shipment's courier, an order's fees), so a warehouse owes only what a seller
//   overpaid it — there is no posting by which a warehouse owes a warehouse. The screen reads A the same either way.
//   The same fact makes filter liability's given 8 ("warehouse and selling teams") one-sided for W: W's counterparties
//   can only be selling teams, so "team type warehouse" lists none of them — the check is that no selling team stays
//   listed, and its regression step that "team type selling" lists them all.
//
// Where each then is read (the role's own list, desktop):
// - `total payable` / `total receivable` — the cards `liability-total-payable` / `-receivable`.
// - `A under payable, B under receivable` — A's row: its name, the amount under Payable, a dash under Receivable; B's
//   the other way round (the header's columns are Payable, then Receivable).
// - `oldest unsettled 30 days, in red` — the Oldest unsettled card. No RPC back-dates an entry (each is stamped when
//   posted) and the age is the BROWSER's now minus the server's oldest stamp, so the test reads the server's stamp and
//   moves the page's clock to 30 days and an hour after it (Playwright's fixed clock): the card reads "30 days", in the
//   theme's error colour (`--chakra-colors-error-fg`, not the 14–29-day warning colour).
// - `the team it belongs to named under it` — the card's quiet line names the team the server's oldest entry is with
//   (checked to be the pair with the oldest stamp), drawn under the figure.
// - `awaiting your confirmation 1` — the Awaiting your confirmation card reads 1.
// - `"asks you to pay" on its row` — A's row carries the Asks you to pay badge.
// - `B's row marked frozen, next order refused` — B's row carries the frozen badge; B's next order that owes this team
//   (root, as B, through the API) is answered failed_precondition naming this team's credit limit, and no order holds
//   its Order ID.
// - `cannot see liability` — no Liability in the menu (its Restock entry is there); the page by its address shows the
//   refusal (LiabilityPositionList answers permission_denied), no row and no figure; the reads under the role's token
//   are refused.
//
// filter liability (the filter row over the list; every filter is the server's and lives in the page link):
// - `only Melati listed` — "Melati" typed in the search (`liability-search`): the list asks the server with `q`, B's row
//   (its name carries Melati) is the only row, A's is gone, the link carries `q=Melati`.
// - `only warehouse teams listed` — Team type › Warehouse team (`liability-kind` → `-option-3`): every row left is a
//   warehouse team (its kind line), no selling team is listed, the link carries `kind=3`.
// - `only that team listed` — Awaiting my confirmation (`liability-awaiting-only`): B (its payment of Rp 40.000 is
//   pending) is the only row, A is gone, the link carries `awaiting=1`.
// - `square team listed as square` — with the default "Unsettled only" the square pair is not listed; turned off
//   (`liability-unsettled-only`, the link `unsettled=0`) its row is there with a dash under Payable and Receivable and
//   "Square" where the age of an unsettled entry would be.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-liabopen-pass-1";
const OWE_A = 300_000;
const B_OWES = 100_000;
// S's lent product: Rp 80.000 a unit + 25% markup → one unit ordered owes S Rp 100.000.
const UNIT_COST = 80_000;
const MARKUP_BPS = 2_500;
// W's ground: A owed W Rp 50.000 and paid Rp 350.000 → W owes A Rp 300.000.
const A_OWED_W = 50_000;
const A_PAID = A_OWED_W + OWE_A;
// B's pending payment — recorded, never accepted.
const PENDING = 40_000;
// The square pairs: a courier's charge, paid in full and accepted.
const SQUARE = 50_000;
const MELATI = "Melati";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Side = "selling" | "warehouse";
const ROLES = [
  { key: "so", given: "selling:owner", role: "ROLE_SELLING_OWNER", side: "selling" },
  { key: "sa", given: "selling:admin", role: "ROLE_SELLING_ADMIN", side: "selling" },
  { key: "wo", given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", side: "warehouse" },
  { key: "wa", given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", side: "warehouse" },
] as const;
const BLIND = [
  { key: "sc", given: "selling:cs", role: "ROLE_SELLING_CS", side: "selling" },
  { key: "ws", given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", side: "warehouse" },
] as const;
const MANAGERS = "selling:owner · selling:admin · warehouse:owner · warehouse:admin";

const user = (key: string) => `e2elq${key}${SUFFIX}`;
const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

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
  // the team it owes (A) and the selling team that owes it (B)
  a: string;
  aName: string;
  b: string;
  bName: string;
  // the square pair — paid in full and accepted
  sq: string;
  sqName: string;
  // B's next order that would owe this team
  order: Order;
}

const blank = (): Ground => ({
  team: "",
  name: "",
  a: "",
  aName: "",
  b: "",
  bName: "",
  sq: "",
  sqName: "",
  order: { team: "", shop: "", warehouse: "", productId: "", productCode: "" },
});
const ground: Record<Side, Ground> = { selling: blank(), warehouse: blank() };

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

      return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
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

// Every position of the answer, keyed by the counterparty.
function positionsOf(res: Record<string, any>): Record<string, Record<string, any>> {
  const out: Record<string, Record<string, any>> = {};
  for (const item of (res.items ?? []) as { position?: { mapData?: Record<string, Record<string, any>> } }[]) {
    Object.assign(out, item.position?.mapData ?? {});
  }

  return out;
}

// The team's balance with ONE counterparty, by the server — positive: they owe the team; negative: the team owes.
async function balanceWith(page: Page, teamId: string, counterpartyId: string) {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", {
    teamId,
    filter: { counterpartyId },
    page: { page: 1, limit: 50 },
  });

  return Number(positionsOf(res)[counterpartyId]?.balance ?? 0) + 0;
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
  idempotencyKey: `e2e-lq-${SUFFIX}-${tag}`,
  shipmentChannelId: "1",
  teamId: o.team,
  shopId: o.shop,
  warehouseId: o.warehouse,
  customerName: `E2E LiabOpen Buyer ${tag}`,
  platformTotal: 150_000,
  platformCreatedAtUnix: Math.floor(Date.now() / 1000),
  orderExternalRefId: `LQ${SUFFIX}${tag.toUpperCase()}`,
  items: [{ productId: o.productId, productCode: o.productCode, name: `E2E ${o.productCode}`, quantity: 1 }],
});

// The role's person, signed in through the form, working in its team.
async function signInAs(page: Page, key: string, side: Side) {
  await signIn(page, user(key), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground[side].team);
}

// The list, loaded: its table is drawn (the positions answered) and both rows carry their team's name.
async function openList(page: Page, g: Ground) {
  await page.goto("/liability");
  await expect(page.getByTestId("liability-list-page")).toBeVisible();
  await expect(page.getByTestId("liability-table")).toBeVisible();
  await expect(page.getByTestId(`liability-row-${g.a}`)).toContainText(g.aName);
  await expect(page.getByTestId(`liability-row-${g.b}`)).toContainText(g.bName);
}

// A colour as the browser computes it from a theme token — a probe span, removed again.
async function colour(page: Page, css: string) {
  return page.evaluate((c) => {
    const probe = document.createElement("span");
    probe.style.color = c;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();

    return value;
  }, css);
}

const liabilityLink = (page: Page) => page.getByTestId("sidebar").locator('a[href="/liability"]');
const restockLink = (page: Page) => page.getByTestId("sidebar").locator('a[href="/inventories/restock"]');

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
      name: `LiabOpen ${key}`,
      role,
    });
  };
  const account = async (teamId: string, tag: string) => {
    const id = String(
      (
        await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E LiabOpen ${tag} BCA ${SUFFIX}`,
          holderName: "PT E2E",
          accountNumber: `E2E-LQO-${tag}-${SUFFIX}`,
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
  const rackOf = async (teamId: string, code: string) =>
    String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId, code })).rack.id);
  const category = String((await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E LiabOpen ${SUFFIX}` })).category.id);
  const productOf = async (teamId: string, codePart: string, markupBps?: number) => {
    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId,
        productCodePart: codePart,
        name: `E2E ${codePart}`,
        categoryId: category,
        ...(markupBps ? { crossMarkupBps: markupBps } : {}),
      })
    ).product;

    return { id: String(product.id), code: String(product.productCode) };
  };
  const shopOf = async (teamId: string, name: string, shopCode: string) =>
    String((await ok(page, "selling.v1.ShopService/ShopCreate", { teamId, name, shopCode, marketplace: "MARKETPLACE_SHOPEE" })).shop.id);
  // A restock counted in at the warehouse's door, the courier's `cod` paid there, *Restock Accepted* pushed to liability.
  const restock = async (
    teamId: string,
    fromAccount: string,
    warehouseId: string,
    rack: string,
    product: { id: string; code: string },
    count: number,
    total: number,
    cod: number,
    supplierId?: string,
  ) => {
    const created = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId,
      warehouseId,
      financeAccountId: fromAccount,
      items: [
        {
          productId: product.id,
          productCode: product.code,
          name: `E2E ${product.code}`,
          count,
          total,
          ...(supplierId ? { supplierId } : {}),
        },
      ],
    });
    const accepted = await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouseId,
      requestId: created.request.id,
      warehouseAdditionalCost: cod,
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
  const frozen = async (creditor: string, debtor: string) =>
    ok(page, "liability.v1.LiabilityTermsService/LiabilityTermsSet", {
      teamId: creditor,
      counterpartyId: debtor,
      creditLimit: 0,
      reason: "e2e acceptance: open liability, frozen",
    });
  // The debtor pays the whole debt and the creditor accepts it — the pair is square again (its row stays, at Rp 0).
  const square = async (debtor: string, creditor: string, fromAccountId: string, toAccountId: string, note: string) => {
    const paid = await pending(debtor, creditor, fromAccountId, SQUARE, note);
    await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", { teamId: creditor, paymentId: paid, toAccountId });
    await expect
      .poll(async () => {
        const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", {
          teamId: creditor,
          filter: { counterpartyId: debtor },
          page: { page: 1, limit: 50 },
        });
        const p = positionsOf(res)[debtor];

        return p ? Number(p.balance ?? 0) + 0 : "no pair";
      }, { timeout: 20_000 })
      .toBe(0);
  };

  // ── the selling side: S owes warehouse A; selling team B owes S for one unit of S's lent product.
  const S = ground.selling;
  S.name = `E2E LiabOpen Seller ${SUFFIX}`;
  S.team = await team(S.name, `LQS${SUFFIX}`, "TEAM_TYPE_SELLING");
  for (const r of [...ROLES, ...BLIND].filter((r) => r.side === "selling")) await member(S.team, r.key, r.role);
  const sAccount = await account(S.team, "S");
  S.aName = `E2E LiabOpen Gudang A ${SUFFIX}`;
  S.a = await team(S.aName, `LQA${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const aRack = await rackOf(S.a, `lqa-${SUFFIX}`);
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: S.a, feePercent: 10, minFee: 0 });

  const lent = await productOf(S.team, `LQP${SUFFIX}`, MARKUP_BPS);
  const supplier = String(
    (await ok(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: S.team, name: `E2E LiabOpen Supplier ${SUFFIX}` }))
      .supplier.id,
  );
  // The courier's charge at the door is part of the goods' landed cost: Rp 500.000 + Rp 300.000 over 10 units is the
  // Rp 80.000 a unit the lent product is valued at.
  await restock(S.team, sAccount, S.a, aRack, lent, 10, 10 * UNIT_COST - OWE_A, OWE_A, supplier);
  await expect.poll(() => balanceWith(page, S.team, S.a), { timeout: 20_000 }).toBe(-OWE_A);

  S.bName = `E2E LiabOpen Toko ${MELATI} B ${SUFFIX}`;
  S.b = await team(S.bName, `LQB${SUFFIX}`, "TEAM_TYPE_SELLING");
  const bAccount = await account(S.b, "B");
  // A team with no return warehouse cannot order, and a borrowed line needs its return mapping.
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: S.b, warehouseId: S.a });
  const bOwn = await productOf(S.b, `LQM${SUFFIX}`);
  await ok(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
    teamId: S.b,
    sharedProductId: lent.id,
    ownProductId: bOwn.id,
  });
  S.order = {
    team: S.b,
    shop: await shopOf(S.b, `E2E LiabOpen Shop B ${SUFFIX}`, `LQT1${SUFFIX}`),
    warehouse: S.a,
    productId: lent.id,
    productCode: lent.code,
  };
  await ok(page, "selling.v1.OrderService/OrderCreate", orderBody(S.order, "b1"));
  // The product fee lands through the ledger's listener.
  await expect.poll(() => balanceWith(page, S.team, S.b), { timeout: 60_000 }).toBe(B_OWES);

  await pending(S.b, S.team, bAccount, PENDING, "part of the borrowed widget");
  await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRequestSend", { teamId: S.a, debtorTeamId: S.team });
  await frozen(S.team, S.b);

  // S's square pair: S owed warehouse E the courier at E's door, paid it in full, and E accepted it.
  S.sqName = `E2E LiabOpen Gudang E ${SUFFIX}`;
  S.sq = await team(S.sqName, `LQE${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const eRack = await rackOf(S.sq, `lqe-${SUFFIX}`);
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: S.sq, feePercent: 10, minFee: 0 });
  const eAccount = await account(S.sq, "E");
  await restock(S.team, sAccount, S.sq, eRack, await productOf(S.team, `LQQ${SUFFIX}`), 2, 20_000, SQUARE);
  await expect.poll(() => balanceWith(page, S.team, S.sq), { timeout: 20_000 }).toBe(-SQUARE);
  await square(S.team, S.sq, sAccount, eAccount, "the courier at E, in full");

  // ── the warehouse side: selling team B owes W a courier's charge; W owes selling team A what A overpaid.
  const W = ground.warehouse;
  W.name = `E2E LiabOpen Gudang ${SUFFIX}`;
  W.team = await team(W.name, `LQW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  for (const r of [...ROLES, ...BLIND].filter((r) => r.side === "warehouse")) await member(W.team, r.key, r.role);
  const wAccount = await account(W.team, "W");
  const wRack = await rackOf(W.team, `lqw-${SUFFIX}`);
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: W.team, feePercent: 10, minFee: 0 });

  W.bName = `E2E LiabOpen Toko ${MELATI} D ${SUFFIX}`;
  W.b = await team(W.bName, `LQD${SUFFIX}`, "TEAM_TYPE_SELLING");
  const dAccount = await account(W.b, "D");
  const dProduct = await productOf(W.b, `LQN${SUFFIX}`);
  await restock(W.b, dAccount, W.team, wRack, dProduct, 4, 40_000, B_OWES);
  await expect.poll(() => balanceWith(page, W.team, W.b), { timeout: 20_000 }).toBe(B_OWES);
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: W.b, warehouseId: W.team });
  W.order = {
    team: W.b,
    shop: await shopOf(W.b, `E2E LiabOpen Shop D ${SUFFIX}`, `LQT2${SUFFIX}`),
    warehouse: W.team,
    productId: dProduct.id,
    productCode: dProduct.code,
  };

  W.aName = `E2E LiabOpen Seller C ${SUFFIX}`;
  W.a = await team(W.aName, `LQC${SUFFIX}`, "TEAM_TYPE_SELLING");
  const cAccount = await account(W.a, "C");
  const cProduct = await productOf(W.a, `LQO${SUFFIX}`);
  await restock(W.a, cAccount, W.team, wRack, cProduct, 2, 20_000, A_OWED_W);
  await expect.poll(() => balanceWith(page, W.team, W.a), { timeout: 20_000 }).toBe(A_OWED_W);
  const over = await pending(W.a, W.team, cAccount, A_PAID, "paid too much");
  await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
    teamId: W.team,
    paymentId: over,
    toAccountId: wAccount,
  });
  await expect.poll(() => balanceWith(page, W.team, W.a), { timeout: 20_000 }).toBe(-OWE_A);

  await pending(W.b, W.team, dAccount, PENDING, "part of the courier");
  await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRequestSend", { teamId: W.a, debtorTeamId: W.team });
  await frozen(W.team, W.b);

  // W's square pair: selling team F owed W the courier at W's door, paid it in full, and W accepted it.
  W.sqName = `E2E LiabOpen Seller F ${SUFFIX}`;
  W.sq = await team(W.sqName, `LQF${SUFFIX}`, "TEAM_TYPE_SELLING");
  const fAccount = await account(W.sq, "F");
  await restock(W.sq, fAccount, W.team, wRack, await productOf(W.sq, `LQR${SUFFIX}`), 2, 20_000, SQUARE);
  await expect.poll(() => balanceWith(page, W.team, W.sq), { timeout: 20_000 }).toBe(SQUARE);
  await square(W.sq, W.team, fAccount, wAccount, "the courier at W, in full");

  await page.close();
});

test.describe(`${MANAGERS} wants to see what is owed (owes warehouse A Rp 300.000 · selling team B owes us Rp 100.000)`, () => {
  for (const r of ROLES) {
    test(`${r.given} open liability`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openList(page, g);

      await test.step("then: total payable Rp 300.000", async () => {
        await expect.soft(page.getByTestId("liability-total-payable-card")).toContainText("Total payable");
        await expect.soft(page.getByTestId("liability-total-payable")).toHaveText(rp(OWE_A));
      });

      await test.step("then: total receivable Rp 100.000", async () => {
        await expect.soft(page.getByTestId("liability-total-receivable-card")).toContainText("Total receivable");
        await expect.soft(page.getByTestId("liability-total-receivable")).toHaveText(rp(B_OWES));
      });

      await test.step("then: A under payable, B under receivable", async () => {
        const head = page.getByTestId("liability-table").locator("th");
        await expect.soft(head.nth(1)).toHaveText("Payable");
        await expect.soft(head.nth(2)).toHaveText("Receivable");

        const a = page.getByTestId(`liability-row-${g.a}`).locator("td");
        await expect.soft(a.nth(0)).toContainText(g.aName);
        await expect.soft(a.nth(1)).toHaveText(rp(OWE_A));
        await expect.soft(a.nth(2)).toHaveText("—");

        const b = page.getByTestId(`liability-row-${g.b}`).locator("td");
        await expect.soft(b.nth(0)).toContainText(g.bName);
        await expect.soft(b.nth(1)).toHaveText("—");
        await expect.soft(b.nth(2)).toHaveText(rp(B_OWES));
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (oldest unsettled entry 30 days old)`, () => {
  for (const r of ROLES) {
    test(`${r.given} open liability`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);

      // The server's oldest unsettled stamp and whose it is — it must be the pair whose own oldest stamp is the earliest.
      const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", {
        teamId: g.team,
        filter: { unsettledOnly: true },
        page: { page: 1, limit: 50 },
      });
      const at = Number(res.oldestUnsettledAtUnix ?? 0);
      const cp = String(res.oldestUnsettledCounterpartyId ?? "");
      expect(at).toBeGreaterThan(0);
      expect([g.a, g.b]).toContain(cp);
      const stamps = Object.values(positionsOf(res))
        .map((p) => Number(p.oldestUnsettledAtUnix ?? 0))
        .filter((s) => s > 0);
      expect(at).toBe(Math.min(...stamps));
      expect(Number(positionsOf(res)[cp]?.oldestUnsettledAtUnix ?? 0)).toBe(at);
      const name = cp === g.a ? g.aName : g.bName;

      // That entry, 30 days old: the page's clock 30 days and an hour after it.
      await page.clock.setFixedTime(new Date((at + 30 * 86_400 + 3_600) * 1000));
      await openList(page, g);

      await test.step("then: oldest unsettled 30 days, in red", async () => {
        await expect.soft(page.getByTestId("liability-oldest-card")).toContainText("Oldest unsettled");
        const oldest = page.getByTestId("liability-oldest");
        await expect.soft(oldest).toHaveText("30 days");
        const red = await colour(page, "var(--chakra-colors-error-fg)");
        const amber = await colour(page, "var(--chakra-colors-warning-fg)");
        expect.soft(red).not.toBe(amber);
        await expect.soft(oldest).toHaveCSS("color", red);
      });

      await test.step("then: the team it belongs to named under it", async () => {
        const named = page.getByTestId("liability-oldest-card").getByText(name, { exact: true });
        await expect.soft(named).toBeVisible();
        const figure = await page.getByTestId("liability-oldest").boundingBox();
        const line = await named.boundingBox();
        expect.soft(line && figure && line.y > figure.y).toBe(true);
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (1 payment awaiting our confirmation)`, () => {
  for (const r of ROLES) {
    test(`${r.given} open liability`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openList(page, g);

      await test.step("then: awaiting your confirmation 1", async () => {
        await expect.soft(page.getByTestId("liability-awaiting-card")).toContainText("Awaiting your confirmation");
        await expect.soft(page.getByTestId("liability-awaiting-total")).toHaveText("1");
      });

      await test.step("regression: the payer's row says it has one to accept", async () => {
        await expect.soft(page.getByTestId(`liability-row-${g.b}`)).toContainText("1 to accept");
        await expect.soft(page.getByTestId(`liability-row-${g.a}`)).not.toContainText("to accept");
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (warehouse asked us to pay)`, () => {
  for (const r of ROLES) {
    test(`${r.given} open liability`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openList(page, g);

      await test.step('then: "asks you to pay" on its row', async () => {
        const row = page.getByTestId(`liability-row-${g.a}`);
        await expect.soft(row.getByTestId(`liability-request-${g.a}`)).toHaveText(/^asks you to pay$/i);
        // Only the asking team's row carries it.
        await expect.soft(page.getByTestId(`liability-request-${g.b}`)).toHaveCount(0);
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (we set a limit of Rp 0 on selling team B)`, () => {
  for (const r of ROLES) {
    test(`${r.given} open liability`, async ({ page, browser }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openList(page, g);

      await test.step("then: B's row marked frozen, next order refused", async () => {
        const row = page.getByTestId(`liability-row-${g.b}`);
        await expect.soft(row.getByTestId(`liability-frozen-${g.b}`)).toHaveText(/frozen/i);
        await expect.soft(page.getByTestId(`liability-frozen-${g.a}`)).toHaveCount(0);

        // B's next order that would owe this team — root, as B, through the API.
        const root = await browser.newPage();
        await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);
        const body = orderBody(g.order, `n${r.key}`);
        const refused = await call(root, "selling.v1.OrderService/OrderCreate", body);
        expect.soft(refused.status).not.toBe(200);
        expect.soft(refused.body.code).toBe("failed_precondition");
        expect.soft(String(refused.body.message ?? "")).toContain(`credit limit reached with ${g.name}`);
        const held = await ok(root, "selling.v1.OrderService/OrderByExternalRefs", {
          teamId: g.order.team,
          filter: { refs: [body.orderExternalRefId] },
          dataRequest: ["ORDER_BY_EXTERNAL_REFS_DATA_TYPE_ORDER_REF"],
        });
        expect.soft(held.items?.[body.orderExternalRefId]).toBeUndefined();
        await root.close();
      });
    });
  }
});

test.describe("selling:cs · warehouse:staff wants to see what is owed (team owes another team)", () => {
  for (const r of BLIND) {
    test(`${r.given} open liability`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      const listed = page.waitForResponse((res) =>
        res.url().endsWith("/warehouse.liability.v1.LiabilityService/LiabilityPositionList"),
      );
      await page.goto("/liability");
      const answer = await listed;

      await test.step("then: cannot see liability", async () => {
        // No Liability in the menu — its Restock entry is there, so the menu has loaded.
        await expect.soft(restockLink(page)).toHaveCount(1);
        await expect.soft(liabilityLink(page)).toHaveCount(0);

        // The page by its address: the refusal, no row, no figure of what the team owes.
        expect.soft(answer.status()).not.toBe(200);
        expect.soft(((await answer.json().catch(() => ({}))) as { code?: string }).code).toBe("permission_denied");
        await expect.soft(page.getByTestId("liability-error")).toBeVisible();
        await expect.soft(page.locator('[data-testid^="liability-row-"]')).toHaveCount(0);
        await expect.soft(page.getByTestId("liability-total-payable")).toHaveText("Rp 0");
        await expect.soft(page.getByText(rp(OWE_A))).toHaveCount(0);

        // The reads, under the role's own token — refused.
        for (const [method, body] of [
          ["LiabilityPositionList", { teamId: g.team, page: { page: 1, limit: 20 } }],
          ["LiabilityLogList", { teamId: g.team, filter: { counterpartyId: g.a }, page: { page: 1, limit: 20 } }],
        ] as const) {
          const res = await call(page, `liability.v1.LiabilityService/${method}`, body);
          expect.soft(res.status, `${method} as ${r.given}`).not.toBe(200);
          expect.soft(res.body.code, `${method} as ${r.given}`).toBe("permission_denied");
        }
      });
    });
  }
});

// ── filter liability ───────────────────────────────────────────────────────────────────────────────────────────────────

// Every row the list draws now.
const listed = (page: Page) => page.getByTestId("liability-table").locator('[data-testid^="liability-row-"]');

// The list's request that carries a filter — proof the SERVER was asked to narrow, not the page (backlog #34).
const askedWith = (page: Page, carries: (body: string) => boolean) =>
  page.waitForResponse(
    (res) =>
      res.url().endsWith("/warehouse.liability.v1.LiabilityService/LiabilityPositionList") &&
      carries(res.request().postData() ?? ""),
  );

// Team type › <kind> on the desktop's filter row.
async function pickKind(page: Page, value: "3" | "4") {
  await page.getByTestId("liability-kind").click();
  await page.getByTestId(`liability-kind-option-${value}`).click();
}

test.describe(`${MANAGERS} wants to see what is owed (2 teams · search "Melati")`, () => {
  for (const r of ROLES) {
    test(`${r.given} filter liability`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openList(page, g);
      await expect(listed(page)).toHaveCount(2);

      const asked = askedWith(page, (body) => body.includes(`"q":"${MELATI}"`));
      await page.getByTestId("liability-search").fill(MELATI);
      expect((await asked).status()).toBe(200);

      await test.step("then: only Melati listed", async () => {
        await expect.soft(page.getByTestId(`liability-row-${g.b}`)).toContainText(g.bName);
        await expect.soft(listed(page)).toHaveCount(1);
        await expect.soft(page.getByTestId(`liability-row-${g.a}`)).toHaveCount(0);
        await expect.soft(page).toHaveURL(new RegExp(`[?&]q=${MELATI}(&|$)`));
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (warehouse and selling teams · team type warehouse)`, () => {
  for (const r of ROLES) {
    test(`${r.given} filter liability`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openList(page, g);
      await expect(listed(page)).toHaveCount(2);

      const asked = askedWith(page, (body) => /"counterpartyType":("TEAM_TYPE_WAREHOUSE"|3)/.test(body));
      await pickKind(page, "3");
      expect((await asked).status()).toBe(200);

      await test.step("then: only warehouse teams listed", async () => {
        await expect.soft(page).toHaveURL(/[?&]kind=3(&|$)/);
        // No selling team stays: B (selling) is gone on both sides, and W's A is a selling team too.
        await expect.soft(page.getByTestId(`liability-row-${g.b}`)).toHaveCount(0);
        if (r.side === "selling") {
          // S's A is the warehouse it owes — the one row left, named as a warehouse team.
          await expect.soft(listed(page)).toHaveCount(1);
          await expect.soft(page.getByTestId(`liability-row-${g.a}`).locator("td").first()).toContainText(g.aName);
          await expect.soft(page.getByTestId(`liability-row-${g.a}`).locator("td").first()).toContainText("Warehouse team");
        } else {
          // W trades only with selling teams (every posting's debtor is one): nothing is a warehouse team.
          await expect.soft(page.getByTestId(`liability-row-${g.a}`)).toHaveCount(0);
          await expect.soft(listed(page)).toHaveCount(0);
          await expect.soft(page.getByTestId("liability-empty")).toBeVisible();
        }
        const rows = listed(page);
        for (let i = 0; i < (await rows.count()); i++) {
          await expect.soft(rows.nth(i).locator("td").first()).not.toContainText("Selling team");
        }
      });

      await test.step("regression: team type selling lists the selling teams", async () => {
        const selling = askedWith(page, (body) => /"counterpartyType":("TEAM_TYPE_SELLING"|4)/.test(body));
        await pickKind(page, "4");
        expect((await selling).status()).toBe(200);
        await expect.soft(page).toHaveURL(/[?&]kind=4(&|$)/);
        await expect.soft(page.getByTestId(`liability-row-${g.b}`).locator("td").first()).toContainText("Selling team");
        if (r.side === "selling") {
          await expect.soft(listed(page)).toHaveCount(1);
          await expect.soft(page.getByTestId(`liability-row-${g.a}`)).toHaveCount(0);
        } else {
          await expect.soft(listed(page)).toHaveCount(2);
          await expect.soft(page.getByTestId(`liability-row-${g.a}`).locator("td").first()).toContainText("Selling team");
        }
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (2 teams · 1 with a payment awaiting · awaiting my confirmation)`, () => {
  for (const r of ROLES) {
    test(`${r.given} filter liability`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openList(page, g);
      await expect(listed(page)).toHaveCount(2);

      const asked = askedWith(page, (body) => body.includes('"awaitingOnly":true'));
      await page.getByTestId("liability-awaiting-only").click();
      expect((await asked).status()).toBe(200);

      await test.step("then: only that team listed", async () => {
        // B's payment of Rp 40.000 awaits this team's confirmation; A has none.
        await expect.soft(page.getByTestId(`liability-row-${g.b}`)).toContainText("1 to accept");
        await expect.soft(listed(page)).toHaveCount(1);
        await expect.soft(page.getByTestId(`liability-row-${g.a}`)).toHaveCount(0);
        await expect.soft(page).toHaveURL(/[?&]awaiting=1(&|$)/);
      });
    });
  }
});

test.describe(`${MANAGERS} wants to see what is owed (1 team square · unsettled only off)`, () => {
  for (const r of ROLES) {
    test(`${r.given} filter liability`, async ({ page }) => {
      const g = ground[r.side];
      await signInAs(page, r.key, r.side);
      await openList(page, g);

      await test.step("regression: unsettled only is the default, and hides the square team", async () => {
        await expect.soft(page.getByTestId("liability-unsettled-only")).toHaveAttribute("data-state", "checked");
        await expect.soft(listed(page)).toHaveCount(2);
        await expect.soft(page.getByTestId(`liability-row-${g.sq}`)).toHaveCount(0);
      });

      const asked = askedWith(page, (body) => body.includes('"page"') && !body.includes('"unsettledOnly":true'));
      await page.getByTestId("liability-unsettled-only").click();
      expect((await asked).status()).toBe(200);

      await test.step("then: square team listed as square", async () => {
        await expect.soft(page).toHaveURL(/[?&]unsettled=0(&|$)/);
        const cells = page.getByTestId(`liability-row-${g.sq}`).locator("td");
        await expect.soft(cells.nth(0)).toContainText(g.sqName);
        await expect.soft(cells.nth(1)).toHaveText("—");
        await expect.soft(cells.nth(2)).toHaveText("—");
        await expect.soft(cells.nth(3)).toHaveText("Square");
        await expect.soft(page.getByTestId(`liability-age-${g.sq}`)).toHaveCount(0);
        // The unsettled pairs are still listed beside it.
        await expect.soft(listed(page)).toHaveCount(3);
      });
    });
  }
});

import { expect, test } from "@playwright/test";
import type { Browser, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick } from "./restock_helpers";
import { listLanded, pickTeam } from "./pickers";

// ── tell to make payment — the checks behind docs/acceptances/balance/payment.md ──────────────────────────────────────
//
// tell to make payment's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the
// checks for its thens live here, one test.describe per given + when, one test.step("then: …") per then, run as EVERY
// role the given names (status-is-per-then). The rows' statuses are the owner's, set by hand — never by this file.
// What CLEARS a tell (the debtor recording a payment) is make payment's then, checked in payment_wants_to_make.spec.ts.
//
// Business rules (docs/business/balance/context_decision.md):
// - a-creditor-may-request-payment — the creditor team's owner and admin send a PAYMENT REQUEST from the pair detail: a
//   notice to the debtor saying who asks, the amount owed at that moment, and when. It posts NOTHING and blocks NOTHING;
//   the debtor sees it on its balance and its pair detail until it pays or the request is replaced (one per pair).
// - the-block-stops-orders-only / over-the-limit-refuses-the-create — at or over the credit limit the next order is
//   refused, its refusal naming the credit limit and the creditor.
// - the-cross-markup-belongs-to-the-product — a borrowed product's fee is owed to the selling team that lent it, so that
//   team is the creditor, and its owner and admin may ask too.
//
// The WHEN, as the person does it: the creditor's /liability/<debtor> page → Request Payment → the confirm ("<debtor>
// will see that you ask it to pay <amount> …") → Send Request.
//
// GROUND (beforeAll, as root, through the API):
//   warehouse W (TKW…, a warehouse:owner and a warehouse:admin user, 10% fee); per warehouse role three selling teams,
//   each with its own selling:owner, operational account, supplier, product (10 units on W's rack), shop and return
//   warehouse W, owing W Rp 2.000 — an earlier order's fee (10% of 2 × Rp 10.000):
//     b — below its credit limit (Rp 100.000, set by root);
//     l — AT its credit limit (Rp 2.000 = the debt);
//     t — told before: root sent W's request at Rp 2.000, then a second order took the debt to Rp 4.000.
//   cross team X (TKX…, a selling:owner and a selling:admin user) lends its product (20% markup on Rp 10.000) at warehouse
//   WX (TKV…); per selling role a debtor team d (its own selling:owner) ordered 2 units of it → owes X Rp 24.000.
//
// Where each then is read:
// - `selling team sees tell to make payment with amount owed` / `the other selling team sees tell to make payment` — the
//   debtor's own /liability/<creditor> page: ONE warning "<creditor> asks you to pay <the debt>", beside a balance of that
//   debt; its /liability list badges the creditor's row "Asks you to pay"; the server's position carries the request,
//   from that creditor, for that amount.
// - `liability balance unchanged` — the pair balance on BOTH sides (the debtor's page and W's) and their ledger entries,
//   as before the tell; the server's balance and the debtor's total payable as before.
// - `selling team can still create orders` — the debtor's order form at W creates: 200, the order's page, pending.
// - `order refused by credit limit, not by the tell` — the same form at W is refused failed_precondition, the refusal
//   naming the credit limit and W — word for word the refusal it got BEFORE the tell, and saying nothing of a request;
//   no order holds the Order ID.
// - `new tell replaces the old one` — the debtor's page carries ONE warning, at the new amount (Rp 4.000, not the old
//   Rp 2.000); W's page says it asked once, at the new amount; the server's request is the new one: the amount, the
//   person who sent it (the role's user, not root), and its time no earlier than the old.

const PASSWORD = "e2e-paytell-pass-1";
const STOCK = 10;
const RESTOCK_TOTAL = 100_000; // Rp 10.000 a unit
const QTY = 2;
const FEE_PERCENT = 10;
const PLATFORM_TOTAL = 100_000;
// An order's fee: 10% of 2 × Rp 10.000.
const DEBT = 2_000;
// Told before: a second order on top.
const DEBT_AFTER = 2 * DEBT;
const BELOW_LIMIT = 100_000;
const CROSS_MARKUP_BPS = 2_000;
const CROSS_DEBT = 24_000; // 2 × Rp 12.000

const WAREHOUSE = [
  { key: "own", code: "O", given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER" },
  { key: "adm", code: "A", given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN" },
] as const;
const SELLING = [
  { key: "own", code: "O", given: "selling:owner", role: "ROLE_SELLING_OWNER" },
  { key: "adm", code: "A", given: "selling:admin", role: "ROLE_SELLING_ADMIN" },
] as const;

const user = (tag: string) => `e2etk${tag}${SUFFIX}`;
const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

interface Debtor {
  team: string;
  name: string;
  // the debtor's person: its selling:owner
  user: string;
  shop: string;
  productCode: string;
}

const ground = {
  wh: "",
  whCode: `TKW${SUFFIX}`,
  whName: `E2E PayTell WH ${SUFFIX}`,
  cross: "",
  crossName: `E2E PayTell Cross ${SUFFIX}`,
  // the user ids of the people who tell, by `<w|x><role key>`
  tellers: {} as Record<string, string>,
  // keyed `<given letter><role key>` — `bown`, `ladm`, `down`, …
  debtors: {} as Record<string, Debtor>,
};

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// Somebody else on a page of their own, signed in through the form, working in their team.
async function pageOf(browser: Browser, username: string, teamId: string) {
  const p = await browser.newPage();
  await login(p, username, PASSWORD);
  await useTeam(p, teamId);

  return p;
}

// The team's position with ONE counterparty, by the server.
async function positionOf(page: Page, teamId: string, counterpartyId: string): Promise<Record<string, any> | undefined> {
  const res = await api(page, "liability.v1.LiabilityService/LiabilityPositionList", {
    teamId,
    filter: { counterpartyId },
    page: { page: 1, limit: 50 },
  });
  const map = (res.items as { position?: { mapData: Record<string, Record<string, any>> } }[] | undefined)?.find(
    (it) => it.position,
  )?.position?.mapData;

  return map?.[counterpartyId];
}

// What a team owes in total, by the server (`+ 0`: a magnitude of nothing comes back as -0).
async function totalPayable(page: Page, teamId: string) {
  const res = await api(page, "liability.v1.LiabilityService/LiabilityPositionList", { teamId, page: { page: 1, limit: 50 } });

  return Number(res.totalPayable ?? 0) + 0;
}

// What `debtor` owes `creditor` right now, as the order form and the create's check read it.
async function debtTo(page: Page, debtor: string, creditor: string): Promise<number> {
  const res = await api(page, "liability.v1.LiabilityService/LiabilityCreditByIds", {
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

// The pair page, loaded: its balance has rendered.
async function openPair(page: Page, counterpartyId: string) {
  await page.goto(`/liability/${counterpartyId}`);
  await expect(page.getByTestId("liability-detail-tab-all")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("liability-detail-balance")).toBeVisible();
}

// What the pair page shows of the balance and the ledger, to compare before and after.
async function pairReading(page: Page, counterpartyId: string) {
  await openPair(page, counterpartyId);

  return {
    balance: await page.getByTestId("liability-detail-balance").innerText(),
    direction: await page.getByTestId("liability-detail-direction").innerText(),
    entries: await page.locator('[data-testid^="liability-detail-entry-"]').count(),
  };
}

// THE WHEN — Request Payment on the creditor's pair page for `debtor`, the confirm read, Send Request.
async function tellToPay(page: Page, debtor: Debtor, amount: number) {
  await openPair(page, debtor.team);
  await page.getByTestId("liability-detail-request-payment").click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`${debtor.name} will see that you ask it to pay ${rp(amount)}`);
  await dialog.getByTestId("confirm-action").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("liability-detail-payment-requested")).toBeVisible();
}

// `<debtor> sees tell to make payment with amount owed` — on the debtor's own page and list, and by the server.
async function debtorSeesTell(seen: Page, debtor: Debtor, creditor: string, creditorName: string, amount: number) {
  await openPair(seen, creditor);
  const notice = seen.getByTestId("liability-detail-payment-request");
  await expect.soft(notice).toHaveCount(1);
  await expect.soft(notice).toContainText(`${creditorName} asks you to pay ${rp(amount)}`);
  // …the amount it owes: the pair's balance, owed to the creditor.
  await expect.soft(seen.getByTestId("liability-detail-balance")).toHaveText(rp(amount));
  await expect.soft(seen.getByTestId("liability-detail-direction")).toHaveText("You owe them");

  // The debtor's liability list badges the creditor's row.
  await seen.goto(`/liability?q=${encodeURIComponent(creditorName)}`);
  await expect.soft(seen.getByTestId(`liability-row-${creditor}`)).toBeVisible();
  await expect.soft(seen.getByTestId(`liability-request-${creditor}`)).toHaveText("Asks you to pay");

  const request = (await positionOf(seen, debtor.team, creditor))?.paymentRequest;
  expect.soft(request, "the server's position carries the request").toBeTruthy();
  expect.soft(String(request?.creditorTeamId)).toBe(creditor);
  expect.soft(String(request?.debtorTeamId)).toBe(debtor.team);
  expect.soft(Number(request?.amount)).toBe(amount);

  return request;
}

// The marketplace's order date — today's cell, in the browser's own clock (orders.spec.ts's pickOrderDate).
async function pickOrderDate(page: Page) {
  await page.getByTestId("order-create-order-date").click();
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await page.getByTestId("order-create-order-date-content").locator(`[data-part="table-cell-trigger"][data-value="${today}"]`).click();
  await page.keyboard.press("Escape");
}

// The debtor's order form, typed in up to Create and sent: its shop, W, 2 units of its product there, the order date,
// Rp 100.000 paid, a fresh Order ID, JNE. The OrderCreate answer it got.
async function orderAtW(page: Page, debtor: Debtor, orderRef: string): Promise<Response> {
  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await page.getByTestId("order-create-customer-name").fill(`E2E Buyer ${orderRef}`);
  await listLanded(page.locator('[data-testid^="shop-select-option-"]'));
  await page.getByTestId("shop-select").click();
  await page.getByTestId(`shop-select-option-${debtor.shop}`).click();
  await pickTeam(page, page.getByTestId("order-warehouse"), ground.whCode);
  await page.getByTestId("order-create-add-line").click();
  await tick(page, debtor.productCode);
  await page.getByTestId("product-picker-confirm").click();
  await page.getByTestId("order-line-qty-0").fill(String(QTY));
  await pickOrderDate(page);
  await page.getByTestId("order-marketplace-total").fill(String(PLATFORM_TOTAL));
  await page.getByTestId("order-external-ref-id").fill(orderRef);
  await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
  await page.getByTestId("shipment-channel-option-jne").click();
  await expect(page.getByTestId("order-create-save")).toBeEnabled();

  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderCreate")),
    page.getByTestId("order-create-save").click(),
  ]);

  return answer;
}

// Refused BY THE LIMIT — not by stock or anything else that is also failed_precondition: the refusal on the form names
// the credit limit and W (over-the-limit-refuses-the-create), and no order of the team carries the Order ID. Returns the
// refusal's words.
async function expectRefusedByLimit(page: Page, answer: Response, debtor: Debtor, orderRef: string) {
  expect.soft(answer.status()).not.toBe(200);
  expect.soft(((await answer.json()) as { code?: string }).code).toBe("failed_precondition");
  const message = page.getByTestId("order-create-error");
  await expect.soft(message).toBeVisible();
  await expect.soft(message).toContainText("credit limit");
  await expect.soft(message).toContainText(ground.whName);
  await expect.soft(page).toHaveURL(/\/orders\/new$/);

  const held = await api(page, "selling.v1.OrderService/OrderByExternalRefs", {
    teamId: debtor.team,
    filter: { refs: [orderRef] },
    dataRequest: ["ORDER_BY_EXTERNAL_REFS_DATA_TYPE_ORDER_REF"],
  });
  expect.soft(held.items?.[orderRef]).toBeUndefined();

  return (await message.innerText()).trim();
}

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const member = async (teamId: string, tag: string, role: string) =>
    String(
      (await api(page, "user.v1.UserService/CreateUser", { teamId, username: user(tag), password: PASSWORD, name: `PayTell ${tag} ${SUFFIX}`, role }))
        .user.id,
    );
  const accountOf = async (teamId: string, tail: string) => {
    const id = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E PayTell BCA ${tail} ${SUFFIX}`,
          holderName: "PT E2E",
          accountNumber: `E2E-TK-${tail}-${SUFFIX}`,
          openingBalance: 10_000_000,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId,
      accountId: id,
      operational: true,
    });

    return id;
  };
  const supplierOf = async (teamId: string, tag: string) =>
    String((await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId, name: `E2E PayTell Supplier ${tag} ${SUFFIX}` })).supplier.id);
  const category = String((await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E PayTell ${SUFFIX}` })).category.id);
  const productOf = async (owner: string, code: string, cross: boolean) =>
    (
      await api(page, "product.v1.ProductService/ProductCreate", {
        teamId: owner,
        productCodePart: code,
        name: `E2E ${code}`,
        categoryId: category,
        ...(cross ? { crossMarkupBps: CROSS_MARKUP_BPS } : {}),
      })
    ).product as { id: string; productCode: string };
  // STOCK units, raised by the owner from its supplier and accepted onto the warehouse's rack.
  const restock = async (owner: string, wh: string, rack: string, product: { id: string; productCode: string }, tag: string) => {
    const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: owner,
      warehouseId: wh,
      financeAccountId: await accountOf(owner, tag),
      items: [
        {
          productId: product.id,
          productCode: product.productCode,
          name: `E2E ${product.productCode}`,
          count: STOCK,
          total: RESTOCK_TOTAL,
          supplierId: await supplierOf(owner, tag),
        },
      ],
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: wh,
      requestId: raised.request.id,
      lines: (raised.request.items as { id: string }[]).map((item) => ({
        itemId: item.id,
        receivedCount: STOCK,
        placements: [{ placementId: rack, quantity: STOCK }],
      })),
    });
  };
  let shops = 0;
  const shopOf = async (teamId: string, tag: string) =>
    String(
      (
        await api(page, "selling.v1.ShopService/ShopCreate", {
          teamId,
          name: `E2E PayTell Shop ${tag} ${SUFFIX}`,
          shopCode: `TK${++shops}${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
  const order = async (debtor: string, shop: string, wh: string, product: { id: string; productCode: string }, tag: string) =>
    api(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-tk-${SUFFIX}-${tag}`,
      shipmentChannelId: "1",
      teamId: debtor,
      shopId: shop,
      warehouseId: wh,
      customerName: `E2E PayTell Buyer ${tag}`,
      platformTotal: PLATFORM_TOTAL,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `TK${SUFFIX}E${tag.toUpperCase()}`,
      items: [{ productId: product.id, productCode: product.productCode, name: `E2E ${product.productCode}`, quantity: QTY }],
    });

  // ── W, its two people, its rack and its fee.
  ground.wh = await team(ground.whName, ground.whCode, "TEAM_TYPE_WAREHOUSE");
  for (const r of WAREHOUSE) ground.tellers[`w${r.key}`] = await member(ground.wh, `w${r.key}`, r.role);
  const rack = String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.wh, code: `tk-${SUFFIX}`, name: "E2E tell shelf" })).rack.id);
  await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.wh, feePercent: FEE_PERCENT, minFee: 0 });

  // ── per warehouse role: b (below its limit), l (at its limit), t (told before) — each owing W an earlier order's fee.
  const products: Record<string, { id: string; productCode: string }> = {};
  for (const r of WAREHOUSE) {
    for (const letter of ["b", "l", "t"]) {
      const key = `${letter}${r.key}`;
      const tag = `${letter.toUpperCase()}${r.code}`;
      const name = `E2E PayTell ${tag} ${SUFFIX}`;
      const id = await team(name, `TK${tag}${SUFFIX}`, "TEAM_TYPE_SELLING");
      const owner = await member(id, `s${key}`, "ROLE_SELLING_OWNER");
      // A team with no return warehouse cannot order.
      await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: id, warehouseId: ground.wh });
      const product = await productOf(id, `TKP${tag}${SUFFIX}`, false);
      products[key] = product;
      await restock(id, ground.wh, rack, product, tag);
      const shop = await shopOf(id, tag);
      await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: id, shopId: shop, userId: owner });
      ground.debtors[key] = { team: id, name, user: user(`s${key}`), shop, productCode: product.productCode };
      await order(id, shop, ground.wh, product, `${tag}1`);
    }
  }

  // ── the product-fee pairs: X lends its product; per selling role a debtor d orders 2 units of it at WX.
  ground.cross = await team(ground.crossName, `TKX${SUFFIX}`, "TEAM_TYPE_SELLING");
  for (const r of SELLING) ground.tellers[`x${r.key}`] = await member(ground.cross, `x${r.key}`, r.role);
  const wx = await team(`E2E PayTell WX ${SUFFIX}`, `TKV${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const wxRack = String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: wx, code: `tkx-${SUFFIX}`, name: "E2E tell shelf" })).rack.id);
  await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wx, feePercent: FEE_PERCENT, minFee: 0 });
  const crossProduct = await productOf(ground.cross, `TKXP${SUFFIX}`, true);
  await restock(ground.cross, wx, wxRack, crossProduct, "X");

  for (const r of SELLING) {
    const key = `d${r.key}`;
    const tag = `D${r.code}`;
    const name = `E2E PayTell ${tag} ${SUFFIX}`;
    const id = await team(name, `TK${tag}${SUFFIX}`, "TEAM_TYPE_SELLING");
    await member(id, `s${key}`, "ROLE_SELLING_OWNER");
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: id, warehouseId: wx });
    // A borrowed line needs its return mapping.
    const own = await productOf(id, `TKM${r.code}${SUFFIX}`, false);
    await api(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
      teamId: id,
      sharedProductId: crossProduct.id,
      ownProductId: own.id,
    });
    const shop = await shopOf(id, tag);
    ground.debtors[key] = { team: id, name, user: user(`s${key}`), shop, productCode: own.productCode };
    await order(id, shop, wx, crossProduct, `${tag}1`);
  }

  // The fees land through the ledger's listener — wait until each debt reads.
  for (const r of WAREHOUSE) {
    for (const letter of ["b", "l", "t"]) {
      await expect.poll(() => debtTo(page, ground.debtors[`${letter}${r.key}`]!.team, ground.wh), { timeout: 60_000 }).toBe(DEBT);
    }
  }
  for (const r of SELLING) {
    await expect.poll(() => debtTo(page, ground.debtors[`d${r.key}`]!.team, ground.cross), { timeout: 60_000 }).toBe(CROSS_DEBT);
  }

  // GIVEN — the limits standing before the WHEN (root writes them as an override, so with a reason).
  for (const r of WAREHOUSE) {
    const terms = async (debtor: string, creditLimit: number) =>
      api(page, "liability.v1.LiabilityTermsService/LiabilityTermsSet", {
        teamId: ground.wh,
        counterpartyId: debtor,
        creditLimit,
        reason: "e2e acceptance: tell to make payment givens",
      });
    await terms(ground.debtors[`b${r.key}`]!.team, BELOW_LIMIT);
    await terms(ground.debtors[`l${r.key}`]!.team, DEBT); // at limit
  }

  // GIVEN — told before: W asked t to pay Rp 2.000 (root, for W), then a second order took the debt to Rp 4.000.
  for (const r of WAREHOUSE) {
    const t = ground.debtors[`t${r.key}`]!;
    await api(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRequestSend", { teamId: ground.wh, debtorTeamId: t.team });
    await order(t.team, t.shop, ground.wh, products[`t${r.key}`]!, `T${r.code}2`);
  }
  for (const r of WAREHOUSE) {
    await expect.poll(() => debtTo(page, ground.debtors[`t${r.key}`]!.team, ground.wh), { timeout: 60_000 }).toBe(DEBT_AFTER);
  }

  await page.close();
});

test.describe("warehouse:owner · warehouse:admin wants a team to pay its debt (selling team owes the warehouse · below credit limit)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} tell to make payment`, async ({ page, browser }) => {
      const d = ground.debtors[`b${r.key}`]!;
      await login(page, user(`w${r.key}`), PASSWORD);
      await useTeam(page, ground.wh);
      const seller = await pageOf(browser, d.user, d.team);

      // THE GIVEN: it owes W Rp 2.000, below its Rp 100.000 limit, and nobody has asked yet.
      const whBefore = await pairReading(page, d.team);
      expect(whBefore.balance).toBe(rp(DEBT));
      expect(whBefore.direction).toBe("They owe you");
      await expect(page.getByTestId("liability-detail-payment-requested")).toHaveCount(0);
      const sellerBefore = await pairReading(seller, ground.wh);
      await expect(seller.getByTestId("liability-detail-payment-request")).toHaveCount(0);
      const serverBefore = Number((await positionOf(seller, d.team, ground.wh))?.balance ?? 0);
      const payableBefore = await totalPayable(seller, d.team);
      expect(payableBefore).toBe(DEBT);

      await tellToPay(page, d, DEBT);

      await test.step("then: selling team sees tell to make payment with amount owed", async () => {
        await debtorSeesTell(seller, d, ground.wh, ground.whName, DEBT);
      });

      await test.step("then: liability balance unchanged", async () => {
        expect.soft(await pairReading(seller, ground.wh)).toEqual(sellerBefore);
        expect.soft(await pairReading(page, d.team)).toEqual(whBefore);
        expect.soft(Number((await positionOf(seller, d.team, ground.wh))?.balance ?? 0)).toBe(serverBefore);
        expect.soft(await totalPayable(seller, d.team)).toBe(payableBefore);
        expect.soft(await debtTo(seller, d.team, ground.wh)).toBe(DEBT);
      });

      await test.step("then: selling team can still create orders", async () => {
        const answer = await orderAtW(seller, d, `TK${SUFFIX}B${r.code}`);
        expect.soft(answer.status()).toBe(200);
        await expect.soft(seller).toHaveURL(/\/orders\/\d+$/);
        await expect.soft(seller.getByTestId("order-detail-page")).toBeVisible();
        const lines = seller.getByTestId("section-items").locator('[data-testid^="order-item-"]');
        await expect.soft(lines).toHaveCount(1);
        await expect.soft(lines.first()).toContainText(d.productCode);
        await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
      });

      await seller.close();
    });
  }
});

test.describe("warehouse:owner · warehouse:admin wants a team to pay its debt (selling team owes the warehouse · at credit limit)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} tell to make payment`, async ({ page, browser }) => {
      const d = ground.debtors[`l${r.key}`]!;
      await login(page, user(`w${r.key}`), PASSWORD);
      await useTeam(page, ground.wh);
      const seller = await pageOf(browser, d.user, d.team);

      // THE GIVEN: at its limit — Rp 2.000 owed of Rp 2.000, so its order at W is refused already, before any tell.
      const refBefore = `TK${SUFFIX}L${r.code}1`;
      const refusedBefore = await expectRefusedByLimit(seller, await orderAtW(seller, d, refBefore), d, refBefore);

      await tellToPay(page, d, DEBT);

      await test.step("then: selling team sees tell to make payment with amount owed", async () => {
        await debtorSeesTell(seller, d, ground.wh, ground.whName, DEBT);
      });

      await test.step("then: order refused by credit limit, not by the tell", async () => {
        const ref = `TK${SUFFIX}L${r.code}2`;
        const refused = await expectRefusedByLimit(seller, await orderAtW(seller, d, ref), d, ref);
        // The very refusal it got before W asked — the tell adds nothing to it and blocks nothing of its own.
        expect.soft(refused).toBe(refusedBefore);
        expect.soft(refused).not.toContain("asks you to pay");
        expect.soft(await debtTo(seller, d.team, ground.wh)).toBe(DEBT);
      });

      await seller.close();
    });
  }
});

test.describe("warehouse:owner · warehouse:admin wants a team to pay its debt (selling team owes the warehouse · told before)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} tell to make payment`, async ({ page, browser }) => {
      const d = ground.debtors[`t${r.key}`]!;
      await login(page, user(`w${r.key}`), PASSWORD);
      await useTeam(page, ground.wh);
      const seller = await pageOf(browser, d.user, d.team);

      // THE GIVEN: W asked before, at Rp 2.000 — and it now owes Rp 4.000. The old request still reads its own amount.
      await openPair(seller, ground.wh);
      await expect(seller.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT_AFTER));
      await expect(seller.getByTestId("liability-detail-payment-request")).toContainText(`${ground.whName} asks you to pay ${rp(DEBT)}`);
      await openPair(page, d.team);
      await expect(page.getByTestId("liability-detail-payment-requested")).toContainText(`You asked ${d.name} to pay ${rp(DEBT)}`);
      const old = (await positionOf(seller, d.team, ground.wh))?.paymentRequest;
      expect(Number(old?.amount)).toBe(DEBT);
      expect(String(old?.requestedByUserId)).toBe(String(ROOT_USER_ID));

      await tellToPay(page, d, DEBT_AFTER);

      await test.step("then: new tell replaces the old one", async () => {
        // The debtor: ONE warning, at the new amount — the old one is gone, not stacked under it.
        const now = await debtorSeesTell(seller, d, ground.wh, ground.whName, DEBT_AFTER);
        await openPair(seller, ground.wh);
        await expect.soft(seller.getByTestId("liability-detail-payment-request")).toHaveCount(1);
        await expect.soft(seller.getByTestId("liability-detail-payment-request")).not.toContainText(`pay ${rp(DEBT)}`);
        await expect.soft(seller.getByTestId("liability-detail-payment-request")).toContainText(rp(DEBT_AFTER));

        // W: it says it asked once, at the new amount.
        await openPair(page, d.team);
        await expect.soft(page.getByTestId("liability-detail-payment-requested")).toHaveCount(1);
        await expect.soft(page.getByTestId("liability-detail-payment-requested")).toContainText(`You asked ${d.name} to pay ${rp(DEBT_AFTER)}`);

        // The server: the request is the new one — its sender the role's person, not root, and no earlier than the old.
        expect.soft(String(now?.requestedByUserId)).toBe(ground.tellers[`w${r.key}`]);
        expect.soft(Number(now?.requestedAtUnix)).toBeGreaterThanOrEqual(Number(old?.requestedAtUnix));
        const fromW = (await positionOf(page, ground.wh, d.team))?.paymentRequest;
        expect.soft(Number(fromW?.amount)).toBe(DEBT_AFTER);
        expect.soft(String(fromW?.requestedByUserId)).toBe(ground.tellers[`w${r.key}`]);
      });

      await seller.close();
    });
  }
});

test.describe("selling:owner · selling:admin wants a team to pay its debt (cross team owes product fee)", () => {
  for (const r of SELLING) {
    test(`${r.given} tell to make payment`, async ({ page, browser }) => {
      const d = ground.debtors[`d${r.key}`]!;
      await login(page, user(`x${r.key}`), PASSWORD);
      await useTeam(page, ground.cross);
      const other = await pageOf(browser, d.user, d.team);

      // THE GIVEN: the borrowing team owes X Rp 24.000 product fee, and X has not asked.
      await openPair(page, d.team);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(CROSS_DEBT));
      await expect(page.getByTestId("liability-detail-direction")).toHaveText("They owe you");
      await expect(page.getByTestId("liability-detail-payment-requested")).toHaveCount(0);

      await tellToPay(page, d, CROSS_DEBT);

      await test.step("then: the other selling team sees tell to make payment", async () => {
        const request = await debtorSeesTell(other, d, ground.cross, ground.crossName, CROSS_DEBT);
        expect.soft(String(request?.requestedByUserId)).toBe(ground.tellers[`x${r.key}`]);
      });

      await other.close();
    });
  }
});

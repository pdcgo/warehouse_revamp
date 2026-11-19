import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick } from "./restock_helpers";
import { listLanded, pickTeam } from "./pickers";

// A 1×1 PNG — the transfer slip a payment must carry (a-payment-must-carry-proof).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The payer's proof: uploaded as `ownerTeam`'s payment proof and shared with the creditor, so the creditor can read it
// (payment_selling_wants_to_cancel.spec.ts's uploadProof).
async function uploadProof(page: Page, ownerTeam: string, shareWith: string): Promise<string> {
  const requested = await api(page, "document.v1.DocumentService/RequestUpload", {
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
  const confirmed = await api(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: requested.uploadToken });
  await api(page, "document.v1.DocumentService/ShareDocument", {
    teamId: ownerTeam,
    documentId: confirmed.document.id,
    withTeamId: shareWith,
  });
  return String(confirmed.document.id);
}

// ── selling:all wants to create an order — the DEBT LIMIT givens of docs/acceptances/inventory/order.md ─────────────
//
// The rest of create order's checks are order_selling_wants_to_create.spec.ts; these givens are a file of their own so
// neither file grows past the batch cap. An acceptance has no test file of its own (docs/acceptances/guide.md): this is
// still create order's regression spec, and the rows' statuses are the owner's, set by hand — never by this file.
//
// Business rules: over-the-limit-refuses-the-create and the-warehouse-is-a-creditor-on-every-order
// (docs/business/order/context_decision.md) — when ANY creditor of the order (the warehouse that ships it, and every
// team whose goods are on it) is at or over its limit, the create is refused before anything is taken, and the refusal
// names WHICH creditor, what is owed and the limit, because the person who hits it is customer service. The threshold
// warns at 80% (the-threshold-warns-at-eighty-percent, docs/business/balance/context_decision.md) and refuses nothing.
//
// One test per given, run as EVERY selling role (selling:owner, selling:admin, selling:cs), through the seller's own
// order form, typed in: 2 units of the product, the order date, Rp 100.000 paid, a fresh Order ID, JNE.
//
// The debt is REAL: in beforeAll root places one earlier order on each pair (2 units — the warehouse charges 10% of the
// goods, so Rp 2.000 owed to the warehouse; a cross product with a 20% markup, so Rp 24.000 owed to the cross team),
// waits until LiabilityCreditByIds reads that debt, and the creditor then sets its limit on the seller:
//   (debt to warehouse at limit)     — limit = the debt (Rp 2.000 of Rp 2.000). Shared by the three roles: a refused
//                                      create changes nothing, so the pair stays at its limit for every test.
//   (debt to cross team at limit)    — the cross team's limit = the debt (Rp 24.000 of Rp 24.000), shared the same way;
//                                      the warehouse it ships from has no limit. The ordered product is a DIFFERENT
//                                      borrowed product of that team with no return map yet — chosen on the form's
//                                      Return Mapping card (return map chosen), one product per test, so the map is
//                                      chosen every time, never found already standing.
//   (debt to warehouse at 80% of limit) — limit = debt ÷ 0.8 (Rp 2.000 of Rp 2.500). One warehouse PER ROLE: the
//                                      order this given creates adds its own fee, so a shared pair would be over its
//                                      limit for the next role.
//   (at credit limit · payment pending) — the given of docs/acceptances/balance/credit_limit.md: limit = the debt
//                                      (Rp 2.000 of Rp 2.000), and the seller has already recorded a payment of the
//                                      whole Rp 2.000 (proof attached, from its operational account) that the
//                                      warehouse has NOT confirmed. One warehouse PER ROLE: the confirm clears that
//                                      pair, and the order it then lets through adds its own fee.
//                                      Business rule: the-debtor-claims-the-creditor-decides
//                                      (docs/business/balance/context_decision.md) — a pending payment is a claim, not
//                                      money, and has no ledger effect: only the creditor's accept moves the pair.
//
// How each then is read:
// - `order refused` — the OrderCreate the form sent is answered failed_precondition, the form stays on /orders/new and
//   shows the refusal, and no order of the team carries the Order ID (OrderByExternalRefs).
// - `message names team, debt and limit` — the refusal shown on the form names the creditor team as the person knows it
//   (its name) and carries the debt and the limit figures. Its own test (it was test.fail while the app named the
//   creditor by its id — fixed by backlog #74), so it cannot hide `order refused` breaking.
// - `has warning in frontend` — the form's Debt Limits panel marks the warehouse's row Near limit (the triangle beside
//   its name), and Create is not held.
// - `order created` — the order's own page: ONE item line, the product, pending.
// - `order refused until the payment is confirmed` — read in both halves on the one form: Create while the payment is
//   pending is refused as `order refused` reads it (failed_precondition, the refusal on the form, no order holds the
//   Order ID) and the debt still reads the full Rp 2.000; then the warehouse confirms it (into its own account), the debt
//   LiabilityCreditByIds reads falls to 0, and Create again on the same form — the form is the person's again after a
//   refusal, every submit mints its own key — creates the order: its page, ONE item line, the product, pending.
test.describe("selling:all wants to create an order (debt limit)", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  type Role = (typeof ROLES)[number];

  const LIMIT_CASES = [
    { cond: "1 product · own product · 1 warehouse · debt to warehouse at limit", key: "wl", cross: false },
    {
      cond: "1 product · cross product · 1 warehouse · return map chosen · debt to cross team at limit",
      key: "xl",
      cross: true,
    },
  ] as const;
  type LimitCase = (typeof LIMIT_CASES)[number];
  const NEAR_COND = "1 product · own product · 1 warehouse · debt to warehouse at 80% of limit";
  const PENDING_COND = "at credit limit · payment pending";

  const STOCK = 10;
  const RESTOCK_TOTAL = 100_000; // Rp 10.000 a unit
  const QTY = 2;
  const FEE_PERCENT = 10;
  const PLATFORM_TOTAL = 100_000;
  const CROSS_MARKUP_BPS = 2_000; // 20% — a borrowed unit costs the seller Rp 12.000
  const WAREHOUSE_DEBT = 2_000; // the earlier order's fee: 10% of Rp 20.000
  const CROSS_DEBT = 24_000; // the earlier cross order's goods with the markup: 2 × Rp 12.000

  const username = (role: string) => `e2eod${role}${SUFFIX}`;
  // Team codes are at most 10 characters.
  const SELLER_CODE = `DS${SUFFIX}`;
  const CROSS_CODE = `DX${SUFFIX}`;
  const SHIP_CODE = `DW${SUFFIX}`; // ships the cross product — no limit, the seller's return warehouse
  const LIMIT_CODE = `DL${SUFFIX}`;
  const nearCode = (r: Role) => `D8${r.key.slice(0, 1).toUpperCase()}${SUFFIX}`;
  const pendCode = (r: Role) => `DP${r.key.slice(0, 1).toUpperCase()}${SUFFIX}`;
  const MAP_CODE = `ODMAP${SUFFIX}`;
  // A borrowed product per role, case part (the refusal, the message): its map is chosen on the form every time.
  const crossSku = (r: Role, part: string) => `ODX${r.key.toUpperCase()}${part}${SUFFIX}`;
  const nearSku = (r: Role) => `OD8${r.key.toUpperCase()}${SUFFIX}`;
  const pendSku = (r: Role) => `ODP${r.key.toUpperCase()}${SUFFIX}`;
  const LIMIT_SKU = `ODWL${SUFFIX}`;
  // A fresh Order ID per test, so the duplicate warning never stands in the way.
  const ref = (r: Role, tag: string) => `OD${SUFFIX}${r.key.toUpperCase()}${tag.toUpperCase()}`;

  const ground = {
    team: "",
    crossTeam: "",
    crossName: `E2E Odl Cross ${SUFFIX}`,
    shipWarehouse: "",
    limitWarehouse: "",
    limitName: `E2E Odl Warehouse Limit ${SUFFIX}`,
    nearWarehouses: {} as Record<string, string>,
    // (payment pending) — per role: its warehouse, the warehouse's account the confirm pays into, the pending payment.
    pendWarehouses: {} as Record<string, string>,
    pendAccounts: {} as Record<string, string>,
    payments: {} as Record<string, string>,
    products: {} as Record<string, string>,
    shops: {} as Record<string, string>,
    debts: {} as Record<string, number>,
  };

  // What the seller owes `creditor` right now, as the order form and the create's check read it.
  async function debtTo(page: Page, creditor: string): Promise<number> {
    const res = await api(page, "liability.v1.LiabilityService/LiabilityCreditByIds", {
      teamId: ground.team,
      filter: { ids: [creditor] },
      dataRequest: ["LIABILITY_CREDIT_BY_IDS_DATA_TYPE_CREDIT"],
    });
    for (const item of res.items?.[creditor]?.items ?? []) {
      const credit = item.credit?.mapData?.[creditor];
      if (credit) return Number(credit.debt ?? 0);
    }
    return 0;
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    // A warehouse: its team, one rack, and its 10% fee. Returns [team, rack].
    const warehouse = async (name: string, code: string) => {
      const id = await team(name, code, "TEAM_TYPE_WAREHOUSE");
      const rack = String(
        (await api(page, "inventory.v1.RackService/RackCreate", { teamId: id, code: `od-${code.toLowerCase()}`, name: "E2E debt shelf" }))
          .rack.id,
      );
      await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: id, feePercent: FEE_PERCENT, minFee: 0 });
      return [id, rack] as const;
    };

    ground.team = await team(`E2E Odl Seller ${SUFFIX}`, SELLER_CODE, "TEAM_TYPE_SELLING");
    ground.crossTeam = await team(ground.crossName, CROSS_CODE, "TEAM_TYPE_SELLING");
    const [ship, shipRack] = await warehouse(`E2E Odl Warehouse Ship ${SUFFIX}`, SHIP_CODE);
    ground.shipWarehouse = ship;
    const [limit, limitRack] = await warehouse(ground.limitName, LIMIT_CODE);
    ground.limitWarehouse = limit;
    const nearRacks: Record<string, string> = {};
    for (const r of ROLES) {
      const [near, nearRack] = await warehouse(`E2E Odl Warehouse Near ${r.key} ${SUFFIX}`, nearCode(r));
      ground.nearWarehouses[r.key] = near;
      nearRacks[r.key] = nearRack;
    }
    const pendRacks: Record<string, string> = {};
    for (const r of ROLES) {
      const [pend, pendRack] = await warehouse(`E2E Odl Warehouse Pending ${r.key} ${SUFFIX}`, pendCode(r));
      ground.pendWarehouses[r.key] = pend;
      pendRacks[r.key] = pendRack;
    }

    const users: Record<string, string> = {};
    for (const r of ROLES) {
      const made = await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.team,
        username: username(r.key),
        password: PASSWORD,
        name: `Odl ${r.given} ${SUFFIX}`,
        role: r.role,
      });
      users[r.key] = String(made.user.id);
    }
    // The seller returns to the shipping warehouse (create refuses a team with no return warehouse).
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.team,
      warehouseId: ground.shipWarehouse,
    });

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Odl Cat ${SUFFIX}` });
    const supplierOf = async (teamId: string, tag: string) =>
      String((await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId, name: `E2E Odl Supplier ${tag} ${SUFFIX}` })).supplier.id);
    const accountOf = async (teamId: string, tail: string) => {
      const id = String(
        (
          await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
            teamId,
            type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
            provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
            name: `E2E Odl BCA ${tail} ${SUFFIX}`,
            holderName: "E2E",
            accountNumber: `85${SUFFIX}${tail}`,
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
    const supplier = await supplierOf(ground.team, "Seller");
    const crossSupplier = await supplierOf(ground.crossTeam, "Cross");
    const account = await accountOf(ground.team, "01");
    const crossAccount = await accountOf(ground.crossTeam, "02");

    const product = async (owner: string, code: string, cross: boolean) => {
      const id = String(
        (
          await api(page, "product.v1.ProductService/ProductCreate", {
            teamId: owner,
            productCodePart: code,
            name: `E2E ${code}`,
            categoryId: category.category.id,
            ...(cross ? { crossMarkupBps: CROSS_MARKUP_BPS } : {}),
          })
        ).product.id,
      );
      ground.products[code] = id;
      return id;
    };
    // 10 of each product, restocked by its owner from its supplier and accepted onto the warehouse's rack.
    const restock = async (owner: string, wh: string, rack: string, codes: string[]) => {
      const cross = owner === ground.crossTeam;
      const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: owner,
        warehouseId: wh,
        financeAccountId: cross ? crossAccount : account,
        items: codes.map((code) => ({
          productId: ground.products[code],
          productCode: code,
          name: `E2E ${code}`,
          count: STOCK,
          total: RESTOCK_TOTAL,
          supplierId: cross ? crossSupplier : supplier,
        })),
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

    // The seller's own product every borrowed product's return map points at — chosen on the form.
    await product(ground.team, MAP_CODE, false);
    // (debt to warehouse at limit) — one own product at the limited warehouse, ordered by every role.
    await product(ground.team, LIMIT_SKU, false);
    await restock(ground.team, ground.limitWarehouse, limitRack, [LIMIT_SKU]);
    // (debt at 80%) — per role, its own product at its own warehouse.
    for (const r of ROLES) {
      await product(ground.team, nearSku(r), false);
      await restock(ground.team, ground.nearWarehouses[r.key]!, nearRacks[r.key]!, [nearSku(r)]);
    }
    // (payment pending) — per role, its own product at its own warehouse.
    for (const r of ROLES) {
      await product(ground.team, pendSku(r), false);
      await restock(ground.team, ground.pendWarehouses[r.key]!, pendRacks[r.key]!, [pendSku(r)]);
    }
    // (debt to cross team at limit) — the cross team's products at the shipping warehouse: the one the earlier order
    // drew (its map written here), and per role two unmapped ones (the refusal's test, the message's test).
    const crossDebtSku = `ODXDEBT${SUFFIX}`;
    const crossCodes = [crossDebtSku, ...ROLES.flatMap((r) => [crossSku(r, "R"), crossSku(r, "M")])];
    for (const code of crossCodes) await product(ground.crossTeam, code, true);
    await restock(ground.crossTeam, ground.shipWarehouse, shipRack, crossCodes);
    await api(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
      teamId: ground.team,
      sharedProductId: ground.products[crossDebtSku],
      ownProductId: ground.products[MAP_CODE],
    });

    // A shop per role, the role on it.
    let n = 0;
    for (const r of ROLES) {
      const shop = String(
        (
          await api(page, "selling.v1.ShopService/ShopCreate", {
            teamId: ground.team,
            name: `E2E Odl Shop ${r.key} ${SUFFIX}`,
            shopCode: `D${++n}${SUFFIX}`,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
      ground.shops[r.key] = shop;
      await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: users[r.key] });
    }

    // GIVEN — the debt: one earlier order per pair, placed by root, 2 units.
    const earlier = async (tag: string, wh: string, code: string) =>
      api(page, "selling.v1.OrderService/OrderCreate", {
        idempotencyKey: `e2e-odl-${SUFFIX}-${tag}`,
        shipmentChannelId: "1",
        teamId: ground.team,
        shopId: ground.shops.own,
        warehouseId: wh,
        customerName: `E2E Earlier Buyer ${tag}`,
        platformTotal: PLATFORM_TOTAL,
        platformCreatedAtUnix: Math.floor(Date.now() / 1000),
        orderExternalRefId: `OD${SUFFIX}EARLY${tag.toUpperCase()}`,
        items: [{ productId: ground.products[code], productCode: code, name: `E2E ${code}`, quantity: QTY }],
      });
    await earlier("wl", ground.limitWarehouse, LIMIT_SKU);
    await earlier("xl", ground.shipWarehouse, crossDebtSku);
    for (const r of ROLES) await earlier(`n${r.key}`, ground.nearWarehouses[r.key]!, nearSku(r));
    for (const r of ROLES) await earlier(`p${r.key}`, ground.pendWarehouses[r.key]!, pendSku(r));

    // The fees land through the ledger's listener — wait until the debt reads, then the creditor sets its limit.
    const limitOn = async (creditor: string, debt: number, creditLimit: number) => {
      await expect.poll(() => debtTo(page, creditor), { timeout: 60_000 }).toBe(debt);
      ground.debts[creditor] = debt;
      await api(page, "liability.v1.LiabilityTermsService/LiabilityTermsSet", {
        teamId: creditor,
        counterpartyId: ground.team,
        creditLimit,
        reason: "e2e acceptance: debt limit givens",
      });
    };
    await limitOn(ground.limitWarehouse, WAREHOUSE_DEBT, WAREHOUSE_DEBT);
    await limitOn(ground.crossTeam, CROSS_DEBT, CROSS_DEBT);
    for (const r of ROLES) await limitOn(ground.nearWarehouses[r.key]!, WAREHOUSE_DEBT, WAREHOUSE_DEBT / 0.8);

    // (at credit limit · payment pending) — the pair at its limit, then the seller records a payment of the whole debt
    // from its operational account, its proof shared with the warehouse, and nobody confirms it. The warehouse gets an
    // account of its own for the confirm to pay into.
    for (const [i, r] of ROLES.entries()) {
      const wh = ground.pendWarehouses[r.key]!;
      await limitOn(wh, WAREHOUSE_DEBT, WAREHOUSE_DEBT);
      ground.pendAccounts[r.key] = await accountOf(wh, `1${i}`);
      const proof = await uploadProof(page, ground.team, wh);
      const recorded = await api(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
        teamId: ground.team,
        creditorTeamId: wh,
        amount: String(WAREHOUSE_DEBT),
        note: "e2e acceptance: the payment that would clear the debt, not yet confirmed",
        documentIds: [proof],
        fromAccountId: account,
      });
      expect(recorded.payment.status).toBe("LIABILITY_PAYMENT_STATUS_RECORDED");
      ground.payments[r.key] = String(recorded.payment.id);
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
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

  // WHEN, up to Create — the form typed in on the role's shop: the product (a borrowed one on the picker's Other tab,
  // its return map chosen on the Return Mapping card), 2 units, the order date, Rp 100.000 paid, the Order ID, JNE.
  async function fill(page: Page, r: Role, o: { warehouseCode: string; code: string; cross: boolean; orderRef: string }) {
    await page.goto("/orders/new");
    await expect(page.getByTestId("order-create-page")).toBeVisible();
    await page.getByTestId("order-create-customer-name").fill(`E2E Buyer ${r.key} ${o.orderRef}`);
    await listLanded(page.locator('[data-testid^="shop-select-option-"]'));
    await page.getByTestId("shop-select").click();
    await page.getByTestId(`shop-select-option-${ground.shops[r.key]}`).click();
    await pickTeam(page, page.getByTestId("order-warehouse"), o.warehouseCode);
    await page.getByTestId("order-create-add-line").click();
    if (o.cross) await page.getByTestId("product-picker-tab-other").click();
    await tick(page, o.code);
    await page.getByTestId("product-picker-confirm").click();
    await page.getByTestId("order-line-qty-0").fill(String(QTY));

    if (o.cross) {
      // (return map chosen) — the borrowed product has no map yet: chosen here, one of the seller's own products, and
      // confirmed (the map is written the moment it is confirmed, then locked).
      const pid = ground.products[o.code]!;
      const row = page.getByTestId(`return-map-${pid}`);
      await expect(row.getByTestId(`return-map-needs-${pid}`)).toBeVisible();
      const field = row.getByTestId("product-select").getByRole("combobox");
      await field.click();
      await field.pressSequentially(MAP_CODE, { delay: 30 });
      await page.locator('[data-testid^="product-select-option-"]').filter({ hasText: MAP_CODE }).filter({ visible: true }).first().click();
      await page.getByTestId("confirm-action").click();
      await expect(page.getByTestId(`return-map-locked-${pid}`)).toBeVisible();
    }

    await pickOrderDate(page);
    await page.getByTestId("order-marketplace-total").fill(String(PLATFORM_TOTAL));
    await page.getByTestId("order-external-ref-id").fill(o.orderRef);
    await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
    await page.getByTestId("shipment-channel-option-jne").click();
    await expect(page.getByTestId("order-create-save")).toBeEnabled();
  }

  // Create — and the OrderCreate answer it got.
  async function createAnswer(page: Page): Promise<Response> {
    const [answer] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderCreate")),
      page.getByTestId("order-create-save").click(),
    ]);
    return answer;
  }

  const limited = (c: LimitCase) =>
    c.cross
      ? { creditor: ground.crossTeam, name: ground.crossName, warehouseCode: SHIP_CODE }
      : { creditor: ground.limitWarehouse, name: ground.limitName, warehouseCode: LIMIT_CODE };
  const limitSku = (r: Role, c: LimitCase, part: "R" | "M") => (c.cross ? crossSku(r, part) : LIMIT_SKU);

  for (const c of LIMIT_CASES) {
    for (const r of ROLES) {
      test(`${r.given} create order (${c.cond})`, async ({ page }) => {
        await signIn(page, username(r.key), ground.team);
        const orderRef = ref(r, `${c.key}R`);

        // WHEN — Create, the creditor already at its limit.
        await fill(page, r, { warehouseCode: limited(c).warehouseCode, code: limitSku(r, c, "R"), cross: c.cross, orderRef });
        const answer = await createAnswer(page);

        await test.step("then: order refused", async () => {
          expect.soft(answer.status()).not.toBe(200);
          expect.soft(((await answer.json()) as { code?: string }).code).toBe("failed_precondition");
          await expect.soft(page.getByTestId("order-create-error")).toBeVisible();
          await expect.soft(page).toHaveURL(/\/orders\/new$/);
          // No order of the team carries the Order ID.
          const held = await api(page, "selling.v1.OrderService/OrderByExternalRefs", {
            teamId: ground.team,
            filter: { refs: [orderRef] },
            dataRequest: ["ORDER_BY_EXTERNAL_REFS_DATA_TYPE_ORDER_REF"],
          });
          expect.soft(held.items?.[orderRef]).toBeUndefined();
        });
      });

      test(`${r.given} create order (${c.cond}) — the refusal's message`, async ({ page }) => {
        // ⬜ untested (the owner's). This check was `test.fail` on an APP BUG — the refusal named the creditor by its
        // NUMBER ("credit limit reached with team <id>: …"), never by its name (over-the-limit-refuses-the-create: it
        // names WHICH creditor, for customer service, who cannot look it up). Fixed by backlog #74 (snapshot 982120c9):
        // the refusal names the creditor team by its name, so the check runs plain.
        await signIn(page, username(r.key), ground.team);
        const { creditor, name } = limited(c);
        const debt = new Intl.NumberFormat("id-ID").format(ground.debts[creditor]!);

        // WHEN — Create, the creditor already at its limit (debt = limit).
        await fill(page, r, {
          warehouseCode: limited(c).warehouseCode,
          code: limitSku(r, c, "M"),
          cross: c.cross,
          orderRef: ref(r, `${c.key}M`),
        });
        const answer = await createAnswer(page);
        expect(answer.status()).not.toBe(200);

        await test.step("then: message names team, debt and limit", async () => {
          const message = page.getByTestId("order-create-error");
          await expect(message).toBeVisible();
          // The creditor as customer service knows it — by its name.
          await expect.soft(message).toContainText(name);
          // The debt and the limit — the same figure here, so it is said twice.
          const text = (await message.textContent()) ?? "";
          expect.soft(text.split(debt).length - 1).toBeGreaterThanOrEqual(2);
        });
      });
    }
  }

  for (const r of ROLES) {
    test(`${r.given} create order (${NEAR_COND})`, async ({ page }) => {
      await signIn(page, username(r.key), ground.team);
      const near = ground.nearWarehouses[r.key]!;

      // WHEN — the form filled in on the warehouse the seller owes 80% of its limit.
      await fill(page, r, { warehouseCode: nearCode(r), code: nearSku(r), cross: false, orderRef: ref(r, "n8") });

      await test.step("then: has warning in frontend", async () => {
        const warn = page.getByTestId(`credit-row-${near}`).getByTestId(`credit-warn-${near}`);
        await expect.soft(warn).toBeVisible();
        await expect.soft(warn).toHaveAttribute("aria-label", "Near limit");
        // A warning, never a hold.
        await expect.soft(page.getByTestId("order-create-save")).toBeEnabled();
      });

      const answer = await createAnswer(page);

      await test.step("then: order created", async () => {
        expect.soft(answer.status()).toBe(200);
        await expect.soft(page).toHaveURL(/\/orders\/\d+$/);
        await expect.soft(page.getByTestId("order-detail-page")).toBeVisible();
        const lines = page.getByTestId("section-items").locator('[data-testid^="order-item-"]');
        await expect.soft(lines).toHaveCount(1);
        await expect.soft(lines.first()).toContainText(nearSku(r));
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
      });
    });
  }

  // docs/acceptances/balance/credit_limit.md — selling:all wants to create an order (at credit limit · payment pending).
  for (const r of ROLES) {
    test(`${r.given} create order (${PENDING_COND})`, async ({ page, browser }) => {
      await signIn(page, username(r.key), ground.team);
      const wh = ground.pendWarehouses[r.key]!;
      const orderRef = ref(r, "pp");

      // WHEN — Create on the warehouse the seller owes its whole limit, the payment that would clear it still pending.
      await fill(page, r, { warehouseCode: pendCode(r), code: pendSku(r), cross: false, orderRef });
      const refused = await createAnswer(page);

      await test.step("then: order refused until the payment is confirmed", async () => {
        // While the payment is pending — refused, and nothing taken.
        expect(refused.status()).not.toBe(200);
        expect.soft(((await refused.json()) as { code?: string }).code).toBe("failed_precondition");
        await expect.soft(page.getByTestId("order-create-error")).toBeVisible();
        await expect.soft(page).toHaveURL(/\/orders\/new$/);
        const held = await api(page, "selling.v1.OrderService/OrderByExternalRefs", {
          teamId: ground.team,
          filter: { refs: [orderRef] },
          dataRequest: ["ORDER_BY_EXTERNAL_REFS_DATA_TYPE_ORDER_REF"],
        });
        expect.soft(held.items?.[orderRef]).toBeUndefined();

        // The pending claim moved nothing: the debt still stands at the limit. Then the warehouse confirms it.
        const root = await browser.newPage();
        await login(root, ROOT_USERNAME, ROOT_PASSWORD);
        expect(await debtTo(root, wh)).toBe(WAREHOUSE_DEBT);
        const confirmed = await api(root, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
          teamId: wh,
          paymentId: ground.payments[r.key],
          toAccountId: ground.pendAccounts[r.key],
        });
        expect(confirmed.payment.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");
        await expect.poll(() => debtTo(root, wh), { timeout: 60_000 }).toBe(0);
        await root.close();

        // Confirmed — the same order, Create again on the same form, goes through.
        const created = await createAnswer(page);
        expect(created.status()).toBe(200);
        await expect(page).toHaveURL(/\/orders\/\d+$/);
        await expect.soft(page.getByTestId("order-detail-page")).toBeVisible();
        const lines = page.getByTestId("section-items").locator('[data-testid^="order-item-"]');
        await expect.soft(lines).toHaveCount(1);
        await expect.soft(lines.first()).toContainText(pendSku(r));
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
      });
    });
  }
});

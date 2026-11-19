import { expect, test } from "@playwright/test";
import type { Browser, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick } from "./restock_helpers";
import { listLanded, pickTeam } from "./pickers";

// ── set credit limit — the checks behind docs/acceptances/balance/credit_limit.md ─────────────────────────────────────
//
// set credit limit's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are
// the owner's, set by hand — never by this file.
//
// Business rules (docs/business/balance/context_decision.md):
// - the-threshold-defaults-to-unlimited — no terms row (or a NULL limit) is unlimited; 0 is NO CREDIT AT ALL and refuses
//   the very first order. A creditor's DEFAULT row (`counterparty_id = 0`, Default Terms on the liability list) applies
//   to every team without a row of its own; a team's own row wins over it whether it tightens or loosens.
// - the-threshold-warns-at-eighty-percent — at debt ≥ 80% of the limit a warning shows; it refuses nothing.
// - the-block-stops-orders-only — at or over the limit (or frozen) the next ORDER is refused, nothing else.
// - a-limit-change-is-recorded — every change is a log row: who, the old and the new limit, the reason.
// - warehouse-roles-count-as-their-own-team (+ the 2026-10-06 🔄: a warehouse's terms are its OWNER's alone) and
//   terms-are-team-scoped-root-is-global — a warehouse owner sets its warehouse's terms, a selling team's owner and admin
//   set theirs.
// - the-debtor-sees-the-limits-set-on-it (frontend) — the debtor reads the limit a creditor set on it on its own
//   /liability/<creditor> page, worded from its side.
//
// The WHEN, as the person does it: the creditor's /liability/<debtor> page → Terms → Set Terms / Edit Terms → Credit limit
// (Limit of + the amount, or Frozen, or Unlimited) → Save. The DEFAULT is set from the liability list's Default Terms.
//
// GROUND (beforeAll, as root, through the API) — every given its own creditor, so no given's limit leaks into another:
//   seller S (KLS…, a selling:owner user, one shop) and seller S2 (KLT…, no users);
//   warehouses W1…W7 (KLA…KLG), each with a warehouse:owner user; W3…W7 also a rack, a 10% fee and 10 units of a product
//   of S's own each, so S can order there through its form;
//   (debt) root places one earlier order of 2 units (Rp 20.000 of goods → Rp 2.000 fee owed to the warehouse) at W4, W5
//   and W6, and waits until LiabilityCreditByIds reads that debt;
//   (limits before the WHEN) W5 → S at Rp 2.000 (= the debt: at limit), W6 → S at Rp 10.000, W7's DEFAULT at 0 (frozen);
//   the product-fee pairs: a cross team X (KLX…, a selling:owner and a selling:admin user) with a borrowed product
//   (20% markup → Rp 12.000 a unit) at warehouse WX (KLW…); debtors D1, D2 (KLY…, KLZ…) each order 2 units of it (root) →
//   each owes X Rp 24.000 product fee, and X has no limit on either.
//
// How each then is read:
// - `limit shown on the team` — the creditor's Terms tab: the meter reads "<debt> of <limit>" and its percentage, and the
//   panel no longer says "no terms set".
// - `limit recorded in history` — the creditor's Limit changes tab: ONE change row, Unlimited → the limit, by the owner,
//   with the reason typed.
// - `selling team sees the limit set on it` — the seller's own /liability/<warehouse>: "Limit set on you" with the limit,
//   naming the warehouse as who set it.
// - `every team without its own limit follows the default` — S's and S2's Terms tabs both read the default's limit under
//   "Using the default terms", and S's own page shows that limit set on it.
// - `the team cannot create orders with this warehouse` — the seller's form, filled for 2 units at that warehouse: the
//   OrderCreate it sends is answered failed_precondition, the form stays on /orders/new with the refusal, and no order of
//   the team carries the Order ID.
// - `the team can create orders again` / `the team's own limit is used, not the default` — the same form creates: 200,
//   the order's own page, one line, pending.
// - `warning shown on liability and in the order form` — the warehouse's liability list marks S's row Near limit, its
//   Terms meter reads 80% with the Near limit badge, the seller's own liability page reads 80% of the limit, and the
//   seller's order form marks the warehouse's Debt Limits row Near limit with Create not held.

const PASSWORD = "e2e-acceptance-pass-1";
const STOCK = 10;
const RESTOCK_TOTAL = 100_000; // Rp 10.000 a unit
const QTY = 2;
const FEE_PERCENT = 10;
const PLATFORM_TOTAL = 100_000;
const CROSS_MARKUP_BPS = 2_000; // 20% — a borrowed unit costs the debtor Rp 12.000
const WAREHOUSE_DEBT = 2_000; // an earlier order's fee: 10% of Rp 20.000
const CROSS_DEBT = 24_000; // 2 × Rp 12.000

const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

// The warehouses, one per given. `stock` = S has a product there (its form can order there).
const WAREHOUSES = [
  { key: "a", code: `KLA${SUFFIX}`, stock: false }, // (1 selling team · no limit before)
  { key: "b", code: `KLB${SUFFIX}`, stock: false }, // (default limit · team without its own limit)
  { key: "c", code: `KLC${SUFFIX}`, stock: true }, // (1 selling team · limit 0)
  { key: "d", code: `KLD${SUFFIX}`, stock: true }, // (debt at 80% of the new limit)
  { key: "e", code: `KLE${SUFFIX}`, stock: true }, // (at limit · limit raised)
  { key: "f", code: `KLF${SUFFIX}`, stock: true }, // (limit lowered below debt)
  { key: "g", code: `KLG${SUFFIX}`, stock: true }, // (default limit · team set to no limit)
] as const;
type WKey = (typeof WAREHOUSES)[number]["key"];
const codeOf = (k: WKey) => WAREHOUSES.find((w) => w.key === k)!.code;
const productOf = (k: WKey) => `KLP${k.toUpperCase()}${SUFFIX}`;

const SELLING_ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own", debtor: "y" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm", debtor: "z" },
] as const;

const user = (tag: string) => `e2ekl${tag}${SUFFIX}`;
const personName = (tag: string) => `Kl ${tag} ${SUFFIX}`;

const ground = {
  seller: "",
  sellerName: `E2E Kl Seller ${SUFFIX}`,
  seller2: "",
  shop: "",
  warehouses: {} as Record<string, string>,
  warehouseNames: {} as Record<string, string>,
  cross: "",
  debtors: {} as Record<string, string>,
};

test.describe.configure({ timeout: 180_000 });

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

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const member = async (teamId: string, tag: string, role: string) =>
    api(page, "user.v1.UserService/CreateUser", { teamId, username: user(tag), password: PASSWORD, name: personName(tag), role });

  ground.seller = await team(ground.sellerName, `KLS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.seller2 = await team(`E2E Kl Seller Two ${SUFFIX}`, `KLT${SUFFIX}`, "TEAM_TYPE_SELLING");
  const sellerOwner = String((await member(ground.seller, "s", "ROLE_SELLING_OWNER")).user.id);

  const racks: Record<string, string> = {};
  for (const w of WAREHOUSES) {
    const name = `E2E Kl Warehouse ${w.key.toUpperCase()} ${SUFFIX}`;
    const id = await team(name, w.code, "TEAM_TYPE_WAREHOUSE");
    ground.warehouses[w.key] = id;
    ground.warehouseNames[w.key] = name;
    await member(id, `w${w.key}`, "ROLE_WAREHOUSE_OWNER");
    if (w.stock) {
      racks[w.key] = String(
        (await api(page, "inventory.v1.RackService/RackCreate", { teamId: id, code: `kl-${w.key}`, name: "E2E limit shelf" })).rack.id,
      );
      await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: id, feePercent: FEE_PERCENT, minFee: 0 });
    }
  }
  // The seller returns to W1 (create refuses a team with no return warehouse).
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.seller,
    warehouseId: ground.warehouses.a,
  });

  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Kl Cat ${SUFFIX}` });
  const supplierOf = async (teamId: string, tag: string) =>
    String((await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId, name: `E2E Kl Supplier ${tag} ${SUFFIX}` })).supplier.id);
  const accountOf = async (teamId: string, tail: string) => {
    const id = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Kl BCA ${tail} ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `90${SUFFIX}${tail}`,
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
  const products: Record<string, string> = {};
  const product = async (owner: string, code: string, cross: boolean) => {
    products[code] = String(
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
    return products[code]!;
  };
  // 10 units, raised by the owner from its supplier and accepted onto the warehouse's rack.
  const restock = async (owner: string, account: string, supplier: string, wh: string, rack: string, code: string) => {
    const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: owner,
      warehouseId: wh,
      financeAccountId: account,
      items: [{ productId: products[code], productCode: code, name: `E2E ${code}`, count: STOCK, total: RESTOCK_TOTAL, supplierId: supplier }],
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
  const sellerSupplier = await supplierOf(ground.seller, "Seller");
  const sellerAccount = await accountOf(ground.seller, "01");
  for (const w of WAREHOUSES.filter((x) => x.stock)) {
    await product(ground.seller, productOf(w.key), false);
    await restock(ground.seller, sellerAccount, sellerSupplier, ground.warehouses[w.key]!, racks[w.key]!, productOf(w.key));
  }
  ground.shop = String(
    (
      await api(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.seller,
        name: `E2E Kl Shop ${SUFFIX}`,
        shopCode: `KL1${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: ground.shop, userId: sellerOwner });

  // ── the product-fee pairs: X lends its product, D1 and D2 each order 2 units of it at WX.
  ground.cross = await team(`E2E Kl Cross ${SUFFIX}`, `KLX${SUFFIX}`, "TEAM_TYPE_SELLING");
  for (const r of SELLING_ROLES) await member(ground.cross, `x${r.key}`, r.role);
  const wx = await team(`E2E Kl Warehouse X ${SUFFIX}`, `KLW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const wxRack = String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: wx, code: "kl-x", name: "E2E limit shelf" })).rack.id);
  await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wx, feePercent: FEE_PERCENT, minFee: 0 });
  const crossCode = `KLXP${SUFFIX}`;
  await product(ground.cross, crossCode, true);
  await restock(ground.cross, await accountOf(ground.cross, "02"), await supplierOf(ground.cross, "Cross"), wx, wxRack, crossCode);

  const earlier = async (debtor: string, shop: string, wh: string, code: string, tag: string) =>
    api(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-kl-${SUFFIX}-${tag}`,
      shipmentChannelId: "1",
      teamId: debtor,
      shopId: shop,
      warehouseId: wh,
      customerName: `E2E Earlier Buyer ${tag}`,
      platformTotal: PLATFORM_TOTAL,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `KL${SUFFIX}EARLY${tag.toUpperCase()}`,
      items: [{ productId: products[code], productCode: code, name: `E2E ${code}`, quantity: QTY }],
    });

  let n = 1;
  for (const r of SELLING_ROLES) {
    const d = await team(`E2E Kl Debtor ${r.debtor.toUpperCase()} ${SUFFIX}`, `KL${r.debtor.toUpperCase()}${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.debtors[r.key] = d;
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: d, warehouseId: wx });
    const mapCode = `KLM${r.debtor.toUpperCase()}${SUFFIX}`;
    await product(d, mapCode, false);
    await api(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
      teamId: d,
      sharedProductId: products[crossCode],
      ownProductId: products[mapCode],
    });
    const shop = String(
      (
        await api(page, "selling.v1.ShopService/ShopCreate", {
          teamId: d,
          name: `E2E Kl Shop ${r.debtor} ${SUFFIX}`,
          shopCode: `KL${++n}${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    await earlier(d, shop, wx, crossCode, `x${r.key}`);
  }

  // GIVEN — S's debt at W4, W5, W6: one earlier order of 2 units each.
  for (const k of ["d", "e", "f"] as const) await earlier(ground.seller, ground.shop, ground.warehouses[k]!, productOf(k), k);

  // The fees land through the ledger's listener — wait until each debt reads.
  for (const k of ["d", "e", "f"] as const) {
    await expect.poll(() => debtTo(page, ground.seller, ground.warehouses[k]!), { timeout: 60_000 }).toBe(WAREHOUSE_DEBT);
  }
  for (const r of SELLING_ROLES) {
    await expect.poll(() => debtTo(page, ground.debtors[r.key]!, ground.cross), { timeout: 60_000 }).toBe(CROSS_DEBT);
  }

  // GIVEN — the limits standing before the WHEN (root writes them as an override, so with a reason).
  const terms = async (creditor: string, counterpartyId: string, creditLimit: number) =>
    api(page, "liability.v1.LiabilityTermsService/LiabilityTermsSet", {
      teamId: creditor,
      counterpartyId,
      creditLimit,
      reason: "e2e acceptance: set credit limit givens",
    });
  await terms(ground.warehouses.e!, ground.seller, WAREHOUSE_DEBT); // at limit
  await terms(ground.warehouses.f!, ground.seller, 10_000); // above the debt, to be lowered below it
  await terms(ground.warehouses.g!, "0", 0); // the DEFAULT: frozen

  await page.close();
});

async function signInAs(page: Page, tag: string, teamId: string) {
  await login(page, user(tag), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// The creditor's Terms tab on its page for `debtor`.
async function openTerms(page: Page, debtor: string) {
  await page.goto(`/liability/${debtor}`);
  await expect(page.getByTestId("liability-detail-page")).toBeVisible();
  await page.getByTestId("liability-detail-tab-terms").click();
  await expect(page.getByTestId("terms-panel")).toBeVisible();
}

// WHEN — the Terms dialog (already open): the credit limit chosen, an optional reason, Save; the dialog closes.
async function saveLimit(page: Page, limit: number | "frozen" | "unlimited", reason = "") {
  if (limit === "frozen") {
    await page.getByTestId("terms-limit-frozen").click();
  } else if (limit === "unlimited") {
    await page.getByTestId("terms-limit-unlimited").click();
  } else {
    await page.getByTestId("terms-limit-capped").click();
    await page.getByTestId("terms-limit-amount").fill(String(limit));
  }
  if (reason) await page.getByTestId("terms-reason").fill(reason);
  await page.getByTestId("terms-submit").click();
  await expect(page.getByTestId("terms-submit")).toBeHidden();
}

// WHEN — the creditor sets a debtor's own limit from the pair's Terms tab.
async function setLimit(page: Page, debtor: string, limit: number | "frozen" | "unlimited", reason = "") {
  await openTerms(page, debtor);
  await page.getByTestId("terms-edit").click();
  await saveLimit(page, limit, reason);
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

// The seller's order form, typed in up to Create: S's shop, the warehouse, 2 units of S's product there, the order date,
// Rp 100.000 paid, a fresh Order ID, JNE.
async function fill(page: Page, k: WKey, orderRef: string) {
  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await page.getByTestId("order-create-customer-name").fill(`E2E Buyer ${orderRef}`);
  await listLanded(page.locator('[data-testid^="shop-select-option-"]'));
  await page.getByTestId("shop-select").click();
  await page.getByTestId(`shop-select-option-${ground.shop}`).click();
  await pickTeam(page, page.getByTestId("order-warehouse"), codeOf(k));
  await page.getByTestId("order-create-add-line").click();
  await tick(page, productOf(k));
  await page.getByTestId("product-picker-confirm").click();
  await page.getByTestId("order-line-qty-0").fill(String(QTY));
  await pickOrderDate(page);
  await page.getByTestId("order-marketplace-total").fill(String(PLATFORM_TOTAL));
  await page.getByTestId("order-external-ref-id").fill(orderRef);
  await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
  await page.getByTestId("shipment-channel-option-jne").click();
  await expect(page.getByTestId("order-create-save")).toBeEnabled();
}

async function createAnswer(page: Page): Promise<Response> {
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderCreate")),
    page.getByTestId("order-create-save").click(),
  ]);
  return answer;
}

// The seller, on a page of its own, orders at warehouse `k` — and the answer it got.
async function sellerOrders(browser: Browser, k: WKey, tag: string) {
  const seller = await browser.newPage();
  await signInAs(seller, "s", ground.seller);
  const orderRef = `KL${SUFFIX}${tag.toUpperCase()}`;
  await fill(seller, k, orderRef);
  return { seller, orderRef, answer: await createAnswer(seller) };
}

// Refused BY THE LIMIT — not by stock or anything else that is also failed_precondition: the refusal on the form names
// the credit limit and the warehouse that set it (over-the-limit-refuses-the-create).
async function expectRefused(seller: Page, answer: Response, orderRef: string, k: WKey) {
  expect.soft(answer.status()).not.toBe(200);
  expect.soft(((await answer.json()) as { code?: string }).code).toBe("failed_precondition");
  const message = seller.getByTestId("order-create-error");
  await expect.soft(message).toBeVisible();
  await expect.soft(message).toContainText("credit limit");
  await expect.soft(message).toContainText(ground.warehouseNames[k]!);
  await expect.soft(seller).toHaveURL(/\/orders\/new$/);
  // No order of the team carries the Order ID.
  const held = await api(seller, "selling.v1.OrderService/OrderByExternalRefs", {
    teamId: ground.seller,
    filter: { refs: [orderRef] },
    dataRequest: ["ORDER_BY_EXTERNAL_REFS_DATA_TYPE_ORDER_REF"],
  });
  expect.soft(held.items?.[orderRef]).toBeUndefined();
}

async function expectCreated(seller: Page, answer: Response, k: WKey) {
  expect.soft(answer.status()).toBe(200);
  await expect.soft(seller).toHaveURL(/\/orders\/\d+$/);
  await expect.soft(seller.getByTestId("order-detail-page")).toBeVisible();
  const lines = seller.getByTestId("section-items").locator('[data-testid^="order-item-"]');
  await expect.soft(lines).toHaveCount(1);
  await expect.soft(lines.first()).toContainText(productOf(k));
  await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
}

test.describe("warehouse:owner wants to cap a team's debt (1 selling team · no limit before)", () => {
  test("warehouse:owner set credit limit", async ({ page, browser }) => {
    const limit = 50_000;
    const reason = `agreed with their owner ${SUFFIX}`;
    await signInAs(page, "wa", ground.warehouses.a!);

    // GIVEN — no limit before.
    await openTerms(page, ground.seller);
    await expect(page.getByTestId("terms-none")).toBeVisible();

    // WHEN — Set Terms → Limit of Rp 50.000, a reason, Save.
    await page.getByTestId("terms-edit").click();
    await saveLimit(page, limit, reason);

    await test.step("then: limit shown on the team", async () => {
      const meter = page.getByTestId("terms-panel-meter");
      await expect.soft(meter).toContainText(`${rp(0)} of ${rp(limit)}`);
      await expect.soft(page.getByTestId("terms-panel-meter-pct")).toHaveText("0%");
      await expect.soft(page.getByTestId("terms-none")).toHaveCount(0);
      await expect.soft(page.getByTestId("terms-inherited")).toHaveCount(0);
    });

    await test.step("then: limit recorded in history", async () => {
      await page.getByTestId("liability-detail-tab-limits").click();
      await expect.soft(page.getByTestId("terms-history")).toBeVisible();
      const rows = page.getByTestId("terms-history-table").locator('[data-testid^="terms-change-"]');
      await expect.soft(rows).toHaveCount(1);
      await expect.soft(rows.first()).toContainText("Unlimited");
      await expect.soft(rows.first()).toContainText(rp(limit));
      await expect.soft(rows.first()).toContainText(personName("wa"));
      await expect.soft(rows.first()).toContainText(reason);
    });

    await test.step("then: selling team sees the limit set on it", async () => {
      const seller = await browser.newPage();
      await signInAs(seller, "s", ground.seller);
      await seller.goto(`/liability/${ground.warehouses.a}`);
      await expect.soft(seller.getByTestId("liability-detail-page")).toBeVisible();
      const onYou = seller.getByTestId("limit-on-you");
      await expect.soft(onYou).toBeVisible();
      await expect.soft(seller.getByTestId("limit-on-you-meter")).toContainText(rp(limit));
      await expect.soft(onYou).toContainText(ground.warehouseNames.a!);
      await seller.close();
    });
  });
});

test.describe("warehouse:owner wants to cap a team's debt (default limit · team without its own limit)", () => {
  test("warehouse:owner set credit limit", async ({ page, browser }) => {
    const limit = 30_000;
    await signInAs(page, "wb", ground.warehouses.b!);

    // WHEN — the liability list's Default Terms → Limit of Rp 30.000, Save.
    await page.goto("/liability");
    await expect(page.getByTestId("liability-list-page")).toBeVisible();
    await page.getByTestId("liability-default-terms").click();
    await expect(page.getByTestId("terms-counterparty-fixed")).toContainText("Default");
    await saveLimit(page, limit);

    await test.step("then: every team without its own limit follows the default", async () => {
      // Both sellers, neither with a row of its own: the default's limit, said to be the default.
      for (const debtor of [ground.seller, ground.seller2]) {
        await openTerms(page, debtor);
        await expect.soft(page.getByTestId("terms-inherited")).toBeVisible();
        await expect.soft(page.getByTestId("terms-panel-meter")).toContainText(`of ${rp(limit)}`);
      }
      // And the seller reads that limit as set on it.
      const seller = await browser.newPage();
      await signInAs(seller, "s", ground.seller);
      await seller.goto(`/liability/${ground.warehouses.b}`);
      await expect.soft(seller.getByTestId("limit-on-you-meter")).toContainText(rp(limit));
      await seller.close();
    });
  });
});

test.describe("warehouse:owner wants to cap a team's debt (1 selling team · limit 0)", () => {
  test("warehouse:owner set credit limit", async ({ page, browser }) => {
    await signInAs(page, "wc", ground.warehouses.c!);

    // WHEN — Set Terms → Frozen (no credit), Save.
    await setLimit(page, ground.seller, "frozen");
    await expect(page.getByTestId("terms-panel-meter")).toContainText("Frozen");

    await test.step("then: the team cannot create orders with this warehouse", async () => {
      const { seller, orderRef, answer } = await sellerOrders(browser, "c", "c0");
      await expectRefused(seller, answer, orderRef, "c");
      await seller.close();
    });
  });
});

test.describe("warehouse:owner wants to cap a team's debt (1 selling team · debt at 80% of the new limit)", () => {
  test("warehouse:owner set credit limit", async ({ page, browser }) => {
    const limit = WAREHOUSE_DEBT / 0.8; // Rp 2.500 — the Rp 2.000 owed is 80% of it
    await signInAs(page, "wd", ground.warehouses.d!);

    // WHEN — Set Terms → Limit of Rp 2.500, Save.
    await setLimit(page, ground.seller, limit);

    await test.step("then: warning shown on liability and in the order form", async () => {
      // The warehouse's Terms meter: 80%, Near limit.
      await expect.soft(page.getByTestId("terms-panel-meter")).toContainText(`${rp(WAREHOUSE_DEBT)} of ${rp(limit)}`);
      await expect.soft(page.getByTestId("terms-panel-meter-pct")).toHaveText("80%");
      await expect.soft(page.getByTestId("terms-panel-meter-warn")).toHaveText("Near limit");
      // The warehouse's liability list: S's row marked near its limit.
      await page.goto("/liability");
      await expect.soft(page.getByTestId(`liability-row-${ground.seller}`)).toBeVisible();
      await expect.soft(page.getByTestId(`liability-near-limit-${ground.seller}`)).toContainText("80%");

      const seller = await browser.newPage();
      await signInAs(seller, "s", ground.seller);
      // The seller's own liability page: 80% of the limit the warehouse set.
      await seller.goto(`/liability/${ground.warehouses.d}`);
      await expect.soft(seller.getByTestId("limit-on-you-meter-warn")).toContainText("80% of the limit");
      // The seller's order form: the warehouse's Debt Limits row marked Near limit — a warning, never a hold.
      await fill(seller, "d", `KL${SUFFIX}D8`);
      const warn = seller.getByTestId(`credit-row-${ground.warehouses.d}`).getByTestId(`credit-warn-${ground.warehouses.d}`);
      await expect.soft(warn).toBeVisible();
      await expect.soft(warn).toHaveAttribute("aria-label", "Near limit");
      await expect.soft(seller.getByTestId("order-create-save")).toBeEnabled();
      await seller.close();
    });
  });
});

test.describe("selling:owner · selling:admin wants to cap a team's debt (1 selling team owes product fee · no limit before)", () => {
  for (const r of SELLING_ROLES) {
    test(`${r.given} set credit limit`, async ({ page }) => {
      const limit = 50_000;
      const debtor = ground.debtors[r.key]!;
      await signInAs(page, `x${r.key}`, ground.cross);

      // GIVEN — the debtor owes the product fee, no limit before.
      await openTerms(page, debtor);
      await expect(page.getByTestId("terms-none")).toBeVisible();

      // WHEN — Set Terms → Limit of Rp 50.000, Save.
      await page.getByTestId("terms-edit").click();
      await saveLimit(page, limit);

      await test.step("then: limit shown on the team", async () => {
        await expect.soft(page.getByTestId("terms-panel-meter")).toContainText(`${rp(CROSS_DEBT)} of ${rp(limit)}`);
        await expect.soft(page.getByTestId("terms-panel-meter-pct")).toHaveText("48%");
        await expect.soft(page.getByTestId("terms-none")).toHaveCount(0);
      });
    });
  }
});

test.describe("warehouse:owner wants to cap a team's debt (1 selling team · at limit · limit raised)", () => {
  test("warehouse:owner set credit limit", async ({ page, browser }) => {
    const limit = 10_000;
    await signInAs(page, "we", ground.warehouses.e!);

    // GIVEN — at limit: Rp 2.000 owed of Rp 2.000.
    await openTerms(page, ground.seller);
    await expect(page.getByTestId("terms-panel-meter")).toContainText(`${rp(WAREHOUSE_DEBT)} of ${rp(WAREHOUSE_DEBT)}`);

    // WHEN — Edit Terms → Limit of Rp 10.000, Save.
    await page.getByTestId("terms-edit").click();
    await saveLimit(page, limit);
    await expect(page.getByTestId("terms-panel-meter")).toContainText(`of ${rp(limit)}`);

    await test.step("then: the team can create orders again", async () => {
      const { seller, answer } = await sellerOrders(browser, "e", "e1");
      await expectCreated(seller, answer, "e");
      await seller.close();
    });
  });
});

test.describe("warehouse:owner wants to cap a team's debt (1 selling team · limit lowered below debt)", () => {
  test("warehouse:owner set credit limit", async ({ page, browser }) => {
    const limit = 1_000;
    await signInAs(page, "wf", ground.warehouses.f!);

    // GIVEN — Rp 2.000 owed of Rp 10.000.
    await openTerms(page, ground.seller);
    await expect(page.getByTestId("terms-panel-meter")).toContainText(`${rp(WAREHOUSE_DEBT)} of ${rp(10_000)}`);

    // WHEN — Edit Terms → Limit of Rp 1.000, Save.
    await page.getByTestId("terms-edit").click();
    await saveLimit(page, limit);
    await expect(page.getByTestId("terms-panel-meter")).toContainText(`${rp(WAREHOUSE_DEBT)} of ${rp(limit)}`);

    await test.step("then: the team cannot create orders with this warehouse", async () => {
      const { seller, orderRef, answer } = await sellerOrders(browser, "f", "f1");
      await expectRefused(seller, answer, orderRef, "f");
      await seller.close();
    });
  });
});

test.describe("warehouse:owner wants to cap a team's debt (default limit · team set to no limit)", () => {
  test("warehouse:owner set credit limit", async ({ page, browser }) => {
    await signInAs(page, "wg", ground.warehouses.g!);

    // GIVEN — the warehouse's default is Frozen, and S has no row of its own, so it follows it.
    await openTerms(page, ground.seller);
    await expect(page.getByTestId("terms-inherited")).toBeVisible();
    await expect(page.getByTestId("terms-panel-meter")).toContainText("Frozen");

    // WHEN — Set Terms → Unlimited, Save: S's own row, with no limit.
    await page.getByTestId("terms-edit").click();
    await saveLimit(page, "unlimited");

    await test.step("then: the team's own limit is used, not the default", async () => {
      // The Terms tab reads S's own row — Unlimited — and no longer the default's.
      await expect.soft(page.getByTestId("terms-inherited")).toHaveCount(0);
      await expect.soft(page.getByTestId("terms-panel-meter")).toHaveText("Unlimited");
      // The frozen default would refuse S's order: S's own Unlimited lets it through.
      const { seller, answer } = await sellerOrders(browser, "g", "g1");
      await expectCreated(seller, answer, "g");
      await seller.close();
    });
  });
});

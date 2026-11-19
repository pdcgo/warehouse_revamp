import { expect, test } from "@playwright/test";
import type { Browser, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick } from "./restock_helpers";
import { listLanded, pickTeam } from "./pickers";

// ── remove credit limit — the checks behind docs/acceptances/balance/credit_limit.md ──────────────────────────────────
//
// remove credit limit's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the
// checks for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows'
// statuses are the owner's, set by hand — never by this file.
//
// Business rules (docs/business/balance/context_decision.md):
// - the-threshold-defaults-to-unlimited — no terms row is unlimited; 0 is NO CREDIT AT ALL. Removing a limit means
//   DELETING the pair's row, never zeroing it — so the pair falls back to the creditor's DEFAULT row (counterparty 0)
//   when there is one, and to unlimited when there is none.
// - a-limit-change-is-recorded — every change is a log row: the pair, the actor, the old and the new limit; a NULL new
//   limit is "they removed the limit", never "they froze the team".
// - the-block-stops-orders-only — a frozen limit refuses the next ORDER.
//
// The WHEN, as the person does it: the creditor's /liability/<debtor> page → Terms → Remove Terms → confirm Remove.
//
// GROUND (beforeAll, as root, through the API):
//   seller S (LRS…, a selling:owner user, one shop, returning to W2);
//   warehouses W1 (LRA…) and W2 (LRB…), each with a warehouse:owner user, a rack, a 10% fee and 10 units of a product
//   of S's own, so S can order at either through its form;
//   (limits before the WHEN, root with a reason) W1's DEFAULT frozen (0) and W1 → S at Rp 50.000 of its own;
//   W2 → S frozen (0) of its own, and no default at W2.
// The two limits are picked so the WHEN changes what an order does: at W1 S could order under its own Rp 50.000 and the
// frozen default refuses it once the row is gone; at W2 S's own frozen row refused it and nothing does once it is gone.
//
// How each then is read:
// - `the team follows the default again` — W1's Terms tab reads the default (Frozen) under "Using the default terms",
//   with Remove Terms gone; S's own /liability/<W1> reads that W1 allows it no credit; S's form order at W1 is refused by
//   the credit limit, naming W1.
// - `removal recorded in history` — W1's Limit changes tab for S: one row more than before, the newest, by W1's owner,
//   Rp 50.000 → Unlimited (the NULL a removal logs).
// - `the team has no limit` — W2's Terms tab reads "No terms set — unlimited credit" and Unlimited, no default; the
//   credit S's form reads for W2 carries no limit; S's form order at W2 creates (200, its page, one line, pending).

const PASSWORD = "e2e-acceptance-pass-1";
const STOCK = 10;
const RESTOCK_TOTAL = 100_000; // Rp 10.000 a unit
const QTY = 2;
const FEE_PERCENT = 10;
const PLATFORM_TOTAL = 100_000;
const OWN_LIMIT = 50_000;

const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

const WAREHOUSES = [
  { key: "a", code: `LRA${SUFFIX}` }, // (team limit · default set)
  { key: "b", code: `LRB${SUFFIX}` }, // (team limit · no default)
] as const;
type WKey = (typeof WAREHOUSES)[number]["key"];
const codeOf = (k: WKey) => WAREHOUSES.find((w) => w.key === k)!.code;
const productOf = (k: WKey) => `LRP${k.toUpperCase()}${SUFFIX}`;

const user = (tag: string) => `e2elr${tag}${SUFFIX}`;
const personName = (tag: string) => `Lr ${tag} ${SUFFIX}`;

const ground = {
  seller: "",
  sellerName: `E2E Lr Seller ${SUFFIX}`,
  shop: "",
  warehouses: {} as Record<string, string>,
  warehouseNames: {} as Record<string, string>,
};

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const member = async (teamId: string, tag: string, role: string) =>
    api(page, "user.v1.UserService/CreateUser", { teamId, username: user(tag), password: PASSWORD, name: personName(tag), role });

  ground.seller = await team(ground.sellerName, `LRS${SUFFIX}`, "TEAM_TYPE_SELLING");
  const sellerOwner = String((await member(ground.seller, "s", "ROLE_SELLING_OWNER")).user.id);

  const racks: Record<string, string> = {};
  for (const w of WAREHOUSES) {
    const name = `E2E Lr Warehouse ${w.key.toUpperCase()} ${SUFFIX}`;
    const id = await team(name, w.code, "TEAM_TYPE_WAREHOUSE");
    ground.warehouses[w.key] = id;
    ground.warehouseNames[w.key] = name;
    await member(id, `w${w.key}`, "ROLE_WAREHOUSE_OWNER");
    racks[w.key] = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: id, code: `lr-${w.key}`, name: "E2E limit shelf" })).rack.id,
    );
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: id, feePercent: FEE_PERCENT, minFee: 0 });
  }
  // The seller returns to W2 (create refuses a team with no return warehouse).
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.seller,
    warehouseId: ground.warehouses.b,
  });

  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Lr Cat ${SUFFIX}` });
  const supplier = String(
    (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.seller, name: `E2E Lr Supplier ${SUFFIX}` })).supplier.id,
  );
  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Lr BCA ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `91${SUFFIX}01`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: account,
    operational: true,
  });

  // 10 units of S's own product at each warehouse, raised from its supplier and accepted onto the rack.
  for (const w of WAREHOUSES) {
    const code = productOf(w.key);
    const productId = String(
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.seller,
          productCodePart: code,
          name: `E2E ${code}`,
          categoryId: category.category.id,
        })
      ).product.id,
    );
    const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: ground.warehouses[w.key],
      financeAccountId: account,
      items: [{ productId, productCode: code, name: `E2E ${code}`, count: STOCK, total: RESTOCK_TOTAL, supplierId: supplier }],
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouses[w.key],
      requestId: raised.request.id,
      lines: (raised.request.items as { id: string }[]).map((item) => ({
        itemId: item.id,
        receivedCount: STOCK,
        placements: [{ placementId: racks[w.key], quantity: STOCK }],
      })),
    });
  }

  ground.shop = String(
    (
      await api(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.seller,
        name: `E2E Lr Shop ${SUFFIX}`,
        shopCode: `LR1${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: ground.shop, userId: sellerOwner });

  // GIVEN — the limits standing before the WHEN (root writes them as an override, so with a reason).
  const terms = async (creditor: string, counterpartyId: string, creditLimit: number) =>
    api(page, "liability.v1.LiabilityTermsService/LiabilityTermsSet", {
      teamId: creditor,
      counterpartyId,
      creditLimit,
      reason: "e2e acceptance: remove credit limit givens",
    });
  await terms(ground.warehouses.a!, "0", 0); // W1's DEFAULT: frozen
  await terms(ground.warehouses.a!, ground.seller, OWN_LIMIT); // S's own limit at W1, which wins over the default
  await terms(ground.warehouses.b!, ground.seller, 0); // S's own limit at W2: frozen — and no default at W2

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

// The pair's change-log rows (Limit changes tab), newest first.
async function historyRows(page: Page) {
  await page.getByTestId("liability-detail-tab-limits").click();
  await expect(page.getByTestId("terms-history")).toBeVisible();
  return page.getByTestId("terms-history-table").locator('[data-testid^="terms-change-"]');
}

// WHEN — Terms → Remove Terms → confirm Remove; the pair's own row is gone, so the Remove button goes with it.
async function removeLimit(page: Page) {
  await page.getByTestId("terms-delete").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("confirm-action")).toBeHidden();
  await expect(page.getByTestId("terms-delete")).toHaveCount(0);
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

// The seller, on a page of its own, orders at warehouse `k` — and the answer it got.
async function sellerOrders(browser: Browser, k: WKey, tag: string) {
  const seller = await browser.newPage();
  await signInAs(seller, "s", ground.seller);
  const orderRef = `LR${SUFFIX}${tag.toUpperCase()}`;
  await fill(seller, k, orderRef);
  const [answer] = await Promise.all([
    seller.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderCreate")),
    seller.getByTestId("order-create-save").click(),
  ]);
  return { seller, orderRef, answer };
}

// Refused BY THE LIMIT — not by stock or anything else that is also failed_precondition: the refusal on the form names
// the credit limit and the warehouse that set it.
async function expectRefused(seller: Page, answer: Response, orderRef: string, k: WKey) {
  expect.soft(answer.status()).not.toBe(200);
  expect.soft(((await answer.json()) as { code?: string }).code).toBe("failed_precondition");
  const message = seller.getByTestId("order-create-error");
  await expect.soft(message).toBeVisible();
  await expect.soft(message).toContainText("credit limit");
  await expect.soft(message).toContainText(ground.warehouseNames[k]!);
  await expect.soft(seller).toHaveURL(/\/orders\/new$/);
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

test.describe("warehouse:owner wants to lift a team's own limit (team limit · default set)", () => {
  test("warehouse:owner remove credit limit", async ({ page, browser }) => {
    await signInAs(page, "wa", ground.warehouses.a!);

    // GIVEN — S's own Rp 50.000 at W1, not the default (which is Frozen); one change logged so far.
    await openTerms(page, ground.seller);
    await expect(page.getByTestId("terms-panel-meter")).toContainText(`of ${rp(OWN_LIMIT)}`);
    await expect(page.getByTestId("terms-inherited")).toHaveCount(0);
    const before = await (await historyRows(page)).count();
    expect(before).toBeGreaterThanOrEqual(1);
    await page.getByTestId("liability-detail-tab-terms").click();

    // WHEN — Remove Terms → Remove.
    await removeLimit(page);

    await test.step("then: the team follows the default again", async () => {
      // W1's Terms tab: the default's Frozen, said to be the default.
      await expect.soft(page.getByTestId("terms-inherited")).toBeVisible();
      await expect.soft(page.getByTestId("terms-panel-meter")).toContainText("Frozen");
      await expect.soft(page.getByTestId("terms-none")).toHaveCount(0);
      // S's own page reads the default as set on it.
      const own = await browser.newPage();
      await signInAs(own, "s", ground.seller);
      await own.goto(`/liability/${ground.warehouses.a}`);
      await expect.soft(own.getByTestId("limit-on-you-meter")).toContainText(`${ground.warehouseNames.a} allows you no credit`);
      await own.close();
      // And it is what the create obeys: the order S's own Rp 50.000 allowed is now refused by the frozen default.
      const { seller, orderRef, answer } = await sellerOrders(browser, "a", "a1");
      await expectRefused(seller, answer, orderRef, "a");
      await seller.close();
    });

    await test.step("then: removal recorded in history", async () => {
      await page.goto(`/liability/${ground.seller}`);
      await expect(page.getByTestId("liability-detail-page")).toBeVisible();
      const rows = await historyRows(page);
      await expect.soft(rows).toHaveCount(before + 1);
      // The newest row is the removal: by W1's owner, Rp 50.000 → Unlimited (the NULL a removal logs).
      const removal = rows.first();
      await expect.soft(removal).toContainText(personName("wa"));
      await expect.soft(removal).toContainText(/Rp\s*50\.000\s*Unlimited/);
      await expect.soft(rows.filter({ hasText: personName("wa") })).toHaveCount(1);
    });
  });
});

test.describe("warehouse:owner wants to lift a team's own limit (team limit · no default)", () => {
  test("warehouse:owner remove credit limit", async ({ page, browser }) => {
    await signInAs(page, "wb", ground.warehouses.b!);

    // GIVEN — S's own row at W2 is Frozen, and W2 has no default.
    await openTerms(page, ground.seller);
    await expect(page.getByTestId("terms-panel-meter")).toContainText("Frozen");
    await expect(page.getByTestId("terms-inherited")).toHaveCount(0);

    // WHEN — Remove Terms → Remove.
    await removeLimit(page);

    await test.step("then: the team has no limit", async () => {
      // W2's Terms tab: nothing set, unlimited — and not a default standing in.
      await expect.soft(page.getByTestId("terms-none")).toBeVisible();
      await expect.soft(page.getByTestId("terms-panel-meter")).toHaveText("Unlimited");
      await expect.soft(page.getByTestId("terms-inherited")).toHaveCount(0);

      const { seller, answer } = await sellerOrders(browser, "b", "b1");
      // The credit the seller's form reads for W2 carries no limit.
      const credit = await api(seller, "liability.v1.LiabilityService/LiabilityCreditByIds", {
        teamId: ground.seller,
        filter: { ids: [ground.warehouses.b] },
        dataRequest: ["LIABILITY_CREDIT_BY_IDS_DATA_TYPE_CREDIT"],
      });
      for (const item of credit.items?.[ground.warehouses.b!]?.items ?? []) {
        expect.soft(item.credit?.mapData?.[ground.warehouses.b!]?.creditLimit).toBeUndefined();
      }
      // And the order the frozen row refused now creates.
      await expectCreated(seller, answer, "b");
      await seller.close();
    });
  });
});

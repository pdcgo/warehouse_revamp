import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api } from "./restock_helpers";
import { openShops } from "./pickers";

// THE SETTLEMENT-IMPORT ACCEPTANCE SPECS' SHARED HELPERS (settlement_selling_wants_to_import*.spec.ts) — the ground a
// selling team needs to have orders a statement can name, the Import File dialog driven as a person drives it, and the
// screens each then is read on. Not a spec file — it holds no test — so Playwright never runs it.

export const PASSWORD = "e2e-acceptance-pass-1";

// `selling:all` — every role of a selling team (docs/acceptances/guide.md, status-is-per-then).
export const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own", n: 1 },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm", n: 2 },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs", n: 3 },
] as const;
export type Role = (typeof ROLES)[number];

export const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** What the marketplace paid for every order placed here — the order's Estimate (its selling price). */
export const PLATFORM_TOTAL = 100_000;

export type Ground = {
  tag: string;
  team: string;
  warehouse: string;
  productId: string;
  code: string;
  users: Record<Role["key"], string>;
  usernames: Record<Role["key"], string>;
};

/**
 * A selling team of its own (`tag` keeps it apart from every other spec's) with a user per selling role, a warehouse
 * charging 10% that it returns to, and ONE product restocked `stock` units onto a rack there — the stock every order of
 * the spec takes one unit of. Seeded by root, through the real contract.
 */
export async function sellingGround(page: Page, tag: string, stock: number): Promise<Ground> {
  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  const g: Ground = {
    tag,
    team: await team(`E2E Imp Seller ${tag} ${SUFFIX}`, `${tag}S${SUFFIX}`, "TEAM_TYPE_SELLING"),
    warehouse: await team(`E2E Imp Warehouse ${tag} ${SUFFIX}`, `${tag}W${SUFFIX}`, "TEAM_TYPE_WAREHOUSE"),
    productId: "",
    code: `IMP${tag}${SUFFIX}`,
    users: { own: "", adm: "", cs: "" },
    usernames: { own: "", adm: "", cs: "" },
  };

  for (const r of ROLES) {
    const username = `e2eim${tag.toLowerCase()}${r.key}${SUFFIX}`;
    const made = await api(page, "user.v1.UserService/CreateUser", {
      teamId: g.team,
      username,
      password: PASSWORD,
      name: `Imp ${tag} ${r.given} ${SUFFIX}`,
      role: r.role,
    });
    g.users[r.key] = String(made.user.id);
    g.usernames[r.key] = username;
  }

  await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: g.warehouse, feePercent: 10, minFee: 0 });
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: g.team,
    warehouseId: g.warehouse,
  });
  const rack = String(
    (await api(page, "inventory.v1.RackService/RackCreate", { teamId: g.warehouse, code: `imp-${tag.toLowerCase()}`, name: "E2E import shelf" }))
      .rack.id,
  );

  const supplier = String(
    (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: g.team, name: `E2E Imp Supplier ${tag} ${SUFFIX}` }))
      .supplier.id,
  );
  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Imp Cat ${tag} ${SUFFIX}` });
  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: g.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Imp BCA ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-IMP-${tag}-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: g.team,
    accountId: account,
    operational: true,
  });

  g.productId = String(
    (
      await api(page, "product.v1.ProductService/ProductCreate", {
        teamId: g.team,
        productCodePart: g.code,
        name: `E2E ${g.code}`,
        categoryId: category.category.id,
      })
    ).product.id,
  );
  // Rp 10.000 a unit — so every order carries a known cost, and its settlement draws the True margin card.
  const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: g.team,
    warehouseId: g.warehouse,
    financeAccountId: account,
    items: [{ productId: g.productId, productCode: g.code, name: `E2E ${g.code}`, count: stock, total: stock * 10_000, supplierId: supplier }],
  });
  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: g.warehouse,
    requestId: raised.request.id,
    lines: [{ itemId: raised.request.items[0].id, receivedCount: stock, placements: [{ placementId: rack, quantity: stock }] }],
  });

  return g;
}

/** A shop of the ground's team on `marketplace`; `grant` users are added to it — the first becomes its primary CS. */
export async function shopOf(
  page: Page,
  g: Ground,
  name: string,
  code: string,
  marketplace: "MARKETPLACE_SHOPEE" | "MARKETPLACE_TIKTOK",
  grant: string[],
): Promise<string> {
  const shop = String((await api(page, "selling.v1.ShopService/ShopCreate", { teamId: g.team, name, shopCode: code, marketplace })).shop.id);
  for (const userId of grant) {
    await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: g.team, shopId: shop, userId });
  }
  return shop;
}

/** One order on `shop` carrying the marketplace's `ref` — 1 unit, the marketplace paid PLATFORM_TOTAL, placed by root. */
export async function orderOf(page: Page, g: Ground, shop: string, ref: string): Promise<string> {
  const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-imp-${ref}`,
    shipmentChannelId: "1",
    teamId: g.team,
    shopId: shop,
    warehouseId: g.warehouse,
    customerName: `E2E Imp Buyer ${ref}`,
    platformTotal: PLATFORM_TOTAL,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: ref,
    items: [{ productId: g.productId, productCode: g.code, name: `E2E ${g.code}`, quantity: 1 }],
  });
  return String(placed.order.id);
}

/**
 * Penyelesaian › Impor › Import File, as a person does it: pick the shop, attach the statement, Start Import. The
 * dialog picks the import by the shop's marketplace. Returns the dialog, still streaming.
 */
export async function importThroughDialog(page: Page, shop: string, file: Buffer, name = "statement.xlsx"): Promise<Locator> {
  await page.goto("/settlement/imports");
  await page.getByTestId("open-import-file").click();

  const dialog = page.getByTestId("import-dialog");
  await expect(dialog).toBeVisible();

  await openShops(dialog);
  await dialog.getByTestId(`shop-select-option-${shop}`).click();

  await dialog.getByTestId("import-file-input").setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: file,
  });
  await expect(dialog.getByTestId("import-file-name")).toContainText(name);
  await dialog.getByTestId("start-import").click();

  return dialog;
}

/** The order's settlement ledger (its own page), once loaded: every entry row. */
export async function ledgerOf(page: Page, orderId: string): Promise<Locator> {
  await page.goto(`/orders/${orderId}`);
  const panel = page.getByTestId("order-ledger-panel");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  // The sale's own row is posted when the order is placed — a ledger showing it has loaded.
  await expect(entriesOfType(panel, "Estimate")).toHaveCount(1, { timeout: 5_000 });
  await settled(page);
  return panel;
}

/** The ledger's rows of one type, by its business word ("Payout", "Estimate", "Shipping reimbursed", …). */
export function entriesOfType(panel: Locator, type: string): Locator {
  return panel
    .locator('[data-testid^="entry-"]')
    .filter({ has: panel.page().locator('[data-testid^="ledger-type-"]', { hasText: new RegExp(`^\\s*${type}\\s*$`) }) });
}

/** The shop's entries on Penyelesaian › Shop entries (narrowed to the shop, and to a kind when given), once counted. */
export async function shopEntries(page: Page, shop: string, kind = ""): Promise<{ count: Locator; amounts: Locator }> {
  await page.goto(`/settlement/shop-entries?shop=${shop}${kind ? `&kind=${kind}` : ""}`);
  const count = page.getByTestId("shop-entries-count");
  await expect(count).toHaveText(/^\d+$/, { timeout: 5_000 });
  await settled(page);
  return { count, amounts: page.locator('[data-testid^="shop-entry-amount-"]') };
}

/** Penyelesaian › Impor narrowed to the shop: its uploads, newest first. */
export async function importsOf(page: Page, shop: string): Promise<Locator> {
  await page.goto(`/settlement/imports?shop=${shop}`);
  await expect(page.getByTestId("imports-table")).toBeVisible({ timeout: 5_000 });
  await settled(page);
  return page.locator('[data-testid^="import-row-"]');
}

/**
 * The page's load has finished talking to the server — its CheckAccess pair answered among the rest. A spec that polls
 * a screen by navigating again (expect.toPass around a goto) must not navigate while the last load's CheckAccess is in
 * flight: the navigation aborts it. Until #92/#96 the app dropped the token on ANY CheckAccess failure, so the next load
 * opened on Sign in (seen once in an affected run, 2026-11-19); now an aborted check keeps the token and retries, but a
 * settled page is still the clean point to navigate from.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

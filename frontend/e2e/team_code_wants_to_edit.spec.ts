import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page, Request } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";

// THE TEAM CODE EDIT ON SCREEN — acceptance docs/acceptances/teams/team_code.md, action *edit team code*, givens 1–2
// (backlog #150 on the #149 backend), end to end on the real server and Postgres. The rules
// (docs/business/product/context_decision.md):
//
//   a-team-code-change-recomposes-its-product-codes — a SELLING team's code is changed by its owner / admin (Settings'
//     *Kode tim* card) and by root / the administrator (Teams → Edit Team); every product of the team takes
//     `<new>-<part>`; the products a warehouse holds on a shelf are tagged `need_reprint_code` until it reprints; past
//     orders, restocks and transfers keep the code they were written with; the old code stays the team's (taken for good);
//     the product's history names old → new, who, when;
//   products-have-their-own-tag-list — the owning team AND every warehouse holding the stock see the tag; the Products
//     list filters by tag;
//   the-team-code-and-product-tags-prototype-is-accepted — Save opens the four-line confirm (products · reprint · past ·
//     former), its figures read from TeamCodePreview when it opens; Change Code sends TeamCodeUpdate; Edit Team shows the
//     code field for a selling team and never sends an untouched code; the product page's *Riwayat Produk* card.
//
// The ground, all the spec's own (root seeds through the API in beforeAll): per role test a selling team of its OWN (a
// code changes once) with 2 products, a warehouse of its own holding both on a rack (one restock, accepted onto it), and
// a past order on the team's shop shipped from that warehouse; one more selling team (the viewer) that reads Discover.
// Each test drives the WHEN on screen, then reads every then where a person reads it.

const PASSWORD = "e2e-team-code-edit-1";
const APP_TAG = "need_reprint_code";
const CASE = "(team code ABC · changed to XYZ · 2 products · past orders and restocks · 1 warehouse holding stock)";

const SELLING = "TEAM_TYPE_SELLING";
const WAREHOUSE = "TEAM_TYPE_WAREHOUSE";

// One ground per role test. Team codes: at most 10 characters, apart from every other SUFFIX importer's (`TC${SUFFIX}`
// is transfers.spec's — a different string); the code changed TO is fresh too, since a code once held stays taken.
const KEYS = ["own", "adm", "root"] as const;
type Key = (typeof KEYS)[number];
const LETTER: Record<Key, string> = { own: "O", adm: "A", root: "R" };
const OLD = (k: Key) => `TCO${LETTER[k]}${SUFFIX}`;
const NEW = (k: Key) => `TCN${LETTER[k]}${SUFFIX}`;
const WH_CODE = (k: Key) => `TCW${LETTER[k]}${SUFFIX}`;
const VIEW_CODE = `TCVW${SUFFIX}`;
const UNTOUCHED_CODE = `TCUT${SUFFIX}`;

// The person of each ground who reads the team's own screens: the owner / admin who changes the code (given 1), and for
// root's ground (given 2) the team's own owner.
const PERSON: Record<Key, { username: string; name: string; role: string }> = {
  own: { username: `e2etcown${SUFFIX}`, name: `TC Owner ${SUFFIX}`, role: "ROLE_SELLING_OWNER" },
  adm: { username: `e2etcadm${SUFFIX}`, name: `TC Admin ${SUFFIX}`, role: "ROLE_SELLING_ADMIN" },
  root: { username: `e2etcrdr${SUFFIX}`, name: `TC Reader ${SUFFIX}`, role: "ROLE_SELLING_OWNER" },
};
const STAFF = (k: Key) => `e2etcst${LETTER[k].toLowerCase()}${SUFFIX}`;
const VIEWER = `e2etcvwr${SUFFIX}`;

// The two products' parts (the team's half of a code).
const PARTS = [`KA${SUFFIX}`, `TP${SUFFIX}`] as const;

type Product = { id: string; part: string; name: string; item: string };
type Ground = {
  team: string;
  teamName: string;
  warehouse: string;
  whName: string;
  p: Product[];
  restock: string;
  order: string;
};

const ground = {
  app: "",
  viewer: "",
  untouched: "",
  g: {} as Record<Key, Ground>,
};

const oldCode = (k: Key, p: Product) => `${OLD(k)}-${p.part}`;
const newCode = (k: Key, p: Product) => `${NEW(k)}-${p.part}`;

// `user` signed in, working in `team` (the active team is per tab, in sessionStorage).
async function as(page: Page, user: string, password: string, team?: string) {
  await login(page, user, password);
  if (team) await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
}

async function pageAs(browser: Browser, user: string, password: string, team?: string) {
  const page = await browser.newPage();
  await as(page, user, password, team);

  return page;
}

// Pick one tag in a list's Tag filter (inside `scope`): the list opened, the name typed to narrow it, the option clicked.
async function pickTag(scope: Page | Locator, tagId: string, name: string) {
  const input = scope.getByTestId("product-tag-filter-input");
  const option = scope.getByTestId(`product-tag-filter-option-${tagId}`);
  // The filter's list lands once (ProductTagList) and the field remounts with it — opened before, it closes again.
  await expect(async () => {
    await input.click();
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await input.fill(name);
  await option.click();
  await expect(scope.getByTestId(`product-tag-filter-pick-${tagId}`)).toBeVisible();
}

const tagParam = (page: Page) => (new URL(page.url()).searchParams.get("tag") ?? "").split(",").filter(Boolean).sort();

// The seller's wide list's product rows (⚠ `product-row-tags-…` sits under the `product-row-` prefix too).
const sellerRows = (page: Page) => page.getByTestId("products-table").locator('tbody tr[data-testid^="product-row-"]');
// The warehouse's wide list's rows.
const stockRows = (page: Page) => page.getByTestId("inventory-table").locator('tbody tr[data-testid^="stock-row-"]');

const isRpc = (r: Request, method: string) => r.method() === "POST" && r.url().endsWith(`/warehouse.${method}`);

// A ProductList request whose filter carries the tag — proof the server was asked for the narrowed list.
function asksTag(r: Request, tagId: string) {
  if (!isRpc(r, "product.v1.ProductService/ProductList")) return false;
  try {
    const body = JSON.parse(r.postData() ?? "{}") as { filter?: { tagIds?: string[] } };

    return (body.filter?.tagIds ?? []).map(String).includes(tagId);
  } catch {
    return false;
  }
}

// The four lines of the confirm — what TeamCodePreview said when it opened (the-team-code-and-product-tags-prototype-is-
// accepted, *the confirm*).
async function confirmReads(page: Page, k: Key, preview: Record<string, unknown>) {
  const g = ground.g[k];
  const dialog = page.getByRole("alertdialog", { name: `Change the team code to ${NEW(k)}?` });
  await expect(dialog).toBeVisible();
  const lines = dialog.getByTestId("team-code-confirm");

  // The preview's own answer: it CHANGES, 2 products, the one warehouse holding them on a shelf.
  expect(preview.verdict, JSON.stringify(preview)).toBe("TEAM_CODE_PREVIEW_VERDICT_CHANGES");
  expect(preview.products, JSON.stringify(preview)).toBe(2);
  expect(preview.warehouseNames, JSON.stringify(preview)).toEqual([g.whName]);

  // Its example is one of the two products, old → new.
  const examples = g.p.map(
    (p) => `2 products take the new code — ${oldCode(k, p)} becomes ${newCode(k, p)}, and so on.`,
  );
  const products = ((await lines.getByTestId("team-code-confirm-products").textContent()) ?? "").trim();
  expect(examples, `the products line: ${products}`).toContain(products);
  await expect(lines.getByTestId("team-code-confirm-reprint")).toHaveText(
    `Each warehouse holding their stock reprints the labels: ${g.whName}. Until it has, the products carry the tag ${APP_TAG}.`,
  );
  await expect(lines.getByTestId("team-code-confirm-past")).toHaveText(
    "Past orders, restocks and transfers keep the code they were written with.",
  );
  await expect(lines.getByTestId("team-code-confirm-former")).toHaveText(
    `${OLD(k)} stays this team's: an old sticker still finds its product, and no other team can take ${OLD(k)}.`,
  );

  return dialog;
}

// THE WHEN on Settings' *Kode tim* card (given 1): type the new code, Save opens the confirm (TeamCodePreview read then),
// Change Code sends TeamCodeUpdate.
async function editOnSettings(page: Page, k: Key) {
  await page.goto("/settings");
  const card = page.getByTestId("settings-team-code-card");
  const field = card.getByTestId("settings-team-code");
  await expect(field).toHaveValue(OLD(k));
  await expect(field).toBeEnabled();
  await expect(card.getByTestId("settings-team-code-help")).toHaveText("Up to 10 characters. The old code stays this team's.");
  await expect(card.getByTestId("settings-team-code-hint")).toHaveCount(0);
  await expect(card.getByTestId("save-team-code")).toBeDisabled();

  await field.fill(NEW(k));
  await expect(card.getByTestId("settings-team-code-change")).toHaveText(`${OLD(k)} → ${NEW(k)}`);

  const asked = page.waitForResponse((r) => isRpc(r.request(), "team.v1.TeamService/TeamCodePreview"));
  await card.getByTestId("save-team-code").click();
  const preview = await asked;
  expect(preview.status()).toBe(200);
  const dialog = await confirmReads(page, k, (await preview.json()) as Record<string, unknown>);

  const saved = page.waitForResponse((r) => isRpc(r.request(), "team.v1.TeamService/TeamCodeUpdate"));
  await dialog.getByTestId("confirm-action").click();
  const update = await saved;
  expect(update.status(), await update.text()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`The team code is ${NEW(k)} now — 2 products took the new code.`)).toBeVisible();
}

// THE WHEN on root's Teams → Edit Team (given 2): the code field in place of the fixed line, the same confirm.
async function editOnTeams(root: Page, k: Key) {
  const g = ground.g[k];
  await root.goto("/teams?type=selling");
  await expect(root.getByTestId(`team-row-${OLD(k)}`)).toBeVisible();
  await root.getByTestId(`row-actions-team-${OLD(k)}`).click();
  await root.getByTestId(`edit-team-${OLD(k)}`).click();

  const field = root.getByTestId("edit-team-code");
  await expect(field).toHaveValue(OLD(k));
  await expect(root.getByTestId("edit-team-code-help")).toHaveText(
    "The team's products take the new code; the warehouses holding their stock reprint the labels.",
  );
  await expect(root.getByTestId("edit-team-type-fixed")).toHaveText("The type is fixed after creation.");
  await expect(root.getByTestId("edit-team-name")).toHaveValue(g.teamName);

  await field.fill(NEW(k));
  const asked = root.waitForResponse((r) => isRpc(r.request(), "team.v1.TeamService/TeamCodePreview"));
  await root.getByTestId("submit-edit-team").click();
  const preview = await asked;
  expect(preview.status()).toBe(200);
  const dialog = await confirmReads(root, k, (await preview.json()) as Record<string, unknown>);

  const saved = root.waitForResponse((r) => isRpc(r.request(), "team.v1.TeamService/TeamCodeUpdate"));
  await dialog.getByTestId("confirm-action").click();
  const update = await saved;
  expect(update.status(), await update.text()).toBe(200);
  await expect(dialog).toBeHidden();
  // The code first, then the name and description as before — the dialog closes on both saved.
  await expect(field).toHaveCount(0);
}

// ── The thens, each read on the screen where a person reads it ─────────────────────────────────────────────────────

// The team's Settings card reads the new code — after a reload too (the server's answer, not the typed field).
async function settingsShows(page: Page, k: Key) {
  await page.goto("/settings");
  const card = page.getByTestId("settings-team-code-card");
  await expect(card.getByTestId("settings-team-code")).toHaveValue(NEW(k));
  await expect(card.getByTestId("settings-team-code-lead")).toHaveText(
    `The prefix in front of every product code this team owns — ${NEW(k)}-….`,
  );
  await expect(card.getByTestId("settings-team-code-change")).toHaveCount(0);
}

// The team's Products list: both rows under the new code, none under the old.
async function codesOnList(page: Page, k: Key) {
  const g = ground.g[k];
  await page.goto("/products");
  await expect(sellerRows(page)).toHaveCount(2, { timeout: 15_000 });
  for (const p of g.p) {
    const row = page.getByTestId(`product-row-${newCode(k, p)}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(newCode(k, p));
    expect(newCode(k, p).startsWith(`${NEW(k)}-`)).toBe(true);
    await expect(page.getByTestId(`product-row-${oldCode(k, p)}`)).toHaveCount(0);
  }
  await expect(page.getByTestId("products-table")).not.toContainText(OLD(k));
}

// The same list: each row's need_reprint_code chip, locked.
async function tagsOnList(page: Page, k: Key) {
  const g = ground.g[k];
  for (const p of g.p) {
    const chip = page.getByTestId(`product-row-tags-${newCode(k, p)}-${ground.app}`);
    await expect(chip).toHaveText(APP_TAG);
    await expect(chip.getByTestId(`product-row-tags-${newCode(k, p)}-${ground.app}-lock`)).toBeVisible();
  }
}

// The Tag filter picked on need_reprint_code: the server asked with it, the 2 products listed.
async function filteredList(page: Page, k: Key) {
  const g = ground.g[k];
  const filtered = page.waitForRequest((r) => asksTag(r, ground.app));
  await pickTag(page.getByTestId("product-tag-filter"), ground.app, APP_TAG);
  await page.keyboard.press("Escape");
  await filtered;
  await expect.poll(() => tagParam(page)).toEqual([ground.app]);
  await expect(page.getByTestId(`product-tag-filter-pick-${ground.app}`)).toBeVisible();
  await expect(sellerRows(page)).toHaveCount(2);
  for (const p of g.p) await expect(page.getByTestId(`product-row-${newCode(k, p)}`)).toBeVisible();
}

// Each product's page: its code is the new one, and Riwayat Produk lists old → new, who, when.
async function historyShows(page: Page, k: Key, by: string | null) {
  const g = ground.g[k];
  for (const p of g.p) {
    const logs = (
      await api(page, "product.v1.ProductService/ProductLogList", {
        teamId: g.team,
        productId: p.id,
        page: { page: 1, limit: 10 },
      })
    ).logs as { id: string }[];
    expect(logs, `${p.name}'s history`).toHaveLength(1);
    const line = `product-history-line-${logs[0]!.id}`;

    await page.goto(`/products/${p.id}`);
    await expect(page.getByTestId("product-detail-page")).toBeVisible();
    await expect(page.getByTestId("product-detail-sku")).toContainText(newCode(k, p));
    const card = page.getByTestId("pd-section-history");
    await expect(card.getByTestId("product-history")).toBeVisible();
    await expect(card.locator('[data-testid^="product-history-line-"][data-testid$="-old"]')).toHaveCount(1);
    await expect(card.getByTestId(line)).toContainText("Code changed");
    await expect(card.getByTestId(`${line}-old`)).toHaveText(oldCode(k, p));
    await expect(card.getByTestId(`${line}-new`)).toHaveText(newCode(k, p));
    await expect(card.getByTestId(`${line}-at`)).not.toBeEmpty();
    if (by) await expect(card.getByTestId(`${line}-by`)).toContainText(`by ${by}`);
    else await expect(card.getByTestId(`${line}-by`)).toContainText("by ");
  }
}

// Root's Teams list: the team's row under the new code.
async function teamsListShows(root: Page, k: Key) {
  const g = ground.g[k];
  await root.goto("/teams?type=selling");
  const row = root.getByTestId(`team-row-${NEW(k)}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(g.teamName);
  await expect(row.locator("td").nth(1)).toHaveText(NEW(k));
  await expect(root.getByTestId(`team-row-${OLD(k)}`)).toHaveCount(0);
}

// Another selling team's Discover, narrowed to this team: both cards under the new code, none under the old.
async function discoverShows(browser: Browser, k: Key) {
  const g = ground.g[k];
  const viewer = await pageAs(browser, VIEWER, PASSWORD);
  await viewer.goto(`/products/discover?team=${g.team}`);
  await expect(viewer.getByTestId("discover-page")).toBeVisible();
  await expect(viewer.getByTestId("discover-count")).toContainText("2 products", { timeout: 15_000 });
  for (const p of g.p) {
    const card = viewer.getByTestId(`discover-card-${newCode(k, p)}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(newCode(k, p));
    await expect(viewer.getByTestId(`discover-card-${oldCode(k, p)}`)).toHaveCount(0);
  }
  await expect(viewer.getByTestId("discover-grid")).not.toContainText(OLD(k));
  await viewer.close();
}

// The team's order page and restock page: their lines still carry the code they were written with.
async function pastKeepOld(page: Page, k: Key) {
  const g = ground.g[k];
  await page.goto(`/orders/${g.order}`);
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  for (const p of g.p) {
    const line = page.getByTestId(`order-item-${p.item}`);
    await expect(line).toContainText(oldCode(k, p));
    await expect(line).not.toContainText(NEW(k));
  }

  await page.goto(`/inventories/restock/${g.restock}`);
  for (const p of g.p) {
    const line = page.getByTestId(`restock-detail-item-${p.id}`);
    await expect(line).toContainText(oldCode(k, p));
    await expect(line).not.toContainText(NEW(k));
  }
}

// The warehouse holding the stock: its Products list filtered by the tag, and its product page's locked chip.
async function warehouseSeesTag(browser: Browser, k: Key) {
  const g = ground.g[k];
  const staff = await pageAs(browser, STAFF(k), PASSWORD);
  await staff.goto(`/products?tag=${ground.app}`);
  await expect(staff.getByTestId("warehouse-products-page")).toBeVisible();
  await expect(stockRows(staff)).toHaveCount(2, { timeout: 15_000 });
  for (const p of g.p) await expect(staff.getByTestId(`stock-tags-${newCode(k, p)}-${ground.app}`)).toHaveText(APP_TAG);

  for (const p of g.p) {
    await staff.goto(`/inventories/products/${p.id}`);
    await expect(staff.getByTestId("warehouse-product-page")).toContainText(newCode(k, p));
    await expect(staff.getByTestId(`wp-tags-${ground.app}`)).toHaveText(APP_TAG);
    await expect(staff.getByTestId(`wp-tags-${ground.app}-lock`)).toBeVisible();
  }
  await staff.close();
}

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const user = (teamId: string, username: string, name: string, role: string) =>
    api(page, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name, role });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

  // The viewer: another selling team, its owner reading Discover.
  ground.viewer = await team(`E2E TC Viewer ${SUFFIX}`, VIEW_CODE, SELLING);
  await user(ground.viewer, VIEWER, `TC Viewer ${SUFFIX}`, "ROLE_SELLING_OWNER");
  // A selling team whose Edit Team saves its name only (the untouched-code regression).
  ground.untouched = await team(`E2E TC Untouched ${SUFFIX}`, UNTOUCHED_CODE, SELLING);

  const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E TC Cat ${SUFFIX}` })).category.id;

  for (const k of KEYS) {
    const L = LETTER[k];
    const teamName = `E2E TC Seller ${L} ${SUFFIX}`;
    const whName = `E2E TC Gudang ${L} ${SUFFIX}`;
    const seller = await team(teamName, OLD(k), SELLING);
    const warehouse = await team(whName, WH_CODE(k), WAREHOUSE);
    await user(seller, PERSON[k].username, PERSON[k].name, PERSON[k].role);
    await user(warehouse, STAFF(k), `TC Staff ${L} ${SUFFIX}`, "ROLE_WAREHOUSE_STAFF");

    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `tc-${L}-${SUFFIX}`, name: "E2E team code" })).rack
        .id,
    );

    const p: Product[] = [];
    for (const part of PARTS) {
      const name = `E2E TC ${part.slice(0, 2)} ${L} ${SUFFIX}`;
      const made = await api(page, "product.v1.ProductService/ProductCreate", { teamId: seller, productCodePart: part, name, categoryId: category });
      expect(made.product.productCode).toBe(`${OLD(k)}-${part}`);
      p.push({ id: String(made.product.id), part, name, item: "" });
    }

    // Both products onto W's rack: one restock, accepted whole onto it — W then holds them on a shelf.
    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E TC BCA ${L} ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-TCE-${L}-${SUFFIX}`,
          openingBalance: 0,
          openingOn: today,
        })
      ).account.id,
    );
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: seller, accountId: account, operational: true });
    const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: seller,
      warehouseId: warehouse,
      financeAccountId: account,
      items: p.map((x) => ({ productId: x.id, productCode: `${OLD(k)}-${x.part}`, name: x.name, count: 5, total: 50_000 })),
    });
    const items = restock.request.items as { id: string; productId: string }[];
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: restock.request.id,
      lines: items.map((item) => ({ itemId: item.id, receivedCount: 5, placements: [{ placementId: rack, quantity: 5 }] })),
    });

    // A past order on the team's shop, shipped from W.
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: seller, warehouseId: warehouse });
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 1, minFee: 0 });
    const shop = String(
      (
        await api(page, "selling.v1.ShopService/ShopCreate", {
          teamId: seller,
          name: `E2E TC Shop ${L} ${SUFFIX}`,
          shopCode: `TCS${L}${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: seller, shopId: shop, userId: ROOT_USER_ID });
    const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-team-code-${L}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: seller,
      shopId: shop,
      warehouseId: warehouse,
      customerName: `E2E TC Buyer ${L} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `TC${SUFFIX}O${L}`,
      receiptCode: `JTC${SUFFIX}R${L}`,
      items: p.map((x) => ({ productId: x.id, productCode: `${OLD(k)}-${x.part}`, name: x.name, quantity: 1 })),
    });
    const order = String(placed.order.id);
    for (const item of placed.order.items as { id: string; productId: string }[]) {
      p.find((x) => x.id === String(item.productId))!.item = String(item.id);
    }
    for (const to of ["PROCESSED", "PICKED", "SHIPPING"]) {
      const res = await api(page, "selling.v1.OrderService/OrderStatusChange", { teamId: warehouse, orderIds: [order], to: `ORDER_STATUS_${to}` });
      expect(res.results[0]?.moved, `${order} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
    }

    ground.g[k] = { team: seller, teamName, warehouse, whName, p, restock: String(restock.request.id), order };
  }

  // The app's own tag — found by its name in the products' tag list.
  const tags = (await api(page, "product.v1.ProductService/ProductTagList", { teamId: ground.g.own.team, q: APP_TAG, page: { page: 1, limit: 50 } }))
    .tags as { id: string; name: string }[];
  const app = (tags ?? []).filter((t) => t.name === APP_TAG);
  expect(app, `the ${APP_TAG} tag`).toHaveLength(1);
  ground.app = String(app[0]!.id);

  await page.close();
});

test.describe(`selling owner · admin wants to change their team's code ${CASE}`, () => {
  for (const [k, role] of [
    ["own", "selling:owner"],
    ["adm", "selling:admin"],
  ] as const) {
    test(`${role} edit team code ${CASE}`, async ({ page, browser }) => {
      const person = PERSON[k];
      await as(page, person.username, PASSWORD);

      await test.step("regression: the Kode tim card → the four-line confirm (TeamCodePreview's figures) → Change Code (TeamCodeUpdate)", async () => {
        await editOnSettings(page, k);
      });

      await test.step("then: team code becomes XYZ", async () => {
        await settingsShows(page, k);
      });

      await test.step("then: codes of 2 products start with XYZ", async () => {
        await codesOnList(page, k);
      });

      await test.step("then: 2 products tagged need_reprint_code", async () => {
        await tagsOnList(page, k);
      });

      await test.step("then: Products list filtered by need_reprint_code shows 2 products", async () => {
        await filteredList(page, k);
      });

      await test.step("then: product history shows old code and new code", async () => {
        await historyShows(page, k, person.name);
      });

      await test.step("then: Teams list shows XYZ", async () => {
        const root = await pageAs(browser, ROOT_USERNAME, ROOT_PASSWORD);
        await teamsListShows(root, k);
        await root.close();
      });

      await test.step("then: other teams see new codes on Discover Product", async () => {
        await discoverShows(browser, k);
      });

      await test.step("then: past orders and restocks keep old code", async () => {
        await pastKeepOld(page, k);
      });

      await test.step("then: warehouse holding stock sees need_reprint_code", async () => {
        await warehouseSeesTag(browser, k);
      });
    });
  }
});

test.describe(`root:administrator wants to change a selling team's code ${CASE}`, () => {
  test(`root:administrator edit team code ${CASE}`, async ({ page, browser }) => {
    const k: Key = "root";
    await as(page, ROOT_USERNAME, ROOT_PASSWORD);

    await test.step("regression: Teams → Edit Team's code field → the four-line confirm (TeamCodePreview's figures) → Change Code (TeamCodeUpdate)", async () => {
      await editOnTeams(page, k);
    });

    await test.step("then: team code becomes XYZ", async () => {
      await teamsListShows(page, k);
      // Edit Team opened again reads the new code.
      await page.getByTestId(`row-actions-team-${NEW(k)}`).click();
      await page.getByTestId(`edit-team-${NEW(k)}`).click();
      await expect(page.getByTestId("edit-team-code")).toHaveValue(NEW(k));
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("edit-team-code")).toHaveCount(0);
    });

    // The team's own screens, read by the team's owner.
    const reader = await pageAs(browser, PERSON.root.username, PASSWORD);

    await test.step("then: codes of 2 products start with XYZ", async () => {
      await codesOnList(reader, k);
    });

    await test.step("then: 2 products tagged need_reprint_code", async () => {
      await tagsOnList(reader, k);
    });

    await test.step("then: Products list filtered by need_reprint_code shows 2 products", async () => {
      await filteredList(reader, k);
    });

    await test.step("then: product history shows old code and new code", async () => {
      // Root changed it: the line names root, not the reader.
      await historyShows(reader, k, null);
    });

    await test.step("then: team's Settings shows XYZ", async () => {
      await settingsShows(reader, k);
    });

    await test.step("then: other teams see new codes on Discover Product", async () => {
      await discoverShows(browser, k);
    });

    await test.step("then: past orders and restocks keep old code", async () => {
      await pastKeepOld(reader, k);
    });

    await test.step("then: warehouse holding stock sees need_reprint_code", async () => {
      await warehouseSeesTag(browser, k);
    });

    await reader.close();
  });
});

// Not an acceptance then: Edit Team on a SELLING team with the code left as it is saves the name only — no
// TeamCodePreview, no TeamCodeUpdate on the wire (the hand-off's *an untouched code is never sent*).
test("regression: root's Edit Team on a selling team with the code untouched saves the name only — no code read or write sent", async ({
  page,
}) => {
  await as(page, ROOT_USERNAME, ROOT_PASSWORD);
  const sent: string[] = [];
  page.on("request", (r) => {
    if (isRpc(r, "team.v1.TeamService/TeamCodePreview") || isRpc(r, "team.v1.TeamService/TeamCodeUpdate")) sent.push(r.url());
  });

  await page.goto("/teams?type=selling");
  await page.getByTestId(`row-actions-team-${UNTOUCHED_CODE}`).click();
  await page.getByTestId(`edit-team-${UNTOUCHED_CODE}`).click();
  await expect(page.getByTestId("edit-team-code")).toHaveValue(UNTOUCHED_CODE);
  await page.getByTestId("edit-team-name").fill(`E2E TC Untouched ${SUFFIX} renamed`);
  const updated = page.waitForResponse((r) => isRpc(r.request(), "team.v1.TeamService/TeamUpdate"));
  await page.getByTestId("submit-edit-team").click();
  expect((await updated).status()).toBe(200);
  await expect(page.getByTestId("edit-team-code")).toHaveCount(0);

  const row = page.getByTestId(`team-row-${UNTOUCHED_CODE}`);
  await expect(row).toContainText(`E2E TC Untouched ${SUFFIX} renamed`);
  await expect(row.locator("td").nth(1)).toHaveText(UNTOUCHED_CODE);
  expect(sent).toEqual([]);
});

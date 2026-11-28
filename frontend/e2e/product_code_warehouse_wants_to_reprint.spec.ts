import { expect, test } from "@playwright/test";
import type { Browser, Page, Response } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";

// THE REPRINT CLEARS THE TAG — acceptance docs/acceptances/teams/team_code.md, ## reprint, givens 3 and 4 (when:
// reprint product code), every warehouse role (warehouse:all = owner, admin, staff), on the real server and Postgres
// (backlog #151 on #149's code change and #147/#148's tags). The rules (docs/business/product/context_decision.md):
//
//   a-team-code-change-recomposes-its-product-codes — `<old>-<part>` becomes `<new>-<part>`; a product some warehouse
//     holds on a shelf is tagged `need_reprint_code` (one wait per holding warehouse); its ✅ #151 line: the tag lasts until
//     the sticker is reprinted — each holding warehouse prints on Reprint Codes, the tag comes off after the last;
//   products-have-their-own-tag-list, 🔄 *what takes need_reprint_code off* — A: the app, once the new labels are
//     printed; with stock in several warehouses the tag stays until each of them has printed; a NEW print of the tagged
//     products' placements, opened from the warehouse's Products list;
//   the-team-code-and-product-tags-prototype-is-accepted, row *the reprint* — *Reprint codes (N)* on the warehouse's
//     Products list (N = products still waiting at THIS warehouse) → the Reprint Codes page: one label per shelf spot
//     (new code QR + SKU, the spot, its quantity; the old code beside the product); Print counts as this warehouse's
//     print; the tag comes off once every warehouse holding stock has printed.
//
// The ground (root seeds through the API; each role on its OWN selling team and warehouse(s), since a print clears that
// team's tags): a selling team S with its owner, products restocked into the warehouse(s) and accepted onto racks, then
// S's owner changes the team's code (TeamCodeUpdate, as the_product_tags.spec.ts's #149 test) — the held products are
// tagged. The role then drives the reprint through the warehouse's screens.
//   given 3 — W holds S's P1 on two racks (A ×2, B ×3) and P2 on rack A (×4): 2 tagged products on 3 shelf spots; W also
//             holds U's product on rack A — U a selling team whose code never changed (shared by the roles), so it is
//             held but untagged, to prove the reprint shows only tagged products.
//   given 4 — S's P sits in W1 (rack ×3) and W2 (rack ×2); the role prints in W1. W2's read is by a W2 user of the SAME
//             role (a member of W2 only: the reprint page reads the current warehouse team).
// The print dialog is stubbed (`window.print` counted) — headless opens none.

const PASSWORD = "e2e-reprint-code-1";
const APP_TAG = "need_reprint_code";
const RPC = "product.v1.ProductService";
const REPRINT_LIST = "inventory.v1.InventoryService/ProductReprintList";
const REPRINT_RECORD = "inventory.v1.InventoryService/ProductReprintRecord";

const C3 = "2 products tagged need_reprint_code · stock on 3 shelf spots";
const C4 = "1 product tagged need_reprint_code · stock in 2 warehouses · only 1 has printed";

const ROLES = [
  { key: "o", given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER" },
  { key: "a", given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN" },
  { key: "s", given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF" },
] as const;
type Key = (typeof ROLES)[number]["key"];

// Team codes: at most 10 characters (4 + the 6-digit SUFFIX), apart from every other SUFFIX importer's (`RP`/`RQ` + a
// digit or H/J/K/U are free), and a code changed TO is never one held before. Written out so a grep sees each one.
//   old3/new3 — given 3's seller before/after the change; wh3 — given 3's warehouse;
//   old4/new4 — given 4's seller; w1/w2 — given 4's two warehouses.
const CODES: Record<Key, { old3: string; new3: string; wh3: string; old4: string; new4: string; w1: string; w2: string }> = {
  o: { old3: `RP3O${SUFFIX}`, new3: `RQ3O${SUFFIX}`, wh3: `RPHO${SUFFIX}`, old4: `RP4O${SUFFIX}`, new4: `RQ4O${SUFFIX}`, w1: `RPJO${SUFFIX}`, w2: `RPKO${SUFFIX}` },
  a: { old3: `RP3A${SUFFIX}`, new3: `RQ3A${SUFFIX}`, wh3: `RPHA${SUFFIX}`, old4: `RP4A${SUFFIX}`, new4: `RQ4A${SUFFIX}`, w1: `RPJA${SUFFIX}`, w2: `RPKA${SUFFIX}` },
  s: { old3: `RP3S${SUFFIX}`, new3: `RQ3S${SUFFIX}`, wh3: `RPHS${SUFFIX}`, old4: `RP4S${SUFFIX}`, new4: `RQ4S${SUFFIX}`, w1: `RPJS${SUFFIX}`, w2: `RPKS${SUFFIX}` },
};
// Given 3's untagged team — its code never changes.
const OTHER_CODE = `RPUN${SUFFIX}`;

type Product = { id: string; name: string; old: string; now: string };
type Tag = { id: string; name: string };

// WHAT A QR SAYS, read without a decoder (the_labels_read_in_one_call.spec.ts's pattern): the shape the sticker's own QR
// component draws for a text at every level and quiet zone — the check pins the CONTENT, not how it is drawn.
function qrShapes(text: string): Set<string> {
  const shapes = new Set<string>();
  for (const level of ["L", "M", "Q", "H"] as const) {
    for (let marginSize = 0; marginSize <= 4; marginSize++) {
      shapes.add(shapeOf(renderToStaticMarkup(createElement(QRCodeSVG, { value: text, level, marginSize }))));
    }
  }

  return shapes;
}

function shapeOf(svg: string): string {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? "";
  const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);

  return `${viewBox}|${paths.join("|")}`;
}

const sorted = (xs: unknown[] | undefined) => (xs ?? []).map(String).sort();

// `user` signed in, working in `team` (the active team is per tab, in sessionStorage).
async function as(page: Page, user: string, team: string) {
  await login(page, user, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
}

async function pageAs(browser: Browser, user: string, team: string) {
  const page = await browser.newPage();
  await as(page, user, team);

  return page;
}

// The warehouse's wide Products list rows; the seller's wide list rows (⚠ `…-tags-…` ids share these prefixes).
const stockRows = (page: Page) => page.getByTestId("inventory-table").locator('tbody tr[data-testid^="stock-row-"]');
const sellerRows = (page: Page) => page.getByTestId("products-table").locator('tbody tr[data-testid^="product-row-"]');
// The reprint sheet's product groups (⚠ `reprint-product-<id>-code|-former` share the prefix, one level down).
const reprintGroups = (page: Page) => page.getByTestId("reprint-sheet").locator(':scope > [data-testid^="reprint-product-"]');

// ---- seeding (root, through the API) ----

async function team(page: Page, name: string, teamCode: string, type: "TEAM_TYPE_SELLING" | "TEAM_TYPE_WAREHOUSE") {
  return String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
}

async function user(page: Page, teamId: string, username: string, role: string) {
  await api(page, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name: `${username} RP`, role });
}

async function rack(page: Page, teamId: string, code: string) {
  return String((await api(page, "inventory.v1.RackService/RackCreate", { teamId, code, name: `E2E reprint ${code}` })).rack.id);
}

async function product(page: Page, teamId: string, categoryId: string, part: string): Promise<Product> {
  const name = `E2E RP ${part}`;
  const made = await api(page, `${RPC}/ProductCreate`, { teamId, productCodePart: part, name, categoryId });

  return { id: String(made.product.id), name, old: made.product.productCode as string, now: "" };
}

async function account(page: Page, teamId: string, tag: string) {
  const id = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Reprint BCA ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-RPRINT-${tag}-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId, accountId: id, operational: true });

  return id;
}

// One restock from `seller` into `warehouse`, accepted whole onto the racks given per product.
async function hold(
  page: Page,
  seller: string,
  accountId: string,
  warehouse: string,
  lines: { p: Product; places: { rack: string; qty: number }[] }[],
) {
  const count = (places: { qty: number }[]) => places.reduce((n, x) => n + x.qty, 0);
  const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: seller,
    warehouseId: warehouse,
    financeAccountId: accountId,
    items: lines.map((l) => ({ productId: l.p.id, productCode: l.p.old, name: l.p.name, count: count(l.places), total: 10_000 * count(l.places) })),
  });
  const items = restock.request.items as { id: string; productId: string }[];
  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: warehouse,
    requestId: restock.request.id,
    lines: items.map((item) => {
      const line = lines.find((l) => l.p.id === String(item.productId))!;

      return {
        itemId: item.id,
        receivedCount: count(line.places),
        placements: line.places.map((x) => ({ placementId: x.rack, quantity: x.qty })),
      };
    }),
  });
}

async function appTagId(page: Page, teamId: string) {
  const res = await api(page, `${RPC}/ProductTagList`, { teamId, q: APP_TAG, page: { page: 1, limit: 200 } });
  const app = ((res.tags ?? []) as Tag[]).filter((t) => t.name === APP_TAG);
  expect(app, `the ${APP_TAG} tag`).toHaveLength(1);

  return String(app[0]!.id);
}

// The selling owner changes the team's code (TeamCodeUpdate, its own token); each product's live code read back.
async function changeCode(browser: Browser, root: Page, owner: string, seller: string, to: string, products: Product[]) {
  const page = await pageAs(browser, owner, seller);
  const res = await api(page, "team.v1.TeamService/TeamCodeUpdate", { teamId: seller, teamCode: to });
  await page.close();
  expect(res.changed, JSON.stringify(res)).toBe(true);
  expect(res.productsTagged, JSON.stringify(res)).toBe(products.length);
  for (const p of products) {
    p.now = (await api(root, `${RPC}/ProductDetail`, { teamId: seller, productId: p.id })).product.productCode as string;
    expect(p.now, `${p.old} recomposed`).toBe(`${to}-${p.old.split("-").slice(1).join("-")}`);
  }
}

// ---- screen helpers ----

// The tag ids on a product, as its owning team reads it.
async function tagsOn(page: Page, seller: string, productId: string) {
  const res = await api(page, `${RPC}/ProductDetail`, { teamId: seller, productId });

  return ((res.product.tags ?? []) as Tag[]).map((t) => String(t.id));
}

// The warehouse's Products list, loaded with `rows` rows.
async function warehouseProducts(page: Page, rows: number) {
  await page.goto("/products");
  await expect(page.getByTestId("warehouse-products-page")).toBeVisible();
  await expect(stockRows(page)).toHaveCount(rows, { timeout: 15_000 });
}

// Products list → Reprint codes (N) → the Reprint Codes page, loaded.
async function openReprint(page: Page, waiting: number) {
  const entry = page.getByTestId("open-reprint-labels");
  await expect(entry).toHaveText(`Reprint codes (${waiting})`);
  await entry.click();
  await expect(page).toHaveURL(/\/products\/reprint-labels$/);
  await expect(page.getByTestId("reprint-page")).toBeVisible();
  await expect(page.getByTestId("reprint-heading")).toHaveText("Reprint Codes");
  await expect(page.getByTestId("reprint-sheet")).toBeVisible();
}

// The labels on the sheet: each label's product group, its sticker's code and spot, and the line beside it.
async function sheetLabels(page: Page) {
  return page
    .getByTestId("reprint-sheet")
    .locator('[data-testid^="reprint-label-"]:not([data-testid$="-where"])')
    .evaluateAll((els) =>
      els.map((el) => ({
        group: el.closest('[data-testid^="reprint-product-"]')?.getAttribute("data-testid") ?? "",
        code: el.querySelector('[data-testid="label-sku"]')?.textContent?.trim() ?? "",
        spot: el.querySelector('[data-testid="label-placement"]')?.textContent?.trim() ?? "",
        where: el.querySelector('[data-testid$="-where"]')?.textContent?.trim() ?? "",
      })),
    );
}

// What prints: every sticker in the hidden print root — its code, its spot, its QR.
async function printedStickers(page: Page) {
  return page
    .getByTestId("reprint-print-root")
    .locator(".print-label")
    .evaluateAll((els) =>
      els.map((el) => ({
        code: el.querySelector('[data-testid="label-sku"]')?.textContent?.trim() ?? "",
        spot: el.querySelector('[data-testid="label-placement"]')?.textContent?.trim() ?? "",
        svg: el.querySelector("svg")?.outerHTML ?? "",
      })),
    );
}

// Print: the dialog stubbed with a counter, the click, the recorded print's request + answer, the dialog opened once.
async function print(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __printed: number; print: () => void };
    w.__printed = 0;
    w.print = () => {
      w.__printed += 1;
    };
  });
  const recorded = page.waitForResponse((r: Response) => r.url().endsWith(`/warehouse.${REPRINT_RECORD}`));
  await expect(page.getByTestId("reprint-print")).toBeEnabled();
  await page.getByTestId("reprint-print").click();
  const res = await recorded;
  expect(res.status(), await res.text()).toBe(200);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  const sent = res.request().postDataJSON() as { warehouseId: string; items: { productId: string; productCode: string }[] };
  const body = (await res.json()) as { clearedIds?: string[]; codeChangedIds?: string[]; untaggedIds?: string[] };

  return { sent, body };
}

// The selling team's list filtered by the app tag, as the address carries it — the server asked with the tag.
async function sellerFilteredByAppTag(page: Page, app: string) {
  const asked = page.waitForResponse(
    (r: Response) => r.url().endsWith(`/warehouse.${RPC}/ProductList`) && (r.request().postData() ?? "").includes(`"tagIds":["${app}"]`),
  );
  await page.goto(`/products?tag=${app}`);
  expect((await asked).status()).toBe(200);
  await expect(page.getByTestId("product-tag-filter").getByTestId(`product-tag-filter-pick-${app}`)).toBeVisible();
}

// ================================================================================================================
// GIVEN 3 — 2 products tagged need_reprint_code · stock on 3 shelf spots
// ================================================================================================================

type G3 = {
  seller: string;
  warehouse: string;
  owner: string;
  crew: string;
  spotA: string;
  spotB: string;
  p1: Product;
  p2: Product;
  other: Product;
};
const g3 = { app: "", by: {} as Record<Key, G3> };

test.describe(`warehouse:all wants to reprint changed product codes (${C3})`, () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const root = await browser.newPage();
    await login(root, ROOT_USERNAME, ROOT_PASSWORD);

    const category = String((await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E Reprint Cat 3 ${SUFFIX}` })).category.id);
    const other = await team(root, `E2E Reprint Untagged ${SUFFIX}`, OTHER_CODE, "TEAM_TYPE_SELLING");
    const otherAccount = await account(root, other, "U");

    for (const r of ROLES) {
      const c = CODES[r.key];
      const seller = await team(root, `E2E Reprint Seller 3${r.key} ${SUFFIX}`, c.old3, "TEAM_TYPE_SELLING");
      const warehouse = await team(root, `E2E Reprint WH 3${r.key} ${SUFFIX}`, c.wh3, "TEAM_TYPE_WAREHOUSE");
      const owner = `e2erp3${r.key}own${SUFFIX}`;
      const crew = `e2erp3${r.key}wh${SUFFIX}`;
      await user(root, seller, owner, "ROLE_SELLING_OWNER");
      await user(root, warehouse, crew, r.role);

      const spotA = `rp${SUFFIX}-3${r.key}-a`;
      const spotB = `rp${SUFFIX}-3${r.key}-b`;
      const [rackA, rackB] = [await rack(root, warehouse, spotA), await rack(root, warehouse, spotB)];
      const up = r.key.toUpperCase();
      const p1 = await product(root, seller, category, `P1${up}${SUFFIX}`);
      const p2 = await product(root, seller, category, `P2${up}${SUFFIX}`);
      const u = await product(root, other, category, `U3${up}${SUFFIX}`);
      u.now = u.old;

      await hold(root, seller, await account(root, seller, `3${up}`), warehouse, [
        { p: p1, places: [{ rack: rackA, qty: 2 }, { rack: rackB, qty: 3 }] },
        { p: p2, places: [{ rack: rackA, qty: 4 }] },
      ]);
      await hold(root, other, otherAccount, warehouse, [{ p: u, places: [{ rack: rackA, qty: 6 }] }]);

      g3.by[r.key] = { seller, warehouse, owner, crew, spotA, spotB, p1, p2, other: u };
    }

    g3.app = await appTagId(root, g3.by.o.seller);
    // Each seller's owner changes the team's code: P1 and P2 recomposed and tagged (both on a shelf); U untouched.
    for (const r of ROLES) {
      const g = g3.by[r.key];
      await changeCode(browser, root, g.owner, g.seller, CODES[r.key].new3, [g.p1, g.p2]);
    }

    await root.close();
  });

  for (const r of ROLES) {
    test(`${r.given} reprint product code (${C3})`, async ({ page, browser }) => {
      const g = g3.by[r.key];
      const app = g3.app;
      const { p1, p2, other } = g;

      await as(page, g.crew, g.warehouse);
      await warehouseProducts(page, 3);

      await test.step("regression: the given — the warehouse holds the 2 tagged products and an untagged one; the entry counts 2", async () => {
        for (const p of [p1, p2]) await expect(page.getByTestId(`stock-tags-${p.now}-${app}`)).toHaveText(APP_TAG);
        await expect(page.getByTestId(`stock-row-${other.now}`)).toBeVisible();
        await expect(page.getByTestId(`stock-tags-${other.now}-${app}`)).toHaveCount(0);
        await expect(page.getByTestId(`stock-onhand-${other.now}`)).toHaveText("6");
      });

      await openReprint(page, 2);

      await test.step("then: reprint shows only tagged products", async () => {
        await expect(reprintGroups(page)).toHaveCount(2);
        for (const p of [p1, p2]) {
          await expect(page.getByTestId(`reprint-product-${p.id}`)).toContainText(p.name);
          await expect(page.getByTestId(`reprint-product-${p.id}-code`)).toHaveText(p.now);
          await expect(page.getByTestId(`reprint-product-${p.id}-former`)).toHaveText(`was ${p.old}`);
        }
        await expect(page.getByTestId(`reprint-product-${other.id}`)).toHaveCount(0);
        await expect(page.getByTestId("reprint-sheet")).not.toContainText(other.now);
        await expect(page.getByTestId("reprint-count")).toHaveText("3 to print · 2 products");

        // The read under the role's own token: exactly the two tagged products wait here.
        const res = await api(page, REPRINT_LIST, { warehouseId: g.warehouse, page: { page: 1, limit: 50 } });
        const items = (res.items ?? []) as { productId: string }[];
        expect(sorted(items.map((i) => i.productId))).toEqual(sorted([p1.id, p2.id]));
        expect(String(res.pageInfo?.totalItems)).toBe("2");
      });

      const recorded = await test.step("then: 3 labels printed, each with its new XYZ code, shelf spot and quantity", async () => {
        const want = [
          { p: p1, spot: g.spotA, qty: 2 },
          { p: p1, spot: g.spotB, qty: 3 },
          { p: p2, spot: g.spotA, qty: 4 },
        ];

        // On the sheet: one label per spot, under its product — the sticker's new code and spot, the quantity beside it.
        const labels = await sheetLabels(page);
        expect(labels.map((l) => `${l.group}|${l.code}|${l.spot}|${l.where}`).sort()).toEqual(
          want.map((w) => `reprint-product-${w.p.id}|${w.p.now}|${w.spot}|${w.spot} · ${w.qty} pcs on the shelf`).sort(),
        );

        // What prints: 3 stickers, each its new code under a QR that says that code, and its spot — no old code.
        const stickers = await printedStickers(page);
        expect(stickers.map((s) => `${s.code}|${s.spot}`).sort()).toEqual(want.map((w) => `${w.p.now}|${w.spot}`).sort());
        const shapes: Record<string, Set<string>> = { [p1.now]: qrShapes(p1.now), [p2.now]: qrShapes(p2.now) };
        for (const [i, s] of stickers.entries()) {
          expect(shapes[s.code]?.has(shapeOf(s.svg)), `sticker ${i + 1} (${s.code}): its QR says the new code`).toBe(true);
        }
        await expect(page.getByTestId("reprint-print-root")).not.toContainText(p1.old);
        await expect(page.getByTestId("reprint-print-root")).not.toContainText(p2.old);

        // Print: the dialog opens once and the print is recorded with the new codes; both leave this warehouse's list.
        const done = await print(page);
        expect(done.sent.items.map((i) => `${i.productId}|${i.productCode}`).sort()).toEqual([p1, p2].map((p) => `${p.id}|${p.now}`).sort());
        expect(sorted(done.body.clearedIds)).toEqual(sorted([p1.id, p2.id]));
        expect(sorted(done.body.codeChangedIds)).toEqual([]);
        await expect(page.getByTestId("reprint-empty")).toBeVisible();
        await expect(reprintGroups(page)).toHaveCount(0);
        await expect(page.getByTestId("reprint-print")).toHaveCount(0);

        return done;
      });

      const owner = await pageAs(browser, g.owner, g.seller);

      await test.step("then: 2 products no longer tagged need_reprint_code", async () => {
        // The app took it off — the record says so, the products' own tags agree.
        expect(sorted(recorded.body.untaggedIds)).toEqual(sorted([p1.id, p2.id]));
        for (const p of [p1, p2]) expect(await tagsOn(owner, g.seller, p.id), `${p.now}'s tags`).not.toContain(app);

        // The warehouse's Products list: no chip on either row, the entry gone (hidden at 0).
        await page.getByTestId("reprint-done-back").click();
        await expect(page.getByTestId("warehouse-products-page")).toBeVisible();
        await expect(stockRows(page)).toHaveCount(3, { timeout: 15_000 });
        await expect(page.getByTestId("open-reprint-labels")).toHaveCount(0);
        for (const p of [p1, p2]) {
          await expect(page.getByTestId(`stock-row-${p.now}`)).toBeVisible();
          await expect(page.getByTestId(`stock-tags-${p.now}-${app}`)).toHaveCount(0);
        }

        // The owning team's list: both products, neither with the chip.
        await owner.goto("/products");
        await expect(sellerRows(owner)).toHaveCount(2, { timeout: 15_000 });
        for (const p of [p1, p2]) {
          await expect(owner.getByTestId(`product-row-${p.now}`)).toBeVisible();
          await expect(owner.getByTestId(`product-row-tags-${p.now}-${app}`)).toHaveCount(0);
        }
      });

      await test.step("then: owning team's Products list filtered by need_reprint_code shows none", async () => {
        await sellerFilteredByAppTag(owner, app);
        await expect(owner.getByTestId("products-empty")).toBeVisible();
        await expect(sellerRows(owner)).toHaveCount(0);
      });

      await owner.close();
    });
  }
});

// ================================================================================================================
// GIVEN 4 — 1 product tagged need_reprint_code · stock in 2 warehouses · only 1 has printed
// ================================================================================================================

type G4 = {
  seller: string;
  w1: string;
  w2: string;
  owner: string;
  crew1: string;
  crew2: string;
  spot1: string;
  spot2: string;
  p: Product;
};
const g4 = { app: "", by: {} as Record<Key, G4> };

test.describe(`warehouse:all wants to reprint changed product codes (${C4})`, () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const root = await browser.newPage();
    await login(root, ROOT_USERNAME, ROOT_PASSWORD);

    const category = String((await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E Reprint Cat 4 ${SUFFIX}` })).category.id);

    for (const r of ROLES) {
      const c = CODES[r.key];
      const seller = await team(root, `E2E Reprint Seller 4${r.key} ${SUFFIX}`, c.old4, "TEAM_TYPE_SELLING");
      const w1 = await team(root, `E2E Reprint WH 4${r.key}1 ${SUFFIX}`, c.w1, "TEAM_TYPE_WAREHOUSE");
      const w2 = await team(root, `E2E Reprint WH 4${r.key}2 ${SUFFIX}`, c.w2, "TEAM_TYPE_WAREHOUSE");
      const owner = `e2erp4${r.key}own${SUFFIX}`;
      const crew1 = `e2erp4${r.key}wa${SUFFIX}`;
      const crew2 = `e2erp4${r.key}wb${SUFFIX}`;
      await user(root, seller, owner, "ROLE_SELLING_OWNER");
      await user(root, w1, crew1, r.role);
      await user(root, w2, crew2, r.role);

      const spot1 = `rp${SUFFIX}-4${r.key}-a`;
      const spot2 = `rp${SUFFIX}-4${r.key}-b`;
      const [rack1, rack2] = [await rack(root, w1, spot1), await rack(root, w2, spot2)];
      const up = r.key.toUpperCase();
      const p = await product(root, seller, category, `P4${up}${SUFFIX}`);
      const paid = await account(root, seller, `4${up}`);
      await hold(root, seller, paid, w1, [{ p, places: [{ rack: rack1, qty: 3 }] }]);
      await hold(root, seller, paid, w2, [{ p, places: [{ rack: rack2, qty: 2 }] }]);

      g4.by[r.key] = { seller, w1, w2, owner, crew1, crew2, spot1, spot2, p };
    }

    g4.app = await appTagId(root, g4.by.o.seller);
    // Each seller's owner changes the team's code: P recomposed and tagged, waiting at W1 and at W2.
    for (const r of ROLES) {
      const g = g4.by[r.key];
      await changeCode(browser, root, g.owner, g.seller, CODES[r.key].new4, [g.p]);
    }

    await root.close();
  });

  for (const r of ROLES) {
    test(`${r.given} reprint product code (${C4})`, async ({ page, browser }) => {
      const g = g4.by[r.key];
      const app = g4.app;
      const { p } = g;

      // W1 — the role prints.
      await as(page, g.crew1, g.w1);
      await warehouseProducts(page, 1);
      await expect(page.getByTestId(`stock-tags-${p.now}-${app}`)).toHaveText(APP_TAG);
      await openReprint(page, 1);

      const recorded = await test.step("regression: W1 prints its one label — the product leaves W1's reprint at once", async () => {
        await expect(reprintGroups(page)).toHaveCount(1);
        await expect(page.getByTestId(`reprint-product-${p.id}-code`)).toHaveText(p.now);
        await expect(page.getByTestId("reprint-label-0-where")).toHaveText(`${g.spot1} · 3 pcs on the shelf`);
        await expect(page.getByTestId("reprint-label-1")).toHaveCount(0);

        const done = await print(page);
        expect(done.sent.items).toEqual([{ productId: p.id, productCode: p.now }]);
        expect(sorted(done.body.clearedIds)).toEqual([p.id]);
        await expect(page.getByTestId("reprint-empty")).toBeVisible();

        return done;
      });

      const owner = await pageAs(browser, g.owner, g.seller);

      await test.step("then: product still tagged need_reprint_code", async () => {
        // W2 still waits, so the app leaves the tag on.
        expect(sorted(recorded.body.untaggedIds)).toEqual([]);
        expect(await tagsOn(owner, g.seller, p.id)).toContain(app);

        // W1's Products list: nothing waits here any more (the entry hidden), the row still carries the chip.
        await page.getByTestId("reprint-done-back").click();
        await expect(page.getByTestId("warehouse-products-page")).toBeVisible();
        await expect(stockRows(page)).toHaveCount(1, { timeout: 15_000 });
        await expect(page.getByTestId("open-reprint-labels")).toHaveCount(0);
        await expect(page.getByTestId(`stock-tags-${p.now}-${app}`)).toHaveText(APP_TAG);

        // The owning team's list filtered by the tag still shows it.
        await sellerFilteredByAppTag(owner, app);
        await expect(sellerRows(owner)).toHaveCount(1, { timeout: 15_000 });
        await expect(owner.getByTestId(`product-row-tags-${p.now}-${app}`)).toHaveText(APP_TAG);
      });

      // W2 — a user of the same role, a member of W2 only.
      const crew2 = await pageAs(browser, g.crew2, g.w2);

      await test.step("then: other warehouse still sees it in its reprint", async () => {
        await warehouseProducts(crew2, 1);
        await expect(crew2.getByTestId(`stock-tags-${p.now}-${app}`)).toHaveText(APP_TAG);
        await openReprint(crew2, 1);
        await expect(reprintGroups(crew2)).toHaveCount(1);
        await expect(crew2.getByTestId(`reprint-product-${p.id}-code`)).toHaveText(p.now);
        await expect(crew2.getByTestId(`reprint-product-${p.id}-former`)).toHaveText(`was ${p.old}`);
        await expect(crew2.getByTestId("reprint-label-0-where")).toHaveText(`${g.spot2} · 2 pcs on the shelf`);
        await expect(crew2.getByTestId("reprint-count")).toHaveText("1 to print · 1 product");
        const stickers = await printedStickers(crew2);
        expect(stickers.map((s) => `${s.code}|${s.spot}`)).toEqual([`${p.now}|${g.spot2}`]);
      });

      await test.step("regression: once the last holding warehouse (W2) prints, the app takes need_reprint_code off", async () => {
        const done = await print(crew2);
        expect(sorted(done.body.clearedIds)).toEqual([p.id]);
        expect(sorted(done.body.untaggedIds)).toEqual([p.id]);
        await expect(crew2.getByTestId("reprint-empty")).toBeVisible();
        expect(await tagsOn(owner, g.seller, p.id)).not.toContain(app);
      });

      await crew2.close();
      await owner.close();
    });
  }
});

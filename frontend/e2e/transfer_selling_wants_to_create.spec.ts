import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { asRoot, login, rupiah, signInAs, today } from "./metric_ground";
import { pickTeam } from "./pickers";

// selling:all wants to move stock to another warehouse — the checks behind docs/acceptances/inventory/warehouse_transfer.md,
// section *create*, givens 1–4 (when *create transfer*). One test per role the givens name — selling:owner,
// selling:admin, selling:cs — each signed in as a person of that role in ONE selling team, opening the transfer as a
// person does: Transfers › the form (/inventories/transfer/new), From A, To B, Pick Products, the count, the shipping and
// the account that pays it, Create Transfer. transfers.spec.ts stays the transfer's end-to-end regression (create → ship
// → accept → the money); this file is the acceptance of its first act.
//
// Business rules (docs/business/inventory/warehouse_transfer_decision.md):
// - a-transfer-takes-from-the-sender-at-create — the units leave A's book at create (shelves fewest first, batches oldest
//   first); A holding too few fails the create and writes nothing; cancel rolls it back.
// - the-transfer-is-where-goods-in-transit-are — between the legs the units are in the transfer: the team's stock screen
//   shows them per product as in transit, valued at the items' total.
// - the-system-fills-a-transfers-prices — an item's total is what the out-leg took, at its batches' own prices.
// - the-shipping-expense-reaches-the-account-by-event, a-transfers-shipping-is-paid-from-any-active-account — the cost
//   leaves the named account (any ACTIVE one of the team) through financial_account's listener, as an `expense` row
//   naming the transfer (*Warehouse transfer #N shipping*) — so it is POLLED.
// - the-team-opens-the-sender-ships-the-receiver-accepts — the warehouse list's two views: Outgoing at A, Incoming at B,
//   where B sees a transfer from the moment it is opened (to plan rack space); a then seen by another team is read by
//   one role there, a warehouse OWNER of A and of B.
// - a running stock count holds its racks: a TAKE refused reads *… held on rack <code> by count #N, started by …*.
//
// GROUND (beforeAll, as root, through the API from the test runner): a selling team S with a person per role and an
// operational account paying the restocks; warehouses A and B (an owner person in each) and C (given 4's A, its rack
// under a running count). Every product is S's and of its own per (given, role), except givens 3 and 4, which change
// nothing and so share one each:
//   1   per role a product with TWO batches on A's rack — 2 at Rp 10.000 (the older), then 3 at Rp 12.000 — so a
//       transfer of 3 takes 2 + 1 and is worth Rp 32.000 from the batches' prices (Rp 36.000 had it read the newer
//       layer, Rp 30.000 an average). No shipping cost.
//       then: transfer created, status created — the detail page (Created), the role's own WarehouseTransferDetail.
//       then: ready stock of 1 product at warehouse A decreases — Products under A's lens, Ready 5 → 2.
//       then: in transit on the products page increases — Products, the product's In transit 3 pcs (Rp 32.000).
//       then: outgoing at warehouse A, incoming at warehouse B — A's owner: Transfers › Outgoing lists it; B's owner:
//             Transfers › Incoming lists it.
//       then: value worked out from warehouse A's batch prices — the detail's *Value moved: Rp 32.000* and the item's
//             total in the answer.
//       then: sent recorded in transfer analytic metric — Analytic › Transfer by product: sent 3, Rp 32.000.
//   2   per role a product (5 on A's rack at Rp 10.000) and a BCA account of its own opened today at Rp 1.000.000; the
//       transfer of 2 carries a Rp 20.000 shipping cost paid from that BCA, typed on the form.
//       then: transfer created with shipping cost — the detail's Shipping cost Rp 20.000, Paid from that BCA.
//       then: BCA decreases by shipping cost — the account page: Rp 1.000.000 → Rp 980.000.
//       then: recorded in BCA's history as expense, naming the transfer — its row *Warehouse transfer #N shipping*,
//             type Expense, −Rp 20.000.
//       then: recorded in finance analytic metric — Analytic › Account changes by account: that BCA's Expense −Rp 20.000.
//   3   one product with 3 on A's rack; the role asks for 5.
//       then: cannot create, says counts within the stock at warehouse A — the form says *3 at the sending warehouse* and
//             *Still needed: counts within the stock at the sending warehouse*, Create Transfer stays off; the same
//             create sent anyway under the role's token is refused, and Ready at A is still 3.
//   4   one product with 3 on C's rack, C under a running count (all of C, started by root after the restock).
//       then: cannot create, names the rack and the stock opname holding it — Create Transfer answers with the error
//             naming the rack's code and the count's number; the form stays open, nothing is created.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-transfer-create-1";

const GIVEN = "selling:all wants to move stock to another warehouse";
const WHEN = "create transfer";
const C1 = "1 product · warehouse A to warehouse B · no shipping cost";
const C2 = "1 product · warehouse A to warehouse B · shipping cost · paid from BCA";
const C3 = "1 product · warehouse A to warehouse B · count more than warehouse A holds";
const C4 = "1 product · warehouse A to warehouse B · its units at warehouse A on a rack in a running stock opname";

const SELLING = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "o" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "a" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "c" },
] as const;
type Role = (typeof SELLING)[number];

// Given 1: the two batches and the take.
const OLDER = { count: 2, total: 20_000 }; // Rp 10.000 a unit
const NEWER = { count: 3, total: 36_000 }; // Rp 12.000 a unit
const SENT = 3; // 2 off the older + 1 off the newer
const VALUE = 2 * 10_000 + 1 * 12_000; // Rp 32.000
// Given 2.
const G2_STOCK = { count: 5, total: 50_000 };
const G2_SENT = 2;
const SHIPPING = 20_000;
const BCA_OPENING = 1_000_000;
// Givens 3 and 4.
const G3_STOCK = { count: 3, total: 30_000 };
const G3_ASKED = 5;
const G4_STOCK = { count: 3, total: 30_000 };

const WH = {
  a: { name: `E2E Transfer Create A ${SUFFIX}`, code: `XTWA${SUFFIX}` },
  b: { name: `E2E Transfer Create B ${SUFFIX}`, code: `XTWB${SUFFIX}` },
  c: { name: `E2E Transfer Create C ${SUFFIX}`, code: `XTWC${SUFFIX}` },
};
const RACK_A = `xt-a-${SUFFIX}`;
const RACK_C = `xt-c-${SUFFIX}`;
const OWNER_A = `xtwoa${SUFFIX}`;
const OWNER_B = `xtwob${SUFFIX}`;
const username = (r: Role) => `xtc${r.key}${SUFFIX}`;
const bcaName = (r: Role) => `E2E BCA transfer ${r.key} ${SUFFIX}`;

interface Product {
  id: string;
  code: string;
  name: string;
}

const ground = {
  seller: "",
  whA: "",
  whB: "",
  whC: "",
  rackA: "",
  rackC: "",
  restockAccount: "",
  session: "",
  category: "",
  g1: {} as Record<string, Product>,
  g2: {} as Record<string, Product>,
  g3: { id: "", code: "", name: "" } as Product,
  g4: { id: "", code: "", name: "" } as Product,
  bca: {} as Record<string, string>,
};

// A call that may be refused — its status and JSON, never a throw.
async function send(token: string, method: string, body: unknown) {
  const res = await fetch(`${API_URL}/warehouse.${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function team(name: string, code: string, type: string): Promise<string> {
  return String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: ROOT_USER_ID })).team.id);
}

async function person(teamId: string, who: string, role: string, name: string) {
  await asRoot("user.v1.UserService/CreateUser", { teamId, username: who, password: PASSWORD, name, role });
}

async function product(tag: string): Promise<Product> {
  const name = `Kaos Pindah ${tag} ${SUFFIX}`;
  const made = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `C${tag}${SUFFIX}`,
      name,
      categoryId: ground.category,
    })
  ).product;

  return { id: String(made.id), code: made.productCode, name };
}

async function account(name: string, number: string, opening: number): Promise<string> {
  return String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name,
        holderName: "E2E",
        accountNumber: number,
        openingBalance: opening,
        openingOn: today(),
      })
    ).account.id,
  );
}

// One restock of S's into a warehouse, counted in whole onto its rack — one batch per line, priced line total ÷ count.
async function restock(warehouseId: string, rackId: string, lines: { p: Product; count: number; total: number }[]) {
  const made = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.seller,
    warehouseId,
    financeAccountId: ground.restockAccount,
    items: lines.map((l) => ({ productId: l.p.id, productCode: l.p.code, name: l.p.name, count: l.count, total: l.total })),
  });
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: warehouseId,
    requestId: made.request.id,
    lines: (made.request.items as { id: string; count: string }[]).map((i) => ({
      itemId: i.id,
      receivedCount: i.count,
      placements: [{ placementId: rackId, quantity: i.count }],
    })),
  });
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(240_000);

  ground.seller = await team(`E2E Transfer Create Seller ${SUFFIX}`, `XTSL${SUFFIX}`, "TEAM_TYPE_SELLING");
  for (const r of SELLING) await person(ground.seller, username(r), r.role, `Transfer Create ${r.key} ${SUFFIX}`);
  ground.whA = await team(WH.a.name, WH.a.code, "TEAM_TYPE_WAREHOUSE");
  ground.whB = await team(WH.b.name, WH.b.code, "TEAM_TYPE_WAREHOUSE");
  ground.whC = await team(WH.c.name, WH.c.code, "TEAM_TYPE_WAREHOUSE");
  await person(ground.whA, OWNER_A, "ROLE_WAREHOUSE_OWNER", `Transfer Create owner A ${SUFFIX}`);
  await person(ground.whB, OWNER_B, "ROLE_WAREHOUSE_OWNER", `Transfer Create owner B ${SUFFIX}`);
  ground.rackA = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: ground.whA, code: RACK_A, name: RACK_A })).rack.id);
  ground.rackC = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: ground.whC, code: RACK_C, name: RACK_C })).rack.id);
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Transfer Create ${SUFFIX}` })).category.id);

  // The account that pays the restocks — operational (a restock is paid only from one), never one a then reads.
  ground.restockAccount = await account(`E2E transfer restocks ${SUFFIX}`, `E2E-XTC-R-${SUFFIX}`, 10_000_000);
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: ground.restockAccount,
    operational: true,
  });

  for (const r of SELLING) {
    ground.g1[r.key] = await product(`1${r.key.toUpperCase()}`);
    ground.g2[r.key] = await product(`2${r.key.toUpperCase()}`);
    // Given 2's BCA — any ACTIVE account pays a transfer's shipping (a-transfers-shipping-is-paid-from-any-active-account).
    ground.bca[r.key] = await account(bcaName(r), `E2E-XTC-B${r.key}-${SUFFIX}`, BCA_OPENING);
  }
  ground.g3 = await product("3X");
  ground.g4 = await product("4X");

  // The OLDER layer first (given 1's 2 at Rp 10.000, beside givens 2 and 3's stock), then given 1's NEWER 3 at Rp 12.000.
  await restock(ground.whA, ground.rackA, [
    ...SELLING.map((r) => ({ p: ground.g1[r.key]!, ...OLDER })),
    ...SELLING.map((r) => ({ p: ground.g2[r.key]!, ...G2_STOCK })),
    { p: ground.g3, ...G3_STOCK },
  ]);
  await restock(ground.whA, ground.rackA, SELLING.map((r) => ({ p: ground.g1[r.key]!, ...NEWER })));
  await restock(ground.whC, ground.rackC, [{ p: ground.g4, ...G4_STOCK }]);

  // Given 4: a running count over all of C, started after its stock arrived.
  ground.session = String((await asRoot("inventory.v1.OpnameService/OpnameSessionCreate", { teamId: ground.whC, plan: "OPNAME_PLAN_ALL" })).session.id);
});

// ── the screens ─────────────────────────────────────────────────────────────────────────────────────────────────────

// The form, filled up to the products: From, To, the one product picked (its count starts at 1).
async function openForm(page: Page, from: string, to: string, p: Product) {
  await page.goto("/inventories/transfer/new");
  await expect(page.getByTestId("transfer-form")).toBeVisible();
  // Both pickers list warehouses, so an option's testid is on the page twice — pickTeam clicks the open list's.
  await pickTeam(page, page.getByTestId("transfer-form-from"), from);
  await pickTeam(page, page.getByTestId("transfer-form-to"), to);
  await page.getByTestId("transfer-form-pick").click();
  await page.getByTestId(`product-picker-option-${p.id}`).click();
  await page.getByTestId("product-picker-confirm").click();
  await expect(page.getByTestId(`transfer-form-line-${p.id}`)).toBeVisible();
}

// Create Transfer — it must create; the new transfer's id from the page it lands on.
async function create(page: Page): Promise<string> {
  await expect(page.getByTestId("transfer-form-submit")).toBeEnabled();
  const answer = page.waitForResponse((r) => r.url().includes("WarehouseTransferService/WarehouseTransferCreate"));
  await page.getByTestId("transfer-form-submit").click();
  const res = await answer;
  expect(res.ok(), `WarehouseTransferCreate: ${res.status()}`).toBe(true);
  await expect(page).toHaveURL(/\/inventories\/transfer\/\d+$/);

  return /\/inventories\/transfer\/(\d+)$/.exec(page.url())![1]!;
}

// The product's Ready cell on Products under a warehouse's lens — the column found by its header, not by position.
async function readyCell(page: Page, warehouse: string, code: string): Promise<Locator> {
  await page.goto(`/products?warehouse=${warehouse}`);
  const row = page.getByTestId(`product-row-${code}`);
  await expect(row).toBeVisible();
  const headers = (await page.getByTestId("products-table").getByRole("columnheader").allInnerTexts()).map((h) => h.trim());
  const i = headers.findIndex((h) => /^Ready/.test(h));
  expect(i, `a Ready column among ${JSON.stringify(headers)}`).toBeGreaterThanOrEqual(0);

  return row.getByRole("cell").nth(i);
}

// A warehouse person's Transfers list in one direction — the transfer's row there.
async function inQueue(browser: Browser, who: string, warehouse: string, direction: "outgoing" | "incoming", transfer: string) {
  const page = await browser.newPage();
  try {
    await signInAs(page, who, PASSWORD, warehouse);
    await page.goto(`/inventories/transfer?direction=${direction}`);
    await expect(page.getByTestId("transfers-table")).toBeVisible();
    await expect(page.getByTestId(`transfer-direction-${direction}`)).toBeVisible();
    await expect(page.getByTestId(`transfer-row-${transfer}`)).toBeVisible();
  } finally {
    await page.close();
  }
}

// An Analytic cell, re-read until it lands (the folds and the listeners answer after the write).
async function lands(page: Page, url: string, testId: string, want: string) {
  await expect(async () => {
    await page.goto(url);
    await expect(page.getByTestId(testId)).toHaveText(want, { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

// ── 1 · no shipping cost ────────────────────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${C1})`, () => {
  for (const r of SELLING) {
    test(`${r.given} ${WHEN} (${C1})`, async ({ page, browser }) => {
      const p = ground.g1[r.key]!;
      await signInAs(page, username(r), PASSWORD, ground.seller);

      // Before: 5 ready at A (2 + 3), nothing of it in transit.
      await expect(await readyCell(page, ground.whA, p.code)).toHaveText(/^5 pcs/);
      await page.goto("/products");
      await expect(page.getByTestId(`product-row-${p.code}`)).toBeVisible();
      const transitBefore = page.getByTestId(`in-transit-${p.code}`);
      if ((await transitBefore.count()) > 0) await expect(transitBefore).not.toHaveText(/[1-9]/);

      // THE WHEN — 3 of it from A to B, no shipping cost.
      await openForm(page, WH.a.code, WH.b.code, p);
      await expect(page.getByTestId(`transfer-form-available-${p.id}`)).toContainText("5 at the sending warehouse");
      await page.getByTestId(`transfer-form-count-${p.id}`).fill(String(SENT));
      const transfer = await create(page);

      await test.step("then: transfer created, status created", async () => {
        await expect(page.getByTestId("transfer-detail-page")).toBeVisible();
        await expect(page.getByTestId("transfer-detail-title")).toContainText(`#${transfer}`);
        await expect(page.getByTestId("transfer-detail-status")).toHaveText("Created");
        const detail = await send(await login(username(r), PASSWORD), "inventory.v1.WarehouseTransferService/WarehouseTransferDetail", {
          teamId: ground.seller,
          transferId: transfer,
        });
        expect(detail.status, JSON.stringify(detail.json)).toBe(200);
        expect(detail.json.transfer.status).toBe("WAREHOUSE_TRANSFER_STATUS_CREATED");
        expect(String(detail.json.transfer.items[0].count)).toBe(String(SENT));
      });

      await test.step("then: value worked out from warehouse A's batch prices", async () => {
        // 2 off the older batch at Rp 10.000 and 1 off the newer at Rp 12.000 — never a typed price, never an average.
        await expect(page.getByTestId("transfer-detail-total")).toHaveText(`Value moved: ${rupiah(VALUE)}`);
        const detail = await send(await login(username(r), PASSWORD), "inventory.v1.WarehouseTransferService/WarehouseTransferDetail", {
          teamId: ground.seller,
          transferId: transfer,
        });
        expect(Number(detail.json.transfer.total)).toBe(VALUE);
        expect(Number(detail.json.transfer.items[0].total)).toBe(VALUE);
      });

      await test.step("then: ready stock of 1 product at warehouse A decreases", async () => {
        // Left A's book at create, though the units still wait on A's rack for the picker.
        await expect(await readyCell(page, ground.whA, p.code)).toHaveText(/^2 pcs/);
      });

      await test.step("then: in transit on the products page increases", async () => {
        await page.goto("/products");
        await expect(page.getByTestId(`product-row-${p.code}`)).toBeVisible();
        await expect(page.getByTestId(`in-transit-${p.code}`)).toHaveText(`${SENT} pcs`);
        await expect(page.getByTestId(`in-transit-${p.code}`)).toHaveAttribute("title", rupiah(VALUE));
      });

      await test.step("then: outgoing at warehouse A, incoming at warehouse B", async () => {
        await inQueue(browser, OWNER_A, ground.whA, "outgoing", transfer);
        await inQueue(browser, OWNER_B, ground.whB, "incoming", transfer);
      });

      await test.step("then: sent recorded in transfer analytic metric", async () => {
        const url = `/analytic?g=product&m=metrics/inventory/transfer&r=7d&product=${p.id}`;
        await lands(page, url, `analytic-cell-${p.id}-sent_count`, String(SENT));
        await expect(page.getByTestId(`analytic-cell-${p.id}-sent_value`)).toHaveText(rupiah(VALUE));
      });
    });
  }
});

// ── 2 · shipping cost paid from BCA ─────────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${C2})`, () => {
  for (const r of SELLING) {
    test(`${r.given} ${WHEN} (${C2})`, async ({ page }) => {
      const p = ground.g2[r.key]!;
      const bca = ground.bca[r.key]!;
      await signInAs(page, username(r), PASSWORD, ground.seller);

      // Before: the BCA holds its opening.
      await page.goto(`/financial-accounts/${bca}`);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(BCA_OPENING));

      // THE WHEN — 2 of it from A to B, Rp 20.000 shipping paid from the BCA.
      await openForm(page, WH.a.code, WH.b.code, p);
      await page.getByTestId(`transfer-form-count-${p.id}`).fill(String(G2_SENT));
      await page.getByTestId("transfer-form-cost").fill(String(SHIPPING));
      await page.getByTestId("transfer-form-account").click();
      await page.getByTestId(`transfer-form-account-option-${bca}`).click();
      const transfer = await create(page);

      await test.step("then: transfer created with shipping cost", async () => {
        await expect(page.getByTestId("transfer-detail-status")).toHaveText("Created");
        await expect(page.getByTestId("transfer-detail-shipping-cost")).toContainText(rupiah(SHIPPING));
        await expect(page.getByTestId("transfer-detail-account")).toContainText(bcaName(r));
        const detail = await send(await login(username(r), PASSWORD), "inventory.v1.WarehouseTransferService/WarehouseTransferDetail", {
          teamId: ground.seller,
          transferId: transfer,
        });
        expect(Number(detail.json.transfer.shipmentCost)).toBe(SHIPPING);
        expect(String(detail.json.transfer.financeAccountId)).toBe(bca);
      });

      await test.step("then: BCA decreases by shipping cost", async () => {
        await expect(async () => {
          await page.goto(`/financial-accounts/${bca}`);
          await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(BCA_OPENING - SHIPPING), { timeout: 3_000 });
        }).toPass({ timeout: 45_000 });
      });

      await test.step("then: recorded in BCA's history as expense, naming the transfer", async () => {
        const row = page.locator('[data-testid^="account-log-row-"]').filter({ hasText: `Warehouse transfer #${transfer} shipping` });
        await expect(row).toHaveCount(1);
        const cells = row.locator("td");
        await expect(cells.nth(1)).toHaveText("Expense");
        await expect(cells.nth(3)).toHaveText(new RegExp(`^[−-]\\s?Rp\\s?20\\.000$`));
      });

      await test.step("then: recorded in finance analytic metric", async () => {
        await lands(page, "/analytic?g=account&m=metrics/financial_accounts&r=7d", `analytic-cell-${bca}-expense`, `−${rupiah(SHIPPING)}`);
      });
    });
  }
});

// ── 3 · more than A holds ───────────────────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${C3})`, () => {
  for (const r of SELLING) {
    test(`${r.given} ${WHEN} (${C3})`, async ({ page }) => {
      const p = ground.g3;
      await signInAs(page, username(r), PASSWORD, ground.seller);

      // THE WHEN — 5 asked of the 3 A holds.
      await openForm(page, WH.a.code, WH.b.code, p);
      await expect(page.getByTestId(`transfer-form-available-${p.id}`)).toContainText(`${G3_STOCK.count} at the sending warehouse`);
      await page.getByTestId(`transfer-form-count-${p.id}`).fill(String(G3_ASKED));

      await test.step("then: cannot create, says counts within the stock at warehouse A", async () => {
        await expect(page.getByTestId("transfer-form-missing")).toContainText("counts within the stock at the sending warehouse");
        await expect(page.getByTestId("transfer-form-submit")).toBeDisabled();

        // The same create sent anyway, as the role: refused, and nothing left A.
        const res = await send(await login(username(r), PASSWORD), "inventory.v1.WarehouseTransferService/WarehouseTransferCreate", {
          teamId: ground.seller,
          fromWarehouseId: ground.whA,
          toWarehouseId: ground.whB,
          lines: [{ productId: p.id, count: String(G3_ASKED) }],
        });
        expect(res.status, JSON.stringify(res.json)).not.toBe(200);
        await expect(await readyCell(page, ground.whA, p.code)).toHaveText(new RegExp(`^${G3_STOCK.count} pcs`));
      });
    });
  }
});

// ── 4 · A's rack in a running stock count ───────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${C4})`, () => {
  for (const r of SELLING) {
    test(`${r.given} ${WHEN} (${C4})`, async ({ page }) => {
      const p = ground.g4;
      await signInAs(page, username(r), PASSWORD, ground.seller);

      // THE WHEN — 1 of it from C (the given's A, under the count) to B.
      await openForm(page, WH.c.code, WH.b.code, p);
      await page.getByTestId(`transfer-form-count-${p.id}`).fill("1");
      await expect(page.getByTestId("transfer-form-submit")).toBeEnabled();
      const answer = page.waitForResponse((res) => res.url().includes("WarehouseTransferService/WarehouseTransferCreate"));
      await page.getByTestId("transfer-form-submit").click();
      const res = await answer;

      await test.step("then: cannot create, names the rack and the stock opname holding it", async () => {
        expect(res.ok(), "the create must be refused").toBe(false);
        const toast = page.locator('[data-scope="toast"][data-part="root"][data-type="error"]');
        await expect(toast).toContainText(`held on rack ${RACK_C}`);
        await expect(toast).toContainText(`count #${ground.session}`);
        await expect(page).toHaveURL(/\/inventories\/transfer\/new$/);
        await expect(page.getByTestId("transfer-form")).toBeVisible();
      });
    });
  }
});

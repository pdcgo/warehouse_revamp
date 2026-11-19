import { deflateRawSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { openShops } from "./pickers";

// ── edit shop order — the checks behind docs/acceptances/inventory/order.md (## edit) ───────────────────────────────────
//
// an-orders-shop-is-fixed-and-counted-on-the-day (docs/business/order/context_decision.md, backlog #86): an order filed
// under the wrong shop is moved to another shop of the SAME team and marketplace that the person may write, from the
// order's handover on (shipping, shipped, problem, completed, return, return completed, lost — the 🔄 of 2026-11-18);
// before handover and a cancelled order are refused. The fix is logged — a note "Toko: A → B" in the order's notes and an
// order_shop_changes row — and settlement moves the order's account to the new shop, so THAT shop's statement imports.
//
// The given `selling:all wants to fix an order's shop (status: completed · order in wrong shop · statement import
// refused)` / edit shop order, run as EVERY selling role (selling:owner, selling:admin, selling:cs), each in its own
// browser session, each on a completed order of its own. The order was recorded in shop A ("Wrong") but really belongs
// to shop B ("Right") — same team, both Shopee. Shop B's statement names the order; imported on the screen it is
// REFUSED (a-file-with-another-shops-orders-is-refused: "1 of this file's orders belong to <A> — the whole file is
// refused, nothing was posted"). The role then fixes the shop on the seller's order page: Change Shop → B → Next → the
// confirm naming both shops → Change Shop. Each THEN is its own step, checked softly:
// - `shop changed` — the order's page reads B in its Shop fact (order-shop-name), and the order's own record
//   (OrderDetail) names B.
// - `shop change shown in order timeline` — the order's notes (Catatan; a-note-is-a-timeline-row) hold "Toko: A → B".
// - `statement import succeeds` — once settlement has moved the order's account to B (OrderShopChanged, polled), the
//   SAME statement for B imported again on the screen runs to its end: 1 of 1 rows, 1 posted, "Every row went in.", and
//   the order's settlement holds the statement's line under B.
//
// Regression beside it (short, one person each): before handover (pending, picked) the page offers no Change Shop and
// the server refuses FailedPrecondition; the picker offers only same-marketplace shops the person may write, another
// marketplace is refused FailedPrecondition and an ungranted shop PermissionDenied naming it; the same shop again
// changes nothing (Next stays off on it, the server writes no note).
//
// GROUND (beforeAll, as root, through the API): a selling team of its own (root owns it) with four shops — A and B
// (Shopee; root their primary CS, the CS granted on B only), T (Tokopedia) and D (Shopee, nobody granted) — a warehouse
// it returns to, 10 units of one product on a rack there, and orders of 1 unit placed on A: per role one walked to
// COMPLETED (warehouse PROCESSED → PICKED → SHIPPING, then the seller SHIPPED → COMPLETED), plus one pending, one picked
// and one shipped for the regression. Seeded in beforeAll so a worker restarted after a failure seeds its own.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-editshop-pass-1";
const PRODUCT = `Sabun Toko ${SUFFIX}`;
const SHOP = {
  A: `E2E Fix Wrong ${SUFFIX}`,
  B: `E2E Fix Right ${SUFFIX}`,
  T: `E2E Fix Tokped ${SUFFIX}`,
  D: `E2E Fix Ungranted ${SUFFIX}`,
};
const PLATFORM_TOTAL = 120_000;
const PAID = 110_000; // what the statement's one line pays the order

const ROLES = [
  { key: "own", role: "ROLE_SELLING_OWNER", label: "selling:owner" },
  { key: "adm", role: "ROLE_SELLING_ADMIN", label: "selling:admin" },
  { key: "cs", role: "ROLE_SELLING_CS", label: "selling:cs" },
] as const;
type Key = (typeof ROLES)[number]["key"];
type Extra = "pending" | "picked" | "shipped";

const userOf = (key: Key) => `e2eox${key}${SUFFIX}`;
// The marketplace's Order ID — carries the run's suffix (a repeat within a team is refused).
const refOf = (key: string) => `OX${SUFFIX}${key.toUpperCase()}`;

const ground = {
  team: "",
  warehouse: "",
  shops: { A: "", B: "", T: "", D: "" },
  orders: {} as Record<Key | Extra, string>,
};

// ── a Shopee statement of ONE line, built per role (the shared fixture's refs are not this order's) ───────────────────

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, dir, end]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A Shopee "Rincian Transaksi" export: rows by their 1-based row number, each a list of cell texts from column A. */
function shopeeStatement(rows: Record<number, string[]>): Buffer {
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = Object.entries(rows)
    .map(
      ([r, cells]) =>
        `<row r="${r}">${cells.map((v, i) => `<c r="${col(i)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join("")}</row>`,
    )
    .join("");
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  return zip({
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

// Shop B's statement for one role: the income of the role's order, Rp 110.000, today. The closing balance carries the run
// and the role, so its row key (the-row-key-is-the-only-dedupe) is this test's alone.
function statementFor(key: Key, n: number): Buffer {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const ref = refOf(key);

  return shopeeStatement({
    6: ["Username (Penjual)", "fix.right.e2e"],
    8: ["Dari", today],
    9: ["Ke", today],
    18: ["Tanggal Transaksi", "Tipe Transaksi", "Deskripsi", "No. Pesanan", "Jenis Transaksi", "Jumlah", "Status", "Saldo Akhir"],
    19: [
      `${today} 00:00:01`,
      "Penghasilan dari Pesanan",
      `Penghasilan dari Pesanan #${ref}`,
      ref,
      "Transaksi Masuk",
      `${PAID}.00`,
      "Transaksi Selesai",
      `11${SUFFIX}${n}.00`,
    ],
  });
}

// ── the session ─────────────────────────────────────────────────────────────────────────────────────────────────────────

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
      const text = await res.text();
      let json: any = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      return { status: res.status, body: json };
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

async function move(page: Page, teamId: string, orderId: string, to: string) {
  const res = await ok<{ results: { moved?: boolean; refusedReason?: string }[] }>(page, "selling.v1.OrderService/OrderStatusChange", {
    teamId,
    orderIds: [orderId],
    to,
  });
  expect(res.results[0]?.moved, `${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function signInAs(page: Page, key: Key) {
  await signIn(page, userOf(key), PASSWORD);
  await useTeam(page, ground.team);
}

// The order as the server keeps it.
async function orderOf(page: Page, orderId: string) {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId: ground.team, orderId })).order as {
    shopId: string;
    status: string;
    timelineLogs?: { note?: string; status?: string }[];
  };
}

async function fixShop(page: Page, orderId: string, shopId: string) {
  return call(page, "selling.v1.OrderService/OrderShopUpdate", { teamId: ground.team, orderId, shopId });
}

// The order's page, its Shop fact drawn.
async function openOrder(page: Page, orderId: string) {
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId("order-shop-name")).toBeVisible({ timeout: 15_000 });
}

// The Import File dialog on /settlement/imports: shop B picked, the statement attached, the import started.
async function importStatement(page: Page, statement: Buffer) {
  await page.goto("/settlement/imports");
  await page.getByTestId("open-import-file").click();

  const dialog = page.getByTestId("import-dialog");
  await expect(dialog).toBeVisible();

  await openShops(dialog);
  await dialog.getByTestId(`shop-select-option-${ground.shops.B}`).click();

  await dialog.getByTestId("import-file-input").setInputFiles({
    name: "statement.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: statement,
  });
  await expect(dialog.getByTestId("import-file-name")).toContainText("statement.xlsx");
  await dialog.getByTestId("start-import").click();

  return dialog;
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Fix Shop Seller ${SUFFIX}`, `OXS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Fix Shop WH ${SUFFIX}`, `OXW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  const users: Record<string, string> = {};
  for (const r of ROLES) {
    const made = await ok(page, "user.v1.UserService/CreateUser", {
      teamId: ground.team,
      username: userOf(r.key),
      password: PASSWORD,
      name: `Fix Shop ${r.label} ${SUFFIX}`,
      role: r.role,
    });
    users[r.key] = String(made.user.id);
  }

  const shop = async (name: string, code: string, marketplace: string) =>
    String((await ok(page, "selling.v1.ShopService/ShopCreate", { teamId: ground.team, name, shopCode: code, marketplace })).shop.id);
  ground.shops.A = await shop(SHOP.A, `OXA${SUFFIX}`, "MARKETPLACE_SHOPEE");
  ground.shops.B = await shop(SHOP.B, `OXB${SUFFIX}`, "MARKETPLACE_SHOPEE");
  ground.shops.T = await shop(SHOP.T, `OXT${SUFFIX}`, "MARKETPLACE_TOKOPEDIA");
  ground.shops.D = await shop(SHOP.D, `OXD${SUFFIX}`, "MARKETPLACE_SHOPEE");
  // Root first on A and B — the first grant is the primary CS, and a statement imports only for a shop with one. The CS
  // may write B only: the owner and the admin write every shop of the team (a-write-needs-a-grant-or-a-manager).
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shops.A, userId: ROOT_USER_ID });
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shops.B, userId: ROOT_USER_ID });
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shops.B, userId: users.cs });

  // 10 units of the product on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `ox-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Fix Shop ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: `OXP${SUFFIX}`,
      name: PRODUCT,
      categoryId: category,
    })
  ).product;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E fix shop ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-OXS-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.team,
    accountId: account,
    operational: true,
  });
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count: 10, total: 100_000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 10, placements: [{ placementId: rack, quantity: 10 }] }],
  });

  // Every order on A — the wrong shop. The warehouse walks it to the courier; customer service moves it on from there.
  const walks: Record<Key | Extra, string[]> = {
    own: ["PROCESSED", "PICKED", "SHIPPING", "SHIPPED", "COMPLETED"],
    adm: ["PROCESSED", "PICKED", "SHIPPING", "SHIPPED", "COMPLETED"],
    cs: ["PROCESSED", "PICKED", "SHIPPING", "SHIPPED", "COMPLETED"],
    pending: [],
    picked: ["PROCESSED", "PICKED"],
    shipped: ["PROCESSED", "PICKED", "SHIPPING", "SHIPPED"],
  };
  const sellerMoves = new Set(["SHIPPED", "COMPLETED"]);
  for (const [key, walk] of Object.entries(walks) as [Key | Extra, string[]][]) {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-oxshop-${key}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId: ground.shops.A,
      warehouseId: ground.warehouse,
      customerName: `E2E Fix Shop Buyer ${key} ${SUFFIX}`,
      platformTotal: PLATFORM_TOTAL,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(key),
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
    });
    const id = String(placed.order.id);
    for (const to of walk) {
      await move(page, sellerMoves.has(to) ? ground.team : ground.warehouse, id, `ORDER_STATUS_${to}`);
    }
    ground.orders[key] = id;
  }

  // The sale opened on each completed order's settlement account (order placed → settlement), under A — the account the
  // fix moves. Waited for here, so the fix meets an account as an order of the day would.
  for (const r of ROLES) {
    await expect
      .poll(
        async () =>
          (await call(page, "settlement.v1.SettlementService/OrderSettlementDetail", { teamId: ground.team, orderId: ground.orders[r.key] }))
            .body?.settlement?.shopId ?? "",
        { timeout: 60_000, message: `the settlement account of order ${ground.orders[r.key]}` },
      )
      .toBe(ground.shops.A);
  }

  await page.close();
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  await seed(browser);
});

test.describe("selling:all wants to fix an order's shop (status: completed · order in wrong shop · statement import refused)", () => {
  ROLES.forEach((r, n) => {
    test(`${r.label} edit shop order`, async ({ page }) => {
      const orderId = ground.orders[r.key];
      const statement = statementFor(r.key, n);
      await signInAs(page, r.key);

      // GIVEN — completed, recorded in A.
      const before = await orderOf(page, orderId);
      expect(before.status).toBe("ORDER_STATUS_COMPLETED");
      expect(before.shopId).toBe(ground.shops.A);

      // GIVEN — shop B's statement naming the order is refused: the order sits in another shop of the team.
      const refused = await importStatement(page, statement);
      await expect(refused.getByTestId("import-failed-reason")).toContainText(
        `1 of this file's orders belong to ${SHOP.A} — the whole file is refused, nothing was posted`,
        { timeout: 30_000 },
      );
      await expect(refused.getByTestId("import-summary")).toHaveCount(0);
      await refused.getByTestId("import-close").click();

      // WHEN — Change Shop on the order's page: B, Next, the confirm naming both shops, Change Shop.
      await openOrder(page, orderId);
      await expect(page.getByTestId("order-shop-name")).toHaveText(SHOP.A);
      await page.getByTestId("order-change-shop").click();
      const dialog = page.getByTestId("change-shop-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("change-shop-current")).toContainText(SHOP.A);
      await openShops(dialog);
      await dialog.getByTestId(`shop-select-option-${ground.shops.B}`).click();
      await dialog.getByTestId("change-shop-next").click();
      await expect(dialog.getByTestId("change-shop-confirm-text")).toContainText(`from ${SHOP.A} to ${SHOP.B}`);
      await dialog.getByTestId("change-shop-save").click();
      // Saved, it closes; refused, it stays open on change-shop-error (the failure's snapshot shows the reason).
      await expect(dialog).toBeHidden();

      await test.step("then: shop changed", async () => {
        await expect.soft(page.getByTestId("order-shop-name")).toHaveText(SHOP.B);
        await expect.soft(page.getByText("Shop changed").first()).toBeVisible();
        const after = await orderOf(page, orderId);
        expect.soft(after.shopId).toBe(ground.shops.B);
        expect.soft(after.status).toBe("ORDER_STATUS_COMPLETED");

        // Read again from a fresh load — the page's own record, not the dialog's cache.
        await openOrder(page, orderId);
        await expect.soft(page.getByTestId("order-shop-name")).toHaveText(SHOP.B);
      });

      await test.step("then: shop change shown in order timeline", async () => {
        await openOrder(page, orderId);
        const notes = page.getByTestId("section-notes").getByTestId("order-note-text");
        await expect.soft(notes.filter({ hasText: `Toko: ${SHOP.A} → ${SHOP.B}` })).toHaveCount(1);
        const logs = (await orderOf(page, orderId)).timelineLogs ?? [];
        expect.soft(logs.filter((l) => l.note === `Toko: ${SHOP.A} → ${SHOP.B}` && !l.status).length).toBe(1);
      });

      await test.step("then: statement import succeeds", async () => {
        // Settlement moves the order's account on OrderShopChanged — an event, so it is waited for.
        await expect
          .poll(
            async () =>
              (await call(page, "settlement.v1.SettlementService/OrderSettlementDetail", { teamId: ground.team, orderId })).body?.settlement
                ?.shopId ?? "",
            { timeout: 45_000, message: "the order's settlement account on shop B" },
          )
          .toBe(ground.shops.B);

        const dialog = await importStatement(page, statement);
        await expect.soft(dialog.getByTestId("import-progress-text")).toHaveText("1 of 1 rows", { timeout: 30_000 });
        await expect.soft(dialog.getByTestId("import-summary")).toContainText("Every row went in.", { timeout: 15_000 });
        await expect.soft(dialog.getByTestId("tally-posted-value")).toHaveText("1");
        await expect.soft(dialog.getByTestId("import-failed-reason")).toHaveCount(0);

        // The statement's line is the order's, under B.
        const detail = await ok(page, "settlement.v1.SettlementService/OrderSettlementDetail", { teamId: ground.team, orderId });
        const fund = (detail.entries as { settlementType: string; change: number; shopId: string; sourceType: string }[]).filter(
          (e) => e.settlementType === "SETTLEMENT_TYPE_FUND" && e.sourceType === "SOURCE_TYPE_IMPORTER",
        );
        expect.soft(fund.length).toBe(1);
        expect.soft(Number(fund[0]?.change)).toBe(PAID);
        expect.soft(fund[0]?.shopId).toBe(ground.shops.B);
      });
    });
  });
});

// ── regression ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// BEFORE HANDOVER THE SHOP IS NOT FIXED (the 🔄 of 2026-11-18: the platform has paid nothing yet): a pending and a
// picked order show their shop with no Change Shop beside it, and the server refuses the fix by name.
test("Before handover an order's shop is not fixed — no Change Shop, FailedPrecondition", async ({ page }) => {
  await signInAs(page, "own");

  for (const key of ["pending", "picked"] as const) {
    const orderId = ground.orders[key];
    await openOrder(page, orderId);
    await expect(page.getByTestId("order-shop-name")).toHaveText(SHOP.A);
    await expect(page.getByTestId("order-change-shop")).toHaveCount(0);

    const refused = await fixShop(page, orderId, ground.shops.B);
    expect(refused.body.code, `${key}: ${JSON.stringify(refused.body)}`).toBe("failed_precondition");
    expect(refused.body.message).toContain("from handover on");
    expect((await orderOf(page, orderId)).shopId).toBe(ground.shops.A);
  }
});

// THE PICKER OFFERS ONLY WHAT THE SERVER TAKES — the CS, granted on B alone: B is offered, the Tokopedia shop and the
// ungranted Shopee shop are not, and fixing to the ungranted one is refused PermissionDenied naming it.
test("Change Shop offers only same-marketplace shops the person may write — an ungranted one is refused by name", async ({ page }) => {
  const orderId = ground.orders.shipped;
  await signInAs(page, "cs");

  await openOrder(page, orderId);
  await page.getByTestId("order-change-shop").click();
  const dialog = page.getByTestId("change-shop-dialog");
  await expect(dialog).toBeVisible();
  await openShops(dialog);
  await expect(dialog.getByTestId(`shop-select-option-${ground.shops.B}`)).toBeVisible();
  await expect(dialog.getByTestId(`shop-select-option-${ground.shops.T}`)).toHaveCount(0);
  await expect(dialog.getByTestId(`shop-select-option-${ground.shops.D}`)).toHaveCount(0);

  const refused = await fixShop(page, orderId, ground.shops.D);
  expect(refused.body.code, JSON.stringify(refused.body)).toBe("permission_denied");
  expect(refused.body.message).toContain(SHOP.D);
  expect((await orderOf(page, orderId)).shopId).toBe(ground.shops.A);
});

// A SHOP OF ANOTHER MARKETPLACE IS REFUSED (a-shops-marketplace-and-team-are-fixed) — even for the owner, who may write
// every shop of the team: its statements are another platform's. The owner's picker does not offer it either.
test("A shop of another marketplace is not offered and is refused FailedPrecondition", async ({ page }) => {
  const orderId = ground.orders.shipped;
  await signInAs(page, "own");

  await openOrder(page, orderId);
  await page.getByTestId("order-change-shop").click();
  const dialog = page.getByTestId("change-shop-dialog");
  await openShops(dialog);
  await expect(dialog.getByTestId(`shop-select-option-${ground.shops.D}`)).toBeVisible();
  await expect(dialog.getByTestId(`shop-select-option-${ground.shops.T}`)).toHaveCount(0);

  const refused = await fixShop(page, orderId, ground.shops.T);
  expect(refused.body.code, JSON.stringify(refused.body)).toBe("failed_precondition");
  expect(refused.body.message).toContain("same marketplace");
  expect((await orderOf(page, orderId)).shopId).toBe(ground.shops.A);
});

// THE SAME SHOP AGAIN CHANGES NOTHING: on the screen Next stays off on the shop the order is in, and the server answers
// the order as it is — no note, no move.
test("The same shop again changes nothing — Next stays off, no note is written", async ({ page }) => {
  const orderId = ground.orders.shipped;
  await signInAs(page, "own");

  await openOrder(page, orderId);
  await page.getByTestId("order-change-shop").click();
  const dialog = page.getByTestId("change-shop-dialog");
  await openShops(dialog);
  await dialog.getByTestId(`shop-select-option-${ground.shops.A}`).click();
  await expect(dialog.getByTestId("change-shop-next")).toBeDisabled();

  const same = await fixShop(page, orderId, ground.shops.A);
  expect(same.status, JSON.stringify(same.body)).toBe(200);
  expect(String(same.body.order?.shopId)).toBe(ground.shops.A);
  const after = await orderOf(page, orderId);
  expect(after.shopId).toBe(ground.shops.A);
  expect(after.status).toBe("ORDER_STATUS_SHIPPED");
  expect((after.timelineLogs ?? []).filter((l) => (l.note ?? "").startsWith("Toko:"))).toHaveLength(0);
});

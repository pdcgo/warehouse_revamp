import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { readXlsx } from "./xlsx";

// ── export order — the checks behind docs/acceptances/inventory/order.md (## export) ─────────────────────────────────────
//
// export order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are the
// owner's, set by hand — never by this file.
//
// Business rules:
// - one-export-is-the-list-as-a-file (docs/technical/frontend/warehouse_order_list_decision.md): ONE OrderExport serves
//   the seller's list and the warehouse's. It takes the list's OWN filter — the status tab included — so the file holds
//   exactly the rows the list holds, EVERY page of them; the columns are the reader's side; .xlsx; a server stream that
//   reports progress and ends with a download link (both lists show it on their Export button: "Exporting 200 / 456").
// - the reader's columns (order_export.go): the seller's carry its money — Goods cost, Warehouse fee, Platform total —
//   the warehouse's row carries none of it (a warehouse sees no seller money).
//
// `selling:all` → EVERY selling role (selling:owner, selling:admin, selling:cs); `warehouse:all` → every warehouse role
// (warehouse:owner, warehouse:admin, warehouse:staff) — each in its own browser session, on the same ground (an export
// changes nothing, so the roles share it).
//
// The WHEN — the person's own list, its tab (and, for the warehouse, its search), then Export:
// - the seller: Orders › Shipped — 25 orders, so the list is TWO pages at its default 20 — and the header's Export
//   (orders-export);
// - the warehouse: Warehouse Orders › Picked, the search box narrowed to a term three of its five picked orders carry,
//   and the bar's Export with nothing ticked (pick-queue-bulk-export: "every row the filters show").
//
// How each then is read:
// - `file holds every order of the tab, all pages` — the downloaded .xlsx's Order ID column is exactly the 25 shipped
//   orders (page 1's 20 and page 2's 5), and none of the team's pending orders.
// - `file shows money columns` — the seller's header carries Goods cost, Warehouse fee and Platform total, and every row
//   reads its order's own figures as the server keeps them (OrderDetail).
// - `progress shown while exporting` — while the stream runs, the Export button reads its progress, "<done> / <total>":
//   0 / 25 when the count is known, then 25 / 25 once the rows are written, and gives the download after. The stream's
//   messages are the server's own; only their DELIVERY is slowed (each envelope re-emitted 1.5 s after the last, as on a
//   slow line), since on localhost the whole stream lands within one frame and no screen could be seen counting.
// - `file holds only the filtered orders` — the warehouse's file is exactly the three picked orders the search matches:
//   not the two picked ones it does not match, not the confirmed one it does match (another tab).
// - `file shows no seller money` — the warehouse's header carries no money column (no Goods cost, Warehouse fee,
//   Platform total — nothing priced), and no cell holds any of the three orders' platform total or goods cost.
//
// GROUND (beforeAll, as root, through the API): a selling team of its own with a user per selling role, a warehouse it
// ships from with a user per warehouse role, one Shopee shop (root and the CS on it), 40 units of one product accepted
// onto a rack there. Orders of 1 unit: 25 walked to `shipped` (the warehouse confirms, picks and hands over; the seller
// marks shipped), 2 left `pending`; in the warehouse 3 `picked` carrying the search term, 2 `picked` without it and 1
// `processed` (confirmed) with it. Each order's platform total is its own, so a cell is told apart by its figure.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-export-pass-1";
const PRODUCT = `Sabun Ekspor ${SUFFIX}`;
const SKU = `EXP${SUFFIX}`;
const STOCK = 40;
const UNIT_COST = 13_579;
const SHIPPED = 25;
const PAGE_SIZE = 20; // the seller list's default page (SellerOrders.tsx)

const SELLING_ROLES = [
  { key: "own", role: "ROLE_SELLING_OWNER", label: "selling:owner" },
  { key: "adm", role: "ROLE_SELLING_ADMIN", label: "selling:admin" },
  { key: "cs", role: "ROLE_SELLING_CS", label: "selling:cs" },
] as const;
const WAREHOUSE_ROLES = [
  { key: "wown", role: "ROLE_WAREHOUSE_OWNER", label: "warehouse:owner" },
  { key: "wadm", role: "ROLE_WAREHOUSE_ADMIN", label: "warehouse:admin" },
  { key: "wstf", role: "ROLE_WAREHOUSE_STAFF", label: "warehouse:staff" },
] as const;
type Key = (typeof SELLING_ROLES)[number]["key"] | (typeof WAREHOUSE_ROLES)[number]["key"];

const COND_SELLING = "status tab: shipped · multi pages";
const COND_WAREHOUSE = "status tab: picked · search filter";

const userOf = (key: Key) => `e2eex${key}${SUFFIX}`;
const nameOf = (key: Key) => `Export ${key} ${SUFFIX}`;
// The term the warehouse types: it is in three picked orders' Order ID and in one confirmed order's, nowhere else.
const TERM = `EXQ${SUFFIX}`;

// The seller's money columns (order_export.go › sellerColumns).
const MONEY_COLUMNS = ["Goods cost", "Warehouse fee", "Platform total"];

type Money = { goodsCost: number; warehouseFee?: number; platformTotal: number };

const ground = {
  team: "",
  warehouse: "",
  shop: "",
  // the 25 shipped orders, newest last
  shipped: [] as string[],
  pending: [] as string[],
  // picked, carrying the term / picked, without it / confirmed, carrying it
  matching: [] as string[],
  others: [] as string[],
  confirmed: [] as string[],
  // order id → its money as the server keeps it
  money: {} as Record<string, Money>,
};

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

// Many orders moved in one call (OrderStatusChange takes up to 200) — every one must move.
async function moveAll(page: Page, teamId: string, orderIds: string[], to: string) {
  const res = await ok<{ results: { orderId?: string; moved?: boolean; refusedReason?: string }[] }>(
    page,
    "selling.v1.OrderService/OrderStatusChange",
    { teamId, orderIds, to: `ORDER_STATUS_${to}` },
  );
  const refused = res.results.filter((r) => !r.moved);
  expect(refused, `→ ${to}: ${JSON.stringify(refused)}`).toEqual([]);
  expect(res.results.length).toBe(orderIds.length);
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function signInAs(page: Page, key: Key, teamId: string) {
  await signIn(page, userOf(key), PASSWORD);
  await useTeam(page, teamId);
}

// AS ON A SLOW LINE — the OrderExport stream's envelopes (flag byte, 4-byte big-endian length, the message) are handed
// to the app one at a time, 1.5 s apart. Every message is the server's own, unchanged; only when it arrives moves.
// connect-web reads `globalThis.fetch` on each call, so wrapping it before the page loads reaches the app's transport.
async function slowExportStream(page: Page) {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const res = await real(input, init);
      if (!url.endsWith("/OrderExport") || !res.body) return res;

      const reader = res.body.getReader();
      let buf = new Uint8Array(0);
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          for (;;) {
            if (buf.length >= 5) {
              const length = new DataView(buf.buffer, buf.byteOffset + 1, 4).getUint32(0);
              if (buf.length >= 5 + length) {
                const envelope = buf.slice(0, 5 + length);
                buf = buf.slice(5 + length);
                await new Promise((resolve) => setTimeout(resolve, 1_500));
                controller.enqueue(envelope);

                return;
              }
            }

            const { done, value } = await reader.read();
            if (done) {
              if (buf.length > 0) controller.enqueue(buf);
              controller.close();

              return;
            }
            const next = new Uint8Array(buf.length + value.length);
            next.set(buf);
            next.set(value, buf.length);
            buf = next;
          }
        },
      });

      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    };
  });
}

// The downloaded file's first sheet, and its header's column index by name.
async function fileOf(download: import("@playwright/test").Download) {
  expect(download.suggestedFilename()).toMatch(/^orders-.*\.xlsx$/);
  const sheets = readXlsx(await download.path());
  const [rows = []] = [...sheets.values()];
  const [header = [], ...body] = rows;
  const col = (name: string) => header.indexOf(name);
  expect(col("Order ID"), `the header: ${JSON.stringify(header)}`).toBeGreaterThanOrEqual(0);

  return { header, body, col, ids: body.map((r) => r[col("Order ID")] ?? "") };
}

const sorted = (ids: string[]) => [...ids].sort((a, b) => Number(a) - Number(b));

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Export Seller ${SUFFIX}`, `EXS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Export WH ${SUFFIX}`, `EXW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  const users: Record<string, string> = {};
  for (const [teamId, roles] of [
    [ground.team, SELLING_ROLES],
    [ground.warehouse, WAREHOUSE_ROLES],
  ] as const) {
    for (const r of roles) {
      const made = await ok(page, "user.v1.UserService/CreateUser", {
        teamId,
        username: userOf(r.key),
        password: PASSWORD,
        name: nameOf(r.key),
        role: r.role,
      });
      users[r.key] = String(made.user.id);
    }
  }

  ground.shop = String(
    (
      await ok(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.team,
        name: `E2E Ekspor Shop ${SUFFIX}`,
        shopCode: `EXP${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  // Root first — the first grant is the shop's primary CS; the CS on it too.
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shop, userId: ROOT_USER_ID });
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shop, userId: users.cs });

  // The product's units on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `ex-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Export ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: SKU,
      name: PRODUCT,
      categoryId: category,
    })
  ).product;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E export ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-EXP-${SUFFIX}`,
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
    items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count: STOCK, total: STOCK * UNIT_COST }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: STOCK, placements: [{ placementId: rack, quantity: STOCK }] }],
  });

  // GIVEN — every order placed by root on the one shop, 1 unit, its platform total its own.
  let n = 0;
  const place = async (ref: string) => {
    n++;
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-export-${ref}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId: ground.shop,
      warehouseId: ground.warehouse,
      customerName: `E2E Ekspor Buyer ${n} ${SUFFIX}`,
      platformTotal: 150_000 + n * 1_013,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: ref,
      receiptCode: `JEX${SUFFIX}R${n}`,
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
    });

    return String(placed.order.id);
  };
  for (let i = 1; i <= SHIPPED; i++) ground.shipped.push(await place(`EXS${SUFFIX}S${String(i).padStart(2, "0")}`));
  for (let i = 1; i <= 2; i++) ground.pending.push(await place(`EXS${SUFFIX}P${i}`));
  for (let i = 1; i <= 3; i++) ground.matching.push(await place(`${TERM}M${i}`));
  for (let i = 1; i <= 2; i++) ground.others.push(await place(`EXN${SUFFIX}N${i}`));
  ground.confirmed.push(await place(`${TERM}C1`));

  // The warehouse confirms, picks and hands over; the seller marks the handed-over ones shipped.
  const picked = [...ground.matching, ...ground.others];
  await moveAll(page, ground.warehouse, [...ground.shipped, ...picked, ...ground.confirmed], "PROCESSED");
  await moveAll(page, ground.warehouse, [...ground.shipped, ...picked], "PICKED");
  await moveAll(page, ground.warehouse, ground.shipped, "SHIPPING");
  await moveAll(page, ground.team, ground.shipped, "SHIPPED");

  // Each order's money as the server keeps it — what the seller's file must read, and the warehouse's must not.
  for (const id of [...ground.shipped, ...ground.matching]) {
    const order = (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId: ground.team, orderId: id })).order;
    ground.money[id] = {
      goodsCost: Number(order.goodsCost ?? 0),
      warehouseFee: order.warehouseFee === undefined ? undefined : Number(order.warehouseFee),
      platformTotal: Number(order.platformTotal ?? 0),
    };
  }

  await page.close();
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── selling:all (status tab: shipped · multi pages) ─────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to take orders to a spreadsheet (${COND_SELLING})`, () => {
  for (const r of SELLING_ROLES) {
    test(`${r.label} export order`, async ({ page }) => {
      await slowExportStream(page);
      await signInAs(page, r.key, ground.team);

      // GIVEN — Orders › Shipped: 25 orders, two pages at the list's 20.
      await page.goto("/orders?status=shipped");
      await expect(page.getByTestId("orders-tab-shipped")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("orders-table")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid^="order-row-"]')).toHaveCount(PAGE_SIZE, { timeout: 15_000 });
      // The pager says two pages ("1 of 2"), the next one reachable.
      await expect(page.getByTestId("page-text")).toHaveText(/^\s*1\s*\D+\s*2\s*$/);
      await expect(page.getByTestId("page-next")).toBeEnabled();

      // WHEN — the header's Export.
      const button = page.getByTestId("orders-export");
      const [download, request] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        page.waitForRequest((req) => req.url().endsWith("/OrderExport")),
        (async () => {
          await button.click();

          await test.step("then: progress shown while exporting", async () => {
            // The count known, nothing written yet — then every row written.
            await expect.soft(button).toContainText(new RegExp(`(^|\\D)0 / ${SHIPPED}(\\D|$)`), { timeout: 10_000 });
            await expect.soft(button).toContainText(`${SHIPPED} / ${SHIPPED}`, { timeout: 10_000 });
          });
        })(),
      ]);
      // The list's own tab went with it.
      expect.soft(request.postData() ?? "").toContain("ORDER_STATUS_SHIPPED");

      const file = await fileOf(download);

      await test.step("then: file holds every order of the tab, all pages", async () => {
        expect.soft(file.body.length, "rows under the header").toBe(SHIPPED);
        expect.soft(sorted(file.ids)).toEqual(sorted(ground.shipped));
        for (const id of ground.pending) expect.soft(file.ids, `pending #${id}`).not.toContain(id);
      });

      await test.step("then: file shows money columns", async () => {
        for (const name of MONEY_COLUMNS) expect.soft(file.header, `column ${name}`).toContain(name);
        const [cost, fee, total] = MONEY_COLUMNS.map(file.col);
        for (const row of file.body) {
          const id = row[file.col("Order ID")] ?? "";
          const money = ground.money[id];
          if (!money) continue; // not ours — already failed above
          expect.soft(Number(row[total!]), `#${id} platform total`).toBeCloseTo(money.platformTotal, 2);
          expect.soft(money.goodsCost, `#${id} has a goods cost`).toBeGreaterThan(0);
          expect.soft(Number(row[cost!]), `#${id} goods cost`).toBeCloseTo(money.goodsCost, 2);
          if (money.warehouseFee === undefined) {
            expect.soft(row[fee!] ?? "", `#${id} warehouse fee (never priced)`).toBe("");
          } else {
            expect.soft(Number(row[fee!]), `#${id} warehouse fee`).toBeCloseTo(money.warehouseFee, 2);
          }
        }
      });

      // The export over, the button is itself again.
      await expect.soft(button).not.toContainText(" / ");
    });
  }
});

// ── warehouse:all (status tab: picked · search filter) ──────────────────────────────────────────────────────────────────

test.describe(`warehouse:all wants to take orders to a spreadsheet (${COND_WAREHOUSE})`, () => {
  for (const r of WAREHOUSE_ROLES) {
    test(`${r.label} export order`, async ({ page }) => {
      await signInAs(page, r.key, ground.warehouse);

      // GIVEN — Warehouse Orders › Picked, the search typed: the three picked orders carrying the term, and only them.
      await page.goto("/warehouse-orders?step=picked");
      await expect(page.getByTestId("pick-tab-picked")).toHaveAttribute("aria-selected", "true");
      for (const id of [...ground.matching, ...ground.others]) {
        await expect(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible({ timeout: 15_000 });
      }
      await page.getByTestId("warehouse-orders-search").fill(TERM);
      for (const id of ground.others) await expect(page.getByTestId(`pick-queue-row-${id}`)).toHaveCount(0, { timeout: 15_000 });
      for (const id of ground.matching) await expect(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
      await expect(page.getByTestId("pick-tab-picked")).toHaveAttribute("aria-selected", "true");

      // WHEN — the bar's Export, nothing ticked: every row the filters show.
      const [download, request] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        page.waitForRequest((req) => req.url().endsWith("/OrderExport")),
        page.getByTestId("pick-queue-bulk-export").click(),
      ]);
      const sent = request.postData() ?? "";
      expect.soft(sent, "the search went with it").toContain(TERM);
      expect.soft(sent, "the tab went with it").toContain("ORDER_STATUS_PICKED");

      const file = await fileOf(download);

      await test.step("then: file holds only the filtered orders", async () => {
        expect.soft(file.body.length, "rows under the header").toBe(ground.matching.length);
        expect.soft(sorted(file.ids)).toEqual(sorted(ground.matching));
        for (const id of ground.others) expect.soft(file.ids, `picked #${id}, not matching`).not.toContain(id);
        for (const id of ground.confirmed) expect.soft(file.ids, `confirmed #${id}, matching`).not.toContain(id);
      });

      await test.step("then: file shows no seller money", async () => {
        for (const name of MONEY_COLUMNS) expect.soft(file.header, `column ${name}`).not.toContain(name);
        const priced = file.header.filter((h) => /cost|fee|total|price|harga|biaya|money/i.test(h));
        expect.soft(priced, "money columns").toEqual([]);
        for (const row of file.body) {
          const id = row[file.col("Order ID")] ?? "";
          const money = ground.money[id];
          if (!money) continue; // not ours — already failed above
          expect.soft(money.goodsCost, `#${id} has a goods cost to hide`).toBeGreaterThan(0);
          const figures = [money.platformTotal, money.goodsCost];
          const leaks = row.filter((cell) => cell !== "" && figures.some((f) => Math.abs(Number(cell) - f) < 0.005));
          expect.soft(leaks, `#${id}: cells holding its money`).toEqual([]);
        }
      });
    });
  }
});

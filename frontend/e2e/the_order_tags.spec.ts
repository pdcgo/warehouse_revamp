import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";
import { readXlsx } from "./xlsx";

// ORDER TAGS — end to end, on the real server and Postgres (backlog #100). A REGRESSION spec: no acceptance row names
// order tags yet, so its checks are plain tests. The rules (read from the business docs, not from the code):
//
//   orders-have-their-own-tag-list (docs/business/order/context_decision.md) — orders keep a tag list of their OWN, one
//     list for every team, a name unique within it (any case, spaces folded): a name that exists answers that tag, never
//     a twin;
//   its 🔄 "A" — the restock tags' rules on that list: a tag is SYSTEM or CUSTOM; a custom tag made and put on / taken off
//     by anyone who may write on the order — the selling team AND the warehouse that ships it, in every status, NOT a
//     monitor; system tags, rename and delete for Root / the Administrator only; the order lists filter by tag, ANY of the
//     picked;
//   its 🔄 "A" on app tags — no app-owned order tags, so nothing is locked for an admin;
//   the-order-tags-prototype-is-accepted (docs/technical/frontend/order_list_decision.md) — the seller's list: a Tag
//     column after Toko, the Tag filter (`?tag=1,2`); the warehouse's list: a Tag column right after Status, the Tag
//     filter beside the courier filter; a Tag box on the seller's detail (its own nav item, before Catatan), on the
//     warehouse's detail (Info tab) and on the pick page; the filter narrows the rows, the warehouse's tab counts, the
//     seller's Statistik and Ekspor alike, and the file gains a Tags column after Status (both views); Kelola tag
//     pesanan — a rename to a taken name refused, a delete whose confirm says how many orders it comes off;
//   the restock tags' design it follows (the-restock-tags-prototype-is-accepted): a team's user sees a system tag LOCKED —
//     no × — and finds it only greyed in the add list ("Admin only").
//
// The ground, all the spec's own (root seeds through the API): a selling team S shipping from its warehouse W, a second
// selling team O shipping from W too (its order is ANOTHER TEAM'S to S), an admin team A; S's selling OWNER, W's
// warehouse STAFF and A's owner (a MONITOR). Every order is S's unless named; each test has its own orders. Every tag
// name carries SUFFIX — the orders' list is app-wide.

const PASSWORD = "e2e-order-tags-1";
const OWNER = `e2eotown${SUFFIX}`;
const STAFF = `e2eotstf${SUFFIX}`;
const MONITOR = `e2eotmon${SUFFIX}`;
const RPC = "selling.v1.OrderService";
const SYSTEM = "ORDER_TAG_TYPE_SYSTEM";
const CUSTOM = "ORDER_TAG_TYPE_CUSTOM";

type Tag = { id: string; name: string; type: string; orderCount?: string };

const ORDER_KEYS = ["detail", "wh", "twin", "sys", "plain", "f1", "f2", "f3", "mon", "cx", "mga", "mgb"] as const;

const ground = {
  seller: "",
  warehouse: "",
  other: "",
  admin: "",
  o: {} as Record<string, string>,
  // the filter's two tags (f1 carries FA, f2 FB, f3 none), the monitor's read tag (on `mon`) and a spare one
  fa: "",
  fb: "",
  read: "",
  spare: "",
};

const refOf = (key: string) => `OT${SUFFIX}${key.toUpperCase()}`;
const FA_NAME = `E2E Ord Filter A ${SUFFIX}`;
const FB_NAME = `E2E Ord Filter B ${SUFFIX}`;

// An RPC as the signed-in person — its status and its JSON body (an error's `code` included), never thrown.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

// A refusal, by its Connect code.
async function refused(page: Page, method: string, body: unknown, code: string) {
  const res = await call(page, method, body);
  expect(res.status, `${method} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).not.toBe(200);
  expect(res.body.code, `${method} ${JSON.stringify(body)}`).toBe(code);
}

// The orders' list's tags whose name contains `q` (any case), as `teamId`'s caller reads them.
async function tagsNamed(page: Page, teamId: string, q: string): Promise<Tag[]> {
  const res = await api(page, `${RPC}/OrderTagList`, { teamId, q, page: { page: 1, limit: 200 } });

  return (res.tags ?? []) as Tag[];
}

// The ONE tag carrying exactly this name.
async function tagCalled(page: Page, teamId: string, name: string): Promise<Tag> {
  const hits = (await tagsNamed(page, teamId, name)).filter((t) => t.name.toLowerCase() === name.toLowerCase());
  expect(hits, `order tags named ${name}`).toHaveLength(1);

  return hits[0]!;
}

// An order's tags as `teamId` (one of its sides) reads them on OrderDetail.
async function tagsOn(page: Page, teamId: string, orderId: string): Promise<Tag[]> {
  const res = await api(page, `${RPC}/OrderDetail`, { teamId, orderId });

  return (res.order.tags ?? []) as Tag[];
}

const ids = (tags: Tag[]) => tags.map((t) => t.id).sort();

// `user` signed in, working in `team` (the active team is per tab, in sessionStorage).
async function as(page: Page, user: string, password: string, team: string) {
  await login(page, user, password);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
}

async function pageAs(browser: Browser, user: string, password: string, team: string) {
  const page = await browser.newPage();
  await as(page, user, password, team);

  return page;
}

// The seller's order page — its Tag section drawn.
async function sellerDetail(page: Page, key: string) {
  await page.goto(`/orders/${ground.o[key]}`);
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  const box = page.getByTestId("section-tags").getByTestId("order-tags-box");
  await expect(box).toBeVisible();

  return box;
}

// The seller's list, searched for one order's marketplace ref — its row.
async function sellerRow(page: Page, key: string) {
  await page.goto(`/orders?q=${encodeURIComponent(refOf(key))}`);
  const row = page.getByTestId(`order-row-${ground.o[key]}`);
  await expect(row).toBeVisible({ timeout: 15_000 });

  return row;
}

// Type into an order page's add box (it opens on the click).
async function typeTag(page: Page, text: string) {
  const input = page.getByTestId("order-tag-add-input");
  await input.click();
  await input.fill(text);
}

// Pick one tag in a list's Tag filter: the list opened, the name typed to narrow it, the option clicked.
async function pickTag(page: Page, tagId: string, name: string) {
  const input = page.getByTestId("order-tag-filter-input");
  const option = page.getByTestId(`order-tag-filter-option-${tagId}`);
  await input.click();
  await expect(option).toBeVisible();
  await input.fill(name);
  await option.click();
  await expect(page.getByTestId(`order-tag-filter-pick-${tagId}`)).toBeVisible();
}

const tagParam = (page: Page) => new URL(page.url()).searchParams.get("tag");

// A table's header cells, trimmed.
async function headers(page: Page, table: string) {
  return (await page.getByTestId(table).locator("thead th").allInnerTexts()).map((h) => h.trim());
}

// The downloaded order file: its header, its rows, a column's index by name.
async function fileOf(download: import("@playwright/test").Download) {
  expect(download.suggestedFilename()).toMatch(/^orders-.*\.xlsx$/);
  const [rows = []] = [...readXlsx(await download.path()).values()];
  const [header = [], ...body] = rows;
  const col = (name: string) => header.indexOf(name);
  expect(col("Order ID"), `the header: ${JSON.stringify(header)}`).toBeGreaterThanOrEqual(0);

  return { header, body, col, ids: body.map((r) => r[col("Order ID")] ?? "") };
}

test.describe("order tags", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.seller = await team(`E2E OrdTag Seller ${SUFFIX}`, `OTS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E OrdTag WH ${SUFFIX}`, `OTW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    ground.other = await team(`E2E OrdTag Other ${SUFFIX}`, `OTO${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.admin = await team(`E2E OrdTag Admin ${SUFFIX}`, `OTA${SUFFIX}`, "TEAM_TYPE_ADMIN");

    // W takes orders (a fee) and both sellers return to it.
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });
    for (const teamId of [ground.seller, ground.other]) {
      await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId, warehouseId: ground.warehouse });
    }

    for (const [teamId, username, name, role] of [
      [ground.seller, OWNER, `Owner OrdTag ${SUFFIX}`, "ROLE_SELLING_OWNER"],
      [ground.warehouse, STAFF, `Staff OrdTag ${SUFFIX}`, "ROLE_WAREHOUSE_STAFF"],
      [ground.admin, MONITOR, `Monitor OrdTag ${SUFFIX}`, "ROLE_ADMIN_OWNER"],
    ] as const) {
      await api(page, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name, role });
    }

    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `ot-${SUFFIX}`, name: "E2E order tags" }))
        .rack.id,
    );
    const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E OrdTag Cat ${SUFFIX}` })).category.id;

    // A selling team's shop, product and 20 units of it on W's rack.
    const sellerKit = async (teamId: string, code: string) => {
      const shop = String(
        (
          await api(page, "selling.v1.ShopService/ShopCreate", {
            teamId,
            name: `E2E OrdTag Shop ${code}`,
            shopCode: code,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
      await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId, shopId: shop, userId: ROOT_USER_ID });
      const product = (
        await api(page, "product.v1.ProductService/ProductCreate", { teamId, productCodePart: code, name: `E2E ${code}`, categoryId: category })
      ).product;
      const account = String(
        (
          await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
            teamId,
            type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
            provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
            name: `E2E OrdTag BCA ${code}`,
            holderName: "E2E",
            accountNumber: `E2E-OT-${code}`,
            openingBalance: 0,
            openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
          })
        ).account.id,
      );
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId,
        accountId: account,
        operational: true,
      });
      const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId,
        warehouseId: ground.warehouse,
        financeAccountId: account,
        items: [{ productId: product.id, productCode: product.productCode, name: `E2E ${code}`, count: 20, total: 200_000 }],
      });
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: restock.request.id,
        lines: [{ itemId: restock.request.items[0].id, receivedCount: 20, placements: [{ placementId: rack, quantity: 20 }] }],
      });

      return { shop, product };
    };
    const kits = { [ground.seller]: await sellerKit(ground.seller, `OTP${SUFFIX}`), [ground.other]: await sellerKit(ground.other, `OTQ${SUFFIX}`) };

    // One order of 1 unit, placed by root.
    let n = 0;
    const place = async (key: string, teamId = ground.seller) => {
      n++;
      const kit = kits[teamId]!;
      const placed = await api(page, `${RPC}/OrderCreate`, {
        idempotencyKey: `e2e-order-tags-${SUFFIX}-${key}`,
        shipmentChannelId: "1",
        teamId,
        shopId: kit.shop,
        warehouseId: ground.warehouse,
        customerName: `E2E OrdTag Buyer ${key} ${SUFFIX}`,
        platformTotal: 100_000 + n * 1_000,
        platformCreatedAtUnix: Math.floor(Date.now() / 1000),
        orderExternalRefId: refOf(key),
        receiptCode: `JOT${SUFFIX}R${n}`,
        items: [{ productId: kit.product.id, productCode: kit.product.productCode, name: `E2E ${kit.product.productCode}`, quantity: 1 }],
      });
      ground.o[key] = String(placed.order.id);
    };
    for (const key of ORDER_KEYS) await place(key);
    await place("other", ground.other);

    // W confirms two (the pick page's order and one of the filter's); S cancels one.
    const moved = await api(page, `${RPC}/OrderStatusChange`, {
      teamId: ground.warehouse,
      orderIds: [ground.o.wh, ground.o.f2],
      to: "ORDER_STATUS_PROCESSED",
    });
    expect((moved.results as { moved?: boolean }[]).every((r) => r.moved), JSON.stringify(moved)).toBe(true);
    await api(page, `${RPC}/OrderCancel`, { teamId: ground.seller, orderId: ground.o.cx });

    // The filter's ground: FA on f1, FB on f2, none on f3. The monitor's: a tag on `mon`, and a spare one.
    const make = async (name: string) => String((await api(page, `${RPC}/OrderTagCreate`, { teamId: ground.seller, name })).tag.id);
    ground.fa = await make(FA_NAME);
    ground.fb = await make(FB_NAME);
    ground.read = await make(`E2E Ord Dibaca ${SUFFIX}`);
    ground.spare = await make(`E2E Ord Cadangan ${SUFFIX}`);
    for (const [key, tagId] of [
      ["f1", ground.fa],
      ["f2", ground.fb],
      ["mon", ground.read],
    ] as const) {
      await api(page, `${RPC}/OrderTagAdd`, { teamId: ground.seller, orderId: ground.o[key], tagId });
    }

    await page.close();
  });

  test("a selling owner tags its order on the detail — a new tag typed, an existing one picked — seen on the list row, and × takes one off", async ({
    page,
  }) => {
    const fresh = `E2E Ord Kemasan ${SUFFIX}`;
    const existing = `E2E Ord Sudah Ada ${SUFFIX}`;
    const id = ground.o.detail!;

    await as(page, OWNER, PASSWORD, ground.seller);
    const made = await api(page, `${RPC}/OrderTagCreate`, { teamId: ground.seller, name: existing });
    const existingId = String(made.tag.id);

    const box = await sellerDetail(page, "detail");
    await expect(box.getByTestId("order-tags")).toHaveCount(0);
    // The Tag box has its own nav item, before Catatan.
    const nav = (await page.locator('[data-testid^="section-nav-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid"))))
      .filter((t) => t !== "section-nav" && t !== "section-nav-strip");
    expect(nav).toContain("section-nav-tags");
    expect(nav.indexOf("section-nav-tags")).toBeLessThan(nav.indexOf("section-nav-notes"));

    // Typed, a name nobody has: Create tag — a custom one only, the owner is no admin.
    await typeTag(page, fresh);
    await expect(page.getByTestId("order-tag-add-create-custom")).toBeVisible();
    await expect(page.getByTestId("order-tag-add-create-system")).toHaveCount(0);
    await page.getByTestId("order-tag-add-create-custom").click();
    await expect(box.getByTestId("order-tags")).toContainText(fresh);
    const tag = await tagCalled(page, ground.seller, fresh);
    expect(tag.type).toBe(CUSTOM);
    const chip = box.getByTestId(`order-tag-${tag.id}`);
    await expect(chip).toHaveText(fresh);
    await expect(chip).toHaveAttribute("data-tag-type", "custom");

    // A part of an existing tag's name offers it; picked, it goes on.
    await typeTag(page, `Sudah Ada ${SUFFIX}`);
    await page.getByTestId(`order-tag-add-option-${existingId}`).click();
    await expect(box.getByTestId(`order-tag-${existingId}`)).toHaveText(existing);
    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([tag.id, existingId].sort());

    // The list: the Tag column after the shop's, the row carrying both chips.
    const row = await sellerRow(page, "detail");
    const head = await headers(page, "orders-table");
    expect(head[head.indexOf("Tags") - 1], JSON.stringify(head)).toMatch(/^(Shop|Team)/);
    const cell = row.getByTestId(`order-tags-cell-${id}`);
    await expect(cell.getByTestId(`order-tags-${id}-${tag.id}`)).toHaveText(fresh);
    await expect(cell.getByTestId(`order-tags-${id}-${existingId}`)).toHaveText(existing);

    // Its × takes it off the order — the tag stays on the orders' list.
    await sellerDetail(page, "detail");
    await box.getByTestId(`order-tag-${tag.id}-remove`).click();
    await expect(box.getByTestId(`order-tag-${tag.id}`)).toHaveCount(0);
    await expect(box.getByTestId(`order-tag-${existingId}`)).toBeVisible();
    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([existingId]);
    expect((await tagsNamed(page, ground.seller, fresh)).map((t) => t.id)).toEqual([tag.id]);
  });

  test("the shipping warehouse tags the order on its order detail and its pick page; the seller reads those tags and may take one off", async ({
    page,
  }) => {
    const onDetail = `E2E Ord Rak Retur ${SUFFIX}`;
    const onPick = `E2E Ord Pecah Belah ${SUFFIX}`;
    const id = ground.o.wh!;

    // The warehouse's order page, Info tab (where it opens): a confirmed order, tagged by the staff.
    await as(page, STAFF, PASSWORD, ground.warehouse);
    await page.goto(`/orders/${id}`);
    await expect(page.getByTestId("order-detail-tab-info")).toHaveAttribute("aria-selected", "true");
    const detailBox = page.getByTestId("order-detail-tags").getByTestId("order-tags-box");
    await expect(detailBox).toBeVisible();
    await typeTag(page, onDetail);
    await page.getByTestId("order-tag-add-create-custom").click();
    await expect(detailBox.getByTestId("order-tags")).toContainText(onDetail);
    const first = await tagCalled(page, ground.warehouse, onDetail);
    expect(first.type).toBe(CUSTOM);

    // The pick page shows it too, and tags from there.
    await page.goto(`/warehouse-orders/${id}`);
    const pickBox = page.getByTestId("pick-order-tags").getByTestId("order-tags-box");
    await expect(pickBox.getByTestId(`order-tag-${first.id}`)).toHaveText(onDetail);
    await typeTag(page, onPick);
    await page.getByTestId("order-tag-add-create-custom").click();
    await expect(pickBox.getByTestId("order-tags")).toContainText(onPick);
    const second = await tagCalled(page, ground.warehouse, onPick);
    expect(ids(await tagsOn(page, ground.warehouse, id))).toEqual([first.id, second.id].sort());

    // The warehouse's list: the Tag column right after Status, the row carrying both chips.
    await page.goto("/warehouse-orders?step=confirm");
    const whRow = page.getByTestId(`pick-queue-row-${id}`);
    await expect(whRow).toBeVisible({ timeout: 15_000 });
    const head = await headers(page, "pick-queue-table");
    expect(head.indexOf("Tags"), JSON.stringify(head)).toBe(head.indexOf("Status") + 1);
    await expect(whRow.getByTestId(`order-tags-${id}-${first.id}`)).toHaveText(onDetail);
    await expect(whRow.getByTestId(`order-tags-${id}-${second.id}`)).toHaveText(onPick);

    // The seller reads the same two — one tag list per order, both sides — and takes one off, whoever put it on.
    const owner = await pageAs(page.context().browser()!, OWNER, PASSWORD, ground.seller);
    const box = await sellerDetail(owner, "wh");
    await expect(box.getByTestId(`order-tag-${first.id}`)).toHaveText(onDetail);
    await expect(box.getByTestId(`order-tag-${second.id}`)).toHaveText(onPick);
    const row = await sellerRow(owner, "wh");
    await expect(row.getByTestId(`order-tags-${id}-${first.id}`)).toHaveText(onDetail);
    await sellerDetail(owner, "wh");
    await box.getByTestId(`order-tag-${second.id}-remove`).click();
    await expect(box.getByTestId(`order-tag-${second.id}`)).toHaveCount(0);
    await owner.close();

    expect(ids(await tagsOn(page, ground.warehouse, id))).toEqual([first.id]);
  });

  test("every status: a cancelled order is tagged by the seller and untagged by the warehouse", async ({ page }) => {
    const id = ground.o.cx!;

    await as(page, OWNER, PASSWORD, ground.seller);
    const detail = await api(page, `${RPC}/OrderDetail`, { teamId: ground.seller, orderId: id });
    expect(detail.order.status).toBe("ORDER_STATUS_CANCEL");
    const on = await api(page, `${RPC}/OrderTagAdd`, { teamId: ground.seller, orderId: id, tagId: ground.spare });
    expect(ids(on.tags as Tag[])).toEqual([ground.spare]);

    const staff = await pageAs(page.context().browser()!, STAFF, PASSWORD, ground.warehouse);
    expect(ids(await tagsOn(staff, ground.warehouse, id))).toEqual([ground.spare]);
    const off = await api(staff, `${RPC}/OrderTagRemove`, { teamId: ground.warehouse, orderId: id, tagId: ground.spare });
    expect(off.tags ?? []).toEqual([]);
    await staff.close();

    expect(await tagsOn(page, ground.seller, id)).toEqual([]);
  });

  test("one name, one tag: ' Urgent ' and 'URGENT' answer the 'urgent' that exists — never a twin", async ({ page }) => {
    const name = `e2e urgent ${SUFFIX}`;
    const id = ground.o.twin!;

    await as(page, OWNER, PASSWORD, ground.seller);
    const made = await api(page, `${RPC}/OrderTagCreate`, { teamId: ground.seller, name });
    expect(made.created).toBe(true);
    const tagId = String(made.tag.id);

    // Loose spaces and another case — from either side: the list is one for every team. The name stays as first typed.
    const spaced = await api(page, `${RPC}/OrderTagCreate`, { teamId: ground.seller, name: `  E2E   Urgent ${SUFFIX} ` });
    expect(spaced.created ?? false).toBe(false);
    expect(String(spaced.tag.id)).toBe(tagId);
    expect(spaced.tag.name).toBe(name);
    const staff = await pageAs(page.context().browser()!, STAFF, PASSWORD, ground.warehouse);
    const shouted = await api(staff, `${RPC}/OrderTagCreate`, { teamId: ground.warehouse, name: `E2E URGENT ${SUFFIX}` });
    expect(shouted.created ?? false).toBe(false);
    expect(String(shouted.tag.id)).toBe(tagId);
    await staff.close();
    expect((await tagsNamed(page, ground.seller, `urgent ${SUFFIX}`)).map((t) => t.id)).toEqual([tagId]);

    // On the screen: typed in upper case with loose spaces, the add box offers THAT tag and no Create.
    const box = await sellerDetail(page, "twin");
    await typeTag(page, ` E2E  URGENT ${SUFFIX} `);
    await expect(page.getByTestId(`order-tag-add-option-${tagId}`)).toBeVisible();
    await expect(page.getByTestId("order-tag-add-create-custom")).toHaveCount(0);
    await page.getByTestId(`order-tag-add-option-${tagId}`).click();
    await expect(box.getByTestId(`order-tag-${tagId}`)).toHaveText(name);

    // Typed once more, it is said to be on already — still no Create.
    await typeTag(page, `E2E Urgent ${SUFFIX}`);
    await expect(page.getByTestId(`order-tag-add-on-${tagId}`)).toBeVisible();
    await expect(page.getByTestId("order-tag-add-create-custom")).toHaveCount(0);
    await page.keyboard.press("Escape");

    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([tagId]);
    expect((await tagsNamed(page, ground.seller, `urgent ${SUFFIX}`)).map((t) => t.id)).toEqual([tagId]);
  });

  test("the seller's Tag filter takes two tags: the list, Statistik and Ekspor hold the orders carrying ANY of them, kept as ?tag=", async ({
    page,
  }) => {
    const [f1, f2, f3] = [ground.o.f1!, ground.o.f2!, ground.o.f3!];
    const { fa, fb } = ground;

    await as(page, OWNER, PASSWORD, ground.seller);
    await page.goto("/orders");
    await expect(page.getByTestId(`order-row-${f3}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("orders-tag-filter").getByTestId("order-tag-filter-select")).toBeVisible();

    await pickTag(page, fa, FA_NAME);
    await pickTag(page, fb, FB_NAME);
    await page.keyboard.press("Escape");

    // Kept in the address; the rows are the two tagged orders, not the untagged one.
    await expect.poll(() => tagParam(page)).toBe(`${fa},${fb}`);
    const rows = page.locator('[data-testid^="order-row-"]');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId(`order-row-${f1}`)).toBeVisible();
    await expect(page.getByTestId(`order-row-${f2}`)).toBeVisible();
    await expect(page.getByTestId(`order-row-${f3}`)).toHaveCount(0);

    // Statistik reads the same filter: two orders.
    const statRead = page.waitForRequest((r) => r.url().endsWith(`${RPC}/OrderStat`));
    await page.getByTestId("order-summary-toggle").click();
    const sent = JSON.parse((await statRead).postData() ?? "{}") as { filter?: { tagIds?: string[] } };
    expect([...(sent.filter?.tagIds ?? [])].sort()).toEqual([fa, fb].sort());
    await expect(page.getByTestId("order-summary-total")).toContainText("2 tx");

    // Ekspor writes the same two, each with its tag in the Tags column right after Status.
    const [download, request] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.waitForRequest((r) => r.url().endsWith("/OrderExport")),
      page.getByTestId("orders-export").click(),
    ]);
    expect(request.postData() ?? "").toContain(fa);
    const file = await fileOf(download);
    const tagCol = file.col("Tags");
    expect(tagCol, JSON.stringify(file.header)).toBe(file.col("Status") + 1);
    expect([...file.ids].sort()).toEqual([f1, f2].sort());
    const tagsOf = Object.fromEntries(file.body.map((r) => [r[file.col("Order ID")] ?? "", r[tagCol] ?? ""]));
    expect(tagsOf).toEqual({ [f1]: FA_NAME, [f2]: FB_NAME });

    // The address alone brings the filter back.
    await page.reload();
    await expect(page.getByTestId(`order-tag-filter-pick-${fa}`)).toBeVisible();
    await expect(page.getByTestId(`order-tag-filter-pick-${fb}`)).toBeVisible();
    await expect(rows).toHaveCount(2);

    // × takes every pick back: the untagged order is there again, its Tag cell drawn empty.
    await page.getByTestId("order-tag-filter-clear").click();
    await expect.poll(() => tagParam(page) ?? "").toBe("");
    await expect(page.getByTestId(`order-row-${f3}`)).toBeVisible();
    await expect(page.getByTestId(`order-tags-cell-${f3}`)).toBeAttached();
    await expect(page.getByTestId(`order-tags-${f3}`)).toHaveCount(0);
  });

  test("the warehouse's Tag filter narrows its rows, its tab counts and its Ekspor (Tags right after Status)", async ({ page }) => {
    const [f1, f2] = [ground.o.f1!, ground.o.f2!];
    const { fa, fb } = ground;

    await as(page, STAFF, PASSWORD, ground.warehouse);
    // Unfiltered, the building holds more than the two (every order of S and O ships from it).
    await page.goto("/warehouse-orders?step=all");
    await expect(page.getByTestId(`pick-queue-row-${ground.o.f3}`)).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => Number(await page.getByTestId("pick-tab-count-all").innerText())).toBeGreaterThan(2);
    await expect(page.getByTestId("warehouse-orders-tag-filter").getByTestId("order-tag-filter-select")).toBeVisible();

    // The filter by the address: FA or FB — f1 pending (To Confirm), f2 confirmed.
    await page.goto(`/warehouse-orders?step=all&tag=${fa},${fb}`);
    await expect(page.getByTestId(`order-tag-filter-pick-${fa}`)).toBeVisible();
    await expect(page.getByTestId(`order-tag-filter-pick-${fb}`)).toBeVisible();
    const rows = page.locator('[data-testid^="pick-queue-row-"]');
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByTestId(`pick-queue-row-${f1}`)).toBeVisible();
    await expect(page.getByTestId(`pick-queue-row-${f2}`)).toBeVisible();
    await expect(page.getByTestId(`order-tags-${f1}-${fa}`)).toHaveText(FA_NAME);
    await expect(page.getByTestId("pick-tab-count-all")).toHaveText("2");
    await expect(page.getByTestId("pick-tab-count-toConfirm")).toHaveText("1");
    await expect(page.getByTestId("pick-tab-count-confirm")).toHaveText("1");
    await expect(page.getByTestId("pick-tab-count-picked")).toHaveText("0");

    // Ekspor, nothing ticked — every row the filters show, the Tags column right after Status.
    const [download, request] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.waitForRequest((r) => r.url().endsWith("/OrderExport")),
      page.getByTestId("pick-queue-bulk-export").click(),
    ]);
    expect(request.postData() ?? "").toContain(fb);
    const file = await fileOf(download);
    const tagCol = file.col("Tags");
    expect(tagCol, JSON.stringify(file.header)).toBe(file.col("Status") + 1);
    expect([...file.ids].sort()).toEqual([f1, f2].sort());
    const tagsOf = Object.fromEntries(file.body.map((r) => [r[file.col("Order ID")] ?? "", r[tagCol] ?? ""]));
    expect(tagsOf).toEqual({ [f1]: FA_NAME, [f2]: FB_NAME });

    // A tab narrows within it: To Confirm is f1 alone.
    await page.getByTestId("pick-tab-toConfirm").click();
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId(`pick-queue-row-${f1}`)).toBeVisible();
  });

  test("root makes a system tag and puts it on; a selling owner cannot put it on or take it off — locked, Admin only, refused", async ({
    page,
  }) => {
    const name = `E2E Ord Audit Admin ${SUFFIX}`;
    const id = ground.o.sys!;
    const plain = ground.o.plain!;
    const browser = page.context().browser()!;

    // Root, on the seller's order page: Create system tag.
    await as(page, ROOT_USERNAME, ROOT_PASSWORD, ground.seller);
    const box = await sellerDetail(page, "sys");
    await typeTag(page, name);
    await expect(page.getByTestId("order-tag-add-create-custom")).toBeVisible();
    await page.getByTestId("order-tag-add-create-system").click();
    await expect(box.getByTestId("order-tags")).toContainText(name);
    const tag = await tagCalled(page, ground.seller, name);
    expect(tag.type).toBe(SYSTEM);
    const chip = box.getByTestId(`order-tag-${tag.id}`);
    await expect(chip).toHaveAttribute("data-tag-type", "system");
    await expect(chip.getByTestId(`order-tag-${tag.id}-lock`)).toBeVisible();
    // No app-owned order tags — nothing is locked for an admin: root keeps its ×.
    await expect(chip.getByTestId(`order-tag-${tag.id}-remove`)).toBeVisible();
    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([tag.id]);

    // The owner: no put on, no take off, no system create, no rename, no delete — by any RPC.
    const owner = await pageAs(browser, OWNER, PASSWORD, ground.seller);
    const on = { teamId: ground.seller, orderId: plain, tagId: tag.id };
    const off = { teamId: ground.seller, orderId: id, tagId: tag.id };
    await refused(owner, `${RPC}/OrderSystemTagAdd`, on, "permission_denied");
    await refused(owner, `${RPC}/OrderTagAdd`, on, "permission_denied");
    await refused(owner, `${RPC}/OrderSystemTagRemove`, off, "permission_denied");
    await refused(owner, `${RPC}/OrderTagRemove`, off, "permission_denied");
    await refused(owner, `${RPC}/OrderTagSystemCreate`, { name: `E2E Ord Owner Sys ${SUFFIX}` }, "permission_denied");
    await refused(owner, `${RPC}/OrderTagRename`, { tagId: tag.id, name: `E2E Ord Owner ${SUFFIX}` }, "permission_denied");
    await refused(owner, `${RPC}/OrderTagDelete`, { tagId: tag.id }, "permission_denied");
    expect(ids(await tagsOn(owner, ground.seller, id))).toEqual([tag.id]);
    expect(await tagsOn(owner, ground.seller, plain)).toEqual([]);
    expect(await tagsNamed(owner, ground.seller, `Owner Sys ${SUFFIX}`)).toEqual([]);

    // …and on the owner's screen: the chip locked with no ×, the hint says why, no Kelola tag.
    const ownerBox = await sellerDetail(owner, "sys");
    await expect(ownerBox.getByTestId(`order-tag-${tag.id}-lock`)).toBeVisible();
    await expect(ownerBox.getByTestId(`order-tag-${tag.id}-remove`)).toHaveCount(0);
    await expect(ownerBox.getByTestId("order-tags-hint")).toContainText("A system tag (with a lock) is put on by an admin");
    await expect(owner.getByTestId("order-tag-manage")).toHaveCount(0);

    // On another order, typed, the system tag is offered greyed — Admin only — and no Create (the name exists).
    await sellerDetail(owner, "plain");
    await typeTag(owner, name);
    const option = owner.getByTestId(`order-tag-add-option-${tag.id}`);
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute("data-disabled", /.*/);
    await expect(option).toContainText("Admin only");
    await expect(owner.getByTestId("order-tag-add-create-custom")).toHaveCount(0);
    await expect(owner.getByTestId("order-tag-add-create-system")).toHaveCount(0);
    await owner.keyboard.press("Escape");
    expect(await tagsOn(owner, ground.seller, plain)).toEqual([]);
    await owner.close();
  });

  test("Kelola tag pesanan (root): a rename to a taken name is refused; the delete's confirm counts the orders and takes it off them", async ({
    page,
  }) => {
    const name = `E2E Ord Diperiksa ${SUFFIX}`;
    const taken = `E2E Ord Dipakai ${SUFFIX}`;
    const renamed = `E2E Ord Diperiksa Admin ${SUFFIX}`;
    const [a, b] = [ground.o.mga!, ground.o.mgb!];

    // Root makes a system tag (OrderTagSystemCreate) and puts it on two orders; a custom tag holds the other name.
    await as(page, ROOT_USERNAME, ROOT_PASSWORD, ground.seller);
    const made = await api(page, `${RPC}/OrderTagSystemCreate`, { name });
    expect(made.created).toBe(true);
    expect(made.tag.type).toBe(SYSTEM);
    const tagId = String(made.tag.id);
    for (const orderId of [a, b]) await api(page, `${RPC}/OrderSystemTagAdd`, { teamId: ground.seller, orderId, tagId });
    await api(page, `${RPC}/OrderTagCreate`, { teamId: ground.seller, name: taken });

    const box = await sellerDetail(page, "mga");
    await expect(box.getByTestId(`order-tag-${tagId}`)).toHaveText(name);
    await page.getByTestId("order-tag-manage").click();
    const dialog = page.getByTestId("order-tag-manage-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId(`order-tag-manage-usage-${tagId}`)).toHaveText("2 orders");

    // Renamed to a name another order tag carries, in another case: refused, said in the row.
    await dialog.getByTestId(`order-tag-manage-rename-${tagId}`).click();
    await dialog.getByTestId("order-tag-manage-name-input").fill(taken.toUpperCase());
    await dialog.getByTestId("order-tag-manage-save").click();
    await expect(dialog.getByTestId("order-tag-manage-taken")).toBeVisible();
    await refused(page, `${RPC}/OrderTagRename`, { tagId, name: taken.toLowerCase() }, "already_exists");
    expect((await tagCalled(page, ground.seller, name)).id).toBe(tagId);

    // A free name: renamed.
    await dialog.getByTestId("order-tag-manage-name-input").fill(renamed);
    await dialog.getByTestId("order-tag-manage-save").click();
    await expect(dialog.getByTestId("order-tag-manage-name-input")).toHaveCount(0);
    await expect(dialog.getByTestId(`order-tag-manage-row-${tagId}`)).toContainText(renamed);
    expect((await tagCalled(page, ground.seller, renamed)).id).toBe(tagId);

    // The delete asks first, naming how many orders it comes off — then it is off both, and off the list.
    await dialog.getByTestId(`order-tag-manage-delete-${tagId}`).click();
    await expect(page.getByRole("alertdialog")).toContainText("2 orders");
    await page.getByTestId("confirm-action").click();
    await expect(dialog.getByTestId(`order-tag-manage-row-${tagId}`)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(box.getByTestId(`order-tag-${tagId}`)).toHaveCount(0);
    expect(await tagsOn(page, ground.seller, a)).toEqual([]);
    expect(await tagsOn(page, ground.seller, b)).toEqual([]);
    expect(await tagsNamed(page, ground.seller, renamed)).toEqual([]);
  });

  test("a monitor reads an order's tags but cannot add, take off or make one", async ({ page }) => {
    const id = ground.o.mon!;

    await as(page, MONITOR, PASSWORD, ground.seller);
    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([ground.read]);
    expect((await tagsNamed(page, ground.seller, `Dibaca ${SUFFIX}`)).map((t) => t.id)).toEqual([ground.read]);

    // The screen: the chip, read-only — no add box, no ×, no Kelola tag.
    const box = await sellerDetail(page, "mon");
    await expect(box.getByTestId(`order-tag-${ground.read}`)).toHaveText(`E2E Ord Dibaca ${SUFFIX}`);
    await expect(box.getByTestId(`order-tag-${ground.read}-remove`)).toHaveCount(0);
    await expect(page.getByTestId("order-tag-add")).toHaveCount(0);
    await expect(page.getByTestId("order-tag-add-input")).toHaveCount(0);
    await expect(page.getByTestId("order-tag-manage")).toHaveCount(0);

    // The API refuses every write.
    await refused(page, `${RPC}/OrderTagAdd`, { teamId: ground.seller, orderId: id, tagId: ground.spare }, "permission_denied");
    await refused(page, `${RPC}/OrderTagRemove`, { teamId: ground.seller, orderId: id, tagId: ground.read }, "permission_denied");
    await refused(page, `${RPC}/OrderTagCreate`, { teamId: ground.seller, name: `E2E Ord Monitor ${SUFFIX}` }, "permission_denied");
    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([ground.read]);
    expect(await tagsNamed(page, ground.seller, `Ord Monitor ${SUFFIX}`)).toEqual([]);
  });

  test("another team's order is NotFound to a tag put on or taken off — from the seller, and from root's own team", async ({ page }) => {
    const other = ground.o.other!;

    await as(page, OWNER, PASSWORD, ground.seller);
    await refused(page, `${RPC}/OrderTagAdd`, { teamId: ground.seller, orderId: other, tagId: ground.spare }, "not_found");
    await refused(page, `${RPC}/OrderTagRemove`, { teamId: ground.seller, orderId: other, tagId: ground.spare }, "not_found");

    // The root team is neither side of the order.
    const root = await pageAs(page.context().browser()!, ROOT_USERNAME, ROOT_PASSWORD, "1");
    await refused(root, `${RPC}/OrderTagAdd`, { teamId: "1", orderId: other, tagId: ground.spare }, "not_found");

    // Nothing went on it: its own team reads none.
    expect(await tagsOn(root, ground.other, other)).toEqual([]);
    await root.close();
  });
});

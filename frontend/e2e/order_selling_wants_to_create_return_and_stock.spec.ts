import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick } from "./restock_helpers";
import { API_URL } from "./env";
import { listLanded, pickTeam } from "./pickers";

// ── selling:all wants to create an order — the RETURN and STOCK givens of docs/acceptances/inventory/order.md ─────────
//
// The rest of create order's checks are order_selling_wants_to_create.spec.ts and
// order_selling_wants_to_create_debt_limit.spec.ts; these four givens are a file of their own so no file grows past the
// batch cap. An acceptance has no test file of its own (docs/acceptances/guide.md): this is still create order's
// regression spec, and the rows' statuses are the owner's, set by hand — never by this file.
//
// Business rules (docs/business/order/context_decision.md):
// - a-borrowed-line-needs-its-map-at-create — create refuses a borrowed line the team has not mapped for returns, naming
//   the product; the form holds Create and says why (a-borrowed-product-is-mapped-on-the-order-form,
//   docs/technical/frontend/order_create_decision.md).
// - the-map-is-written-when-it-is-picked + a-return-map-is-written-once — the pick confirmed on the Return Mapping card
//   writes the map at once, and it is never re-pointed: every later order of that product arrives with it, locked.
// - create-refuses-a-team-with-no-return-warehouse — the refusal names the team and says to set the return warehouse.
// - placing an order takes its goods off the shelf (the take), so an order asking for more than the warehouse's ready
//   stock is refused — on the form (the short line, Create held) and by the server (NOT_ENOUGH_STOCK).
//
// One test per given, run as EVERY selling role (selling:owner, selling:admin, selling:cs), through the seller's own
// order form, typed in: 2 units of the product, the order date, Rp 100.000 paid, a fresh Order ID, JNE. Every role and
// given orders its OWN product, so a figure read in one test is never moved by another.
//
// The ground (beforeAll, root): one warehouse (10% fee) shipping everything; the SELLER (its return warehouse is that
// warehouse); a CROSS team whose products carry a 20% markup and are restocked onto the same rack; and a seller with NO
// return warehouse (no team_return_configurations row) — a team of its own, with its own three users.
//   (cross product · no return map)   — a borrowed product per role, never mapped.
//   (cross product · return map chosen) — a borrowed product per role, unmapped until the role chooses its map on the
//                                       form (one of the seller's own products, QMAP), then ordered a second time.
//   (own product · no return warehouse set) — the no-return seller's own product per role, 10 on the shelf.
//   (own product · ready stock less than ordered) — the seller's own product per role, ONE unit on the shelf, 2 ordered.
//
// How each then is read:
// - `cannot create order` — the form holds Create (disabled) with the borrowed line unmapped; the same order sent
//   anyway with the role's own token is refused (failed_precondition, "map these borrowed products for returns …",
//   naming the product); no order of the team carries the Order ID and the product is still unmapped.
// - `reason shown in frontend` — under Create: "1 of these products still need a return mapping before the order can
//   be created."; on the Return Mapping card the product's row reads Needs mapping and the card counts 1 not mapped.
// - `return map saved and locked` — after the order is created: the team's map of the product reads the chosen own
//   product (ProductReturnMapByIds); a second map call naming another own product leaves it as it was (created false,
//   still the chosen one); and the next order form shows the row locked on the chosen product's name, no picker in it.
// - `return map used on next order` — that next order of the same product: the row arrives From last time, nothing
//   asks for a mapping, Create is free, and the order is created with the product on it.
// - `order refused` (no return warehouse) — the form's OrderCreate is answered failed_precondition, the form stays on
//   /orders/new showing the refusal, and no order of the team carries the Order ID.
// - `message says to set return warehouse` — that refusal says the return warehouse is not set and where to set it
//   (Settings › Return Warehouse).
// - `order refused` (ready stock less than ordered) — the form marks the line short (Ready 1 against 2), says it at the
//   top and holds Create; the same order sent anyway with the role's own token is refused (failed_precondition,
//   NOT_ENOUGH_STOCK); no order of the team carries the Order ID.
test.describe("selling:all wants to create an order (return map, return warehouse, ready stock)", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  type Role = (typeof ROLES)[number];

  const NO_MAP_COND = "1 product · cross product · 1 warehouse · no return map";
  const MAP_CHOSEN_COND = "1 product · cross product · 1 warehouse · return map chosen";
  const NO_RETURN_COND = "1 product · own product · 1 warehouse · no return warehouse set";
  const SHORT_COND = "1 product · own product · 1 warehouse · ready stock less than ordered";

  const STOCK = 10;
  const SHORT_STOCK = 1;
  const UNIT_COST = 10_000;
  const QTY = 2;
  const FEE_PERCENT = 10;
  const PLATFORM_TOTAL = 100_000;
  const CROSS_MARKUP_BPS = 2_000;

  const username = (team: "s" | "n", role: string) => `e2eoq${team}${role}${SUFFIX}`;
  // Team codes are at most 10 characters.
  const SELLER_CODE = `QS${SUFFIX}`;
  const NORET_CODE = `QN${SUFFIX}`;
  const CROSS_CODE = `QX${SUFFIX}`;
  const WH_CODE = `QW${SUFFIX}`;
  // The seller's own products a borrowed product's return can become: the one chosen, and the one a re-point names.
  const MAP_CODE = `QMAP${SUFFIX}`;
  const ALT_CODE = `QALT${SUFFIX}`;
  const noMapSku = (r: Role) => `QXN${r.key.toUpperCase()}${SUFFIX}`;
  const chosenSku = (r: Role) => `QXC${r.key.toUpperCase()}${SUFFIX}`;
  const noReturnSku = (r: Role) => `QNR${r.key.toUpperCase()}${SUFFIX}`;
  const shortSku = (r: Role) => `QSH${r.key.toUpperCase()}${SUFFIX}`;
  // A fresh Order ID per test and order, so the duplicate warning never stands in the way.
  const ref = (r: Role, tag: string) => `OQ${SUFFIX}${r.key.toUpperCase()}${tag.toUpperCase()}`;

  const ground = {
    seller: "",
    noReturn: "",
    noReturnName: `E2E Oq No Return ${SUFFIX}`,
    cross: "",
    warehouse: "",
    products: {} as Record<string, string>,
    shops: {} as Record<string, string>,
    noReturnShops: {} as Record<string, string>,
  };

  // An RPC under the page's signed-in token that may be REFUSED: its status and its JSON body, never a throw.
  async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    return page.evaluate(
      async ([m, b, apiUrl]) => {
        const token =
          window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
        const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(b),
        });
        return { status: res.status, json: (await res.json()) as Record<string, unknown> };
      },
      [method, body, API_URL] as const,
    );
  }

  // The team's map of one borrowed product — the own product a return of it becomes, or "" when it has none.
  async function mapOf(page: Page, team: string, shared: string): Promise<string> {
    const res = await api(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapByIds", {
      teamId: team,
      filter: { ids: [shared] },
      dataRequest: ["PRODUCT_RETURN_MAP_BY_IDS_DATA_TYPE_PAIR"],
    });
    for (const item of res.items?.[shared]?.items ?? []) {
      const pair = item.pair?.mapData?.[shared];
      if (pair) return String(pair.ownProductId ?? "");
    }
    return "";
  }

  // Whether any order of `team` carries the Order ID.
  async function orderHolds(page: Page, team: string, orderRef: string): Promise<boolean> {
    const held = await api(page, "selling.v1.OrderService/OrderByExternalRefs", {
      teamId: team,
      filter: { refs: [orderRef] },
      dataRequest: ["ORDER_BY_EXTERNAL_REFS_DATA_TYPE_ORDER_REF"],
    });
    return held.items?.[orderRef] !== undefined;
  }

  // The order the form would have sent, sent ANYWAY with the role's own token — the server's own answer to it.
  async function sendAnyway(page: Page, o: { team: string; shop: string; code: string; orderRef: string }) {
    return send(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-oq-${SUFFIX}-${o.orderRef}`,
      shipmentChannelId: "1",
      teamId: o.team,
      shopId: o.shop,
      warehouseId: ground.warehouse,
      customerName: `E2E Direct Buyer ${o.orderRef}`,
      platformTotal: PLATFORM_TOTAL,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: o.orderRef,
      items: [{ productId: ground.products[o.code], productCode: o.code, name: `E2E ${o.code}`, quantity: QTY }],
    });
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

    ground.seller = await team(`E2E Oq Seller ${SUFFIX}`, SELLER_CODE, "TEAM_TYPE_SELLING");
    ground.noReturn = await team(ground.noReturnName, NORET_CODE, "TEAM_TYPE_SELLING");
    ground.cross = await team(`E2E Oq Cross ${SUFFIX}`, CROSS_CODE, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Oq Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");
    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `oq-${SUFFIX}`, name: "E2E oq shelf" }))
        .rack.id,
    );
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", {
      teamId: ground.warehouse,
      feePercent: FEE_PERCENT,
      minFee: 0,
    });

    // Three users per selling team, one per role.
    const users: Record<string, string> = {};
    for (const [t, teamId] of [
      ["s", ground.seller],
      ["n", ground.noReturn],
    ] as const) {
      for (const r of ROLES) {
        const made = await api(page, "user.v1.UserService/CreateUser", {
          teamId,
          username: username(t, r.key),
          password: PASSWORD,
          name: `Oq ${t} ${r.given} ${SUFFIX}`,
          role: r.role,
        });
        users[`${t}${r.key}`] = String(made.user.id);
      }
    }
    // The seller returns to the warehouse; the no-return seller has NO row — its given.
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
    });

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Oq Cat ${SUFFIX}` });
    const supplierOf = async (teamId: string, tag: string) =>
      String((await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId, name: `E2E Oq Supplier ${tag} ${SUFFIX}` })).supplier.id);
    const accountOf = async (teamId: string, tail: string) => {
      const id = String(
        (
          await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
            teamId,
            type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
            provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
            name: `E2E Oq BCA ${tail} ${SUFFIX}`,
            holderName: "E2E",
            accountNumber: `86${SUFFIX}${tail}`,
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
    const paying: Record<string, { supplier: string; account: string }> = {
      [ground.seller]: { supplier: await supplierOf(ground.seller, "Seller"), account: await accountOf(ground.seller, "01") },
      [ground.noReturn]: { supplier: await supplierOf(ground.noReturn, "NoReturn"), account: await accountOf(ground.noReturn, "02") },
      [ground.cross]: { supplier: await supplierOf(ground.cross, "Cross"), account: await accountOf(ground.cross, "03") },
    };

    const product = async (owner: string, code: string) => {
      const id = String(
        (
          await api(page, "product.v1.ProductService/ProductCreate", {
            teamId: owner,
            productCodePart: code,
            name: `E2E ${code}`,
            categoryId: category.category.id,
            ...(owner === ground.cross ? { crossMarkupBps: CROSS_MARKUP_BPS } : {}),
          })
        ).product.id,
      );
      ground.products[code] = id;
      return id;
    };
    // `count` of each product, restocked by its owner from its supplier at Rp 10.000 a unit and accepted onto the rack.
    const restock = async (owner: string, codes: string[], count: number) => {
      const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: owner,
        warehouseId: ground.warehouse,
        financeAccountId: paying[owner]!.account,
        items: codes.map((code) => ({
          productId: ground.products[code],
          productCode: code,
          name: `E2E ${code}`,
          count,
          total: UNIT_COST * count,
          supplierId: paying[owner]!.supplier,
        })),
      });
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: raised.request.id,
        lines: (raised.request.items as { id: string }[]).map((item) => ({
          itemId: item.id,
          receivedCount: count,
          placements: [{ placementId: rack, quantity: count }],
        })),
      });
    };

    // The seller's own products a return can become — they need no stock.
    await product(ground.seller, MAP_CODE);
    await product(ground.seller, ALT_CODE);
    // The cross team's borrowed products: per role, one never mapped, one mapped on the form.
    const crossCodes = ROLES.flatMap((r) => [noMapSku(r), chosenSku(r)]);
    for (const code of crossCodes) await product(ground.cross, code);
    await restock(ground.cross, crossCodes, STOCK);
    // The no-return seller's own products, 10 each.
    for (const r of ROLES) await product(ground.noReturn, noReturnSku(r));
    await restock(ground.noReturn, ROLES.map(noReturnSku), STOCK);
    // The seller's own products with ONE unit each — 2 are ordered.
    for (const r of ROLES) await product(ground.seller, shortSku(r));
    await restock(ground.seller, ROLES.map(shortSku), SHORT_STOCK);

    // A shop per role in each selling team, the role on it.
    let n = 0;
    for (const r of ROLES) {
      for (const [t, teamId, shops] of [
        ["s", ground.seller, ground.shops],
        ["n", ground.noReturn, ground.noReturnShops],
      ] as const) {
        const shop = String(
          (
            await api(page, "selling.v1.ShopService/ShopCreate", {
              teamId,
              name: `E2E Oq Shop ${t} ${r.key} ${SUFFIX}`,
              shopCode: `Q${t.toUpperCase()}${++n}${SUFFIX}`,
              marketplace: "MARKETPLACE_SHOPEE",
            })
          ).shop.id,
        );
        shops[r.key] = shop;
        await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId, shopId: shop, userId: users[`${t}${r.key}`] });
      }
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

  // Chooses the borrowed product's return map on the Return Mapping card — the seller's own QMAP — and confirms it.
  async function chooseMap(page: Page, pid: string) {
    const row = page.getByTestId(`return-map-${pid}`);
    await expect(row.getByTestId(`return-map-needs-${pid}`)).toBeVisible();
    const field = row.getByTestId("product-select").getByRole("combobox");
    await field.click();
    await field.pressSequentially(MAP_CODE, { delay: 30 });
    await page.locator('[data-testid^="product-select-option-"]').filter({ hasText: MAP_CODE }).filter({ visible: true }).first().click();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId(`return-map-locked-${pid}`)).toBeVisible();
  }

  // WHEN, up to Create — the form typed in on `shop`: the product (a borrowed one on the picker's Other tab), 2 units,
  // the order date, Rp 100.000 paid, the Order ID, JNE. `chooseMap` maps a borrowed product on the card on the way.
  async function fill(
    page: Page,
    r: Role,
    o: { shop: string; code: string; cross: boolean; orderRef: string; chooseMap?: boolean },
  ) {
    await page.goto("/orders/new");
    await expect(page.getByTestId("order-create-page")).toBeVisible();
    await page.getByTestId("order-create-customer-name").fill(`E2E Buyer ${r.key} ${o.orderRef}`);
    await listLanded(page.locator('[data-testid^="shop-select-option-"]'));
    await page.getByTestId("shop-select").click();
    await page.getByTestId(`shop-select-option-${o.shop}`).click();
    await pickTeam(page, page.getByTestId("order-warehouse"), WH_CODE);
    await page.getByTestId("order-create-add-line").click();
    if (o.cross) await page.getByTestId("product-picker-tab-other").click();
    await tick(page, o.code);
    await page.getByTestId("product-picker-confirm").click();
    await page.getByTestId("order-line-qty-0").fill(String(QTY));
    if (o.chooseMap) await chooseMap(page, ground.products[o.code]!);
    await pickOrderDate(page);
    await page.getByTestId("order-marketplace-total").fill(String(PLATFORM_TOTAL));
    await page.getByTestId("order-external-ref-id").fill(o.orderRef);
    await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
    await page.getByTestId("shipment-channel-option-jne").click();
  }

  // Create — and the OrderCreate answer it got.
  async function createAnswer(page: Page): Promise<Response> {
    const [answer] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderCreate")),
      page.getByTestId("order-create-save").click(),
    ]);
    return answer;
  }

  // The order's own page, opened by Create: ONE item line, the product, pending.
  async function expectCreated(page: Page, answer: Response, code: string) {
    expect.soft(answer.status()).toBe(200);
    await expect.soft(page).toHaveURL(/\/orders\/\d+$/);
    await expect.soft(page.getByTestId("order-detail-page")).toBeVisible();
    const lines = page.getByTestId("section-items").locator('[data-testid^="order-item-"]');
    await expect.soft(lines).toHaveCount(1);
    await expect.soft(lines.first()).toContainText(code);
    await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
  }

  for (const r of ROLES) {
    test(`${r.given} create order (${NO_MAP_COND})`, async ({ page }) => {
      await signIn(page, username("s", r.key), ground.seller);
      const code = noMapSku(r);
      const pid = ground.products[code]!;
      const orderRef = ref(r, "nm");

      // WHEN — the order filled in on the form, the borrowed product's map never chosen.
      await fill(page, r, { shop: ground.shops[r.key]!, code, cross: true, orderRef });

      await test.step("then: cannot create order", async () => {
        // The form holds Create while the line is unmapped.
        await expect.soft(page.getByTestId(`return-map-needs-${pid}`)).toBeVisible();
        await expect.soft(page.getByTestId("order-create-save")).toBeDisabled();
        // The server refuses the same order sent anyway, naming the product.
        const direct = await sendAnyway(page, { team: ground.seller, shop: ground.shops[r.key]!, code, orderRef });
        expect.soft(direct.status).not.toBe(200);
        expect.soft(direct.json.code).toBe("failed_precondition");
        expect.soft(String(direct.json.message)).toContain("map these borrowed products for returns");
        expect.soft(String(direct.json.message)).toContain(code);
        // Nothing was placed, and nothing was mapped on the way.
        expect.soft(await orderHolds(page, ground.seller, orderRef)).toBe(false);
        expect.soft(await mapOf(page, ground.seller, pid)).toBe("");
        await expect.soft(page).toHaveURL(/\/orders\/new$/);
      });

      await test.step("then: reason shown in frontend", async () => {
        await expect.soft(page.getByTestId("order-create-blocked-mapping")).toHaveText(
          "1 of these products still need a return mapping before the order can be created.",
        );
        await expect.soft(page.getByTestId(`return-map-needs-${pid}`)).toHaveText("Needs mapping");
        await expect.soft(page.getByTestId("return-map-unmapped")).toHaveText("1 not mapped");
      });
    });

    test(`${r.given} create order (${MAP_CHOSEN_COND})`, async ({ page }) => {
      await signIn(page, username("s", r.key), ground.seller);
      const code = chosenSku(r);
      const pid = ground.products[code]!;
      const mapId = ground.products[MAP_CODE]!;

      // WHEN — the order filled in, the borrowed product's map chosen on the card (the seller's own QMAP), Create.
      await fill(page, r, { shop: ground.shops[r.key]!, code, cross: true, orderRef: ref(r, "mc1"), chooseMap: true });
      await expect(page.getByTestId("order-create-save")).toBeEnabled();
      const first = await createAnswer(page);
      expect(first.status()).toBe(200);
      await expect(page).toHaveURL(/\/orders\/\d+$/);

      // The next order of the same product, up to Create — read by both thens.
      const nextRef = ref(r, "mc2");
      await fill(page, r, { shop: ground.shops[r.key]!, code, cross: true, orderRef: nextRef });

      await test.step("then: return map saved and locked", async () => {
        // Saved — the team's map of the product is the chosen own product.
        expect.soft(await mapOf(page, ground.seller, pid)).toBe(mapId);
        // Locked — a second map naming another own product leaves it as it was.
        const repoint = await send(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
          teamId: ground.seller,
          sharedProductId: pid,
          ownProductId: ground.products[ALT_CODE],
        });
        expect.soft(repoint.status).toBe(200);
        expect.soft(Boolean(repoint.json.created)).toBe(false);
        expect.soft(String((repoint.json.map as { ownProductId?: string } | undefined)?.ownProductId ?? "")).toBe(mapId);
        expect.soft(await mapOf(page, ground.seller, pid)).toBe(mapId);
        // …and the form shows it locked on the chosen product, with nothing to pick.
        const row = page.getByTestId(`return-map-${pid}`);
        await expect.soft(row.getByTestId(`return-map-locked-${pid}`)).toContainText(`E2E ${MAP_CODE}`);
        await expect.soft(row.getByTestId("product-select")).toHaveCount(0);
      });

      await test.step("then: return map used on next order", async () => {
        // The row arrives with last time's answer, and nothing asks for a mapping.
        await expect.soft(page.getByTestId(`return-map-remembered-${pid}`)).toBeVisible();
        await expect.soft(page.getByTestId(`return-map-needs-${pid}`)).toHaveCount(0);
        await expect.soft(page.getByTestId("order-create-blocked-mapping")).toHaveCount(0);
        await expect.soft(page.getByTestId("order-create-save")).toBeEnabled();
        // The next order is created on it.
        const next = await createAnswer(page);
        await expectCreated(page, next, code);
        expect.soft(await orderHolds(page, ground.seller, nextRef)).toBe(true);
      });
    });

    test(`${r.given} create order (${NO_RETURN_COND})`, async ({ page }) => {
      await signIn(page, username("n", r.key), ground.noReturn);
      const orderRef = ref(r, "nr");

      // WHEN — the order filled in on the no-return seller's form, Create.
      await fill(page, r, { shop: ground.noReturnShops[r.key]!, code: noReturnSku(r), cross: false, orderRef });
      await expect(page.getByTestId("order-create-save")).toBeEnabled();
      const answer = await createAnswer(page);

      await test.step("then: order refused", async () => {
        expect.soft(answer.status()).not.toBe(200);
        expect.soft(((await answer.json()) as { code?: string }).code).toBe("failed_precondition");
        await expect.soft(page.getByTestId("order-create-error")).toBeVisible();
        await expect.soft(page).toHaveURL(/\/orders\/new$/);
        expect.soft(await orderHolds(page, ground.noReturn, orderRef)).toBe(false);
      });

      await test.step("then: message says to set return warehouse", async () => {
        const message = page.getByTestId("order-create-error");
        await expect.soft(message).toContainText("has no return warehouse set");
        await expect.soft(message).toContainText("set it on Settings › Return Warehouse");
      });
    });

    test(`${r.given} create order (${SHORT_COND})`, async ({ page }) => {
      await signIn(page, username("s", r.key), ground.seller);
      const code = shortSku(r);
      const orderRef = ref(r, "sh");

      // WHEN — 2 units of a product the warehouse holds ONE of.
      await fill(page, r, { shop: ground.shops[r.key]!, code, cross: false, orderRef });

      await test.step("then: order refused", async () => {
        // The form: the line marked short (Ready 1, 2 asked), said at the top, Create held.
        await expect.soft(page.getByTestId("order-line-stock-0")).toHaveText(String(SHORT_STOCK));
        await expect.soft(page.getByTestId("order-create-short")).toContainText("1 line asks for more than this warehouse holds");
        await expect.soft(page.getByTestId("order-create-save")).toBeDisabled();
        // The server: the same order sent anyway is refused by the take.
        const direct = await sendAnyway(page, { team: ground.seller, shop: ground.shops[r.key]!, code, orderRef });
        expect.soft(direct.status).not.toBe(200);
        expect.soft(direct.json.code).toBe("failed_precondition");
        expect.soft(String(direct.json.message)).toContain("NOT_ENOUGH_STOCK");
        // Nothing was placed.
        expect.soft(await orderHolds(page, ground.seller, orderRef)).toBe(false);
        await expect.soft(page).toHaveURL(/\/orders\/new$/);
      });
    });
  }
});

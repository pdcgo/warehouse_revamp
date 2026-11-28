import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";

// A PRODUCT'S FORMER CODES STILL FIND IT — end to end, on the real server and Postgres (backlog #152, #141 P4). A
// REGRESSION spec: no acceptance row covers an old sticker yet (docs/acceptances/teams/team_code.md's *past orders and
// restocks keep old code* is only related), so its checks are plain tests and `regression: …` steps.
//
// The rule (docs/business/product/context_decision.md):
//
//   a-team-code-change-recomposes-its-product-codes — `<old>-<part>` becomes `<new>-<part>` on every product of the
//     team; its 🔄 *past lines keep their code* (an order or a sample line keeps the code it was written with); its 🔄
//     *an old sticker scanned before the reprint* (owner Q1 "A"): a product's FORMER codes still find it — the pick
//     page's scan (ItemScan, the custom-shipment pick too) and the product search match the line's code, the live code
//     and every former code of the same product — and a team code once used is never given to another team.
//
// What #152 built and this file reads:
//   ProductService.ProductCodesByIds {team_id, ids[1–200]} — each product's live code and former codes (newest first,
//     never the live one); ids the caller may not see are left out (a warehouse sees what it has held).
//   The pick scan — trimmed, any case, the WHOLE code — against the line's code, the product's live code and every former
//     code: an order placed BEFORE the change takes the NEW sticker, one placed AFTER takes an OLD sticker; part of a code
//     is the wrong scan (*Not on this order*, the wrong sound). Each scan line carries `data-scan-codes` (the codes it
//     takes, lower-cased — not a test id).
//   The seller's Products list search and the warehouse's search — a former code typed EXACTLY (any case) finds the
//     product; part of a former code finds nothing; the name and the live code match as before (any part).
//
// The ground, all the spec's own (root seeds through the API): a selling team T (its owner), a warehouse W (owner, admin,
// staff) holding T's product P on its rack; T's product Q on no shelf (W never held it). Order O1 and sample S1 are
// placed BEFORE T's selling owner changes the team's code (TeamCodeUpdate, as the_product_tags.spec.ts's #149 test);
// order O2 and sample S2 AFTER. Both orders stand processed (confirmed by root), both samples requested.

const PASSWORD = "e2e-former-codes-1";
const T_OWNER = `e2efctow${SUFFIX}`;
const W_OWNER = `e2efcwow${SUFFIX}`;
const W_ADMIN = `e2efcwad${SUFFIX}`;
const W_STAFF = `e2efcwst${SUFFIX}`;

// Team codes: at most 10 characters, apart from every other SUFFIX importer's (the `FC…` family is this file's). The code
// T changes TO is free too, and the old one stays taken after the change.
const T_OLD = `FCT${SUFFIX}`;
const T_NEW = `FCN${SUFFIX}`;
const W_CODE = `FCW${SUFFIX}`;

const P_PART = `KOPI${SUFFIX}`;
const Q_PART = `TEH${SUFFIX}`;
const P_NAME = `E2E Former Kopi ${SUFFIX}`;
const Q_NAME = `E2E Former Teh ${SUFFIX}`;

const STOCK = 12; // P on W's rack: O1 2 + O2 2 + S1 2 + S2 2, and spare
const QTY = 2; // every order and sample, of P

const OLD_P = `${T_OLD}-${P_PART}`;
const NEW_P = `${T_NEW}-${P_PART}`;
const OLD_Q = `${T_OLD}-${Q_PART}`;
const NEW_Q = `${T_NEW}-${Q_PART}`;

const ground = {
  seller: "",
  warehouse: "",
  rack: "",
  p: "",
  q: "",
  o1: "",
  o2: "",
  s1: "",
  s2: "",
  codeUpdate: {} as { changed?: boolean; team?: { teamCode?: string }; productsRecomposed?: number },
};

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

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A space-joined list attribute (`data-scan-codes`) holding exactly this word.
const holds = (word: string) => new RegExp(`(^| )${reEscape(word)}( |$)`);

// THE SCANNER'S EAR (order_warehouse_wants_to_pick.spec.ts's): lib/beep.ts makes its two sounds with the browser's
// AudioContext; headless has no speaker, so the page gets a stand-in that hears each tone (pitch, length) and makes none.
type Tone = { type: string; hz: number; seconds: number };
async function installEar(page: Page) {
  await page.addInitScript(() => {
    const heard: { type: string; hz: number; seconds: number }[] = [];
    (window as unknown as { __heard: typeof heard }).__heard = heard;
    class Ear {
      currentTime = 0;
      destination = {};
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
      createOscillator() {
        const osc: {
          type: string;
          frequency: { value: number };
          at: number;
          connect(): void;
          start(at: number): void;
          stop(at: number): void;
        } = {
          type: "sine",
          frequency: { value: 0 },
          at: 0,
          connect() {},
          start(at: number) {
            osc.at = at;
          },
          stop(at: number) {
            heard.push({ type: osc.type, hz: osc.frequency.value, seconds: at - osc.at });
          },
        };
        return osc;
      }
    }
    Object.defineProperty(window, "AudioContext", { value: Ear, configurable: true, writable: true });
  });
}
async function heard(page: Page): Promise<Tone[]> {
  return page.evaluate(() => (window as unknown as { __heard?: Tone[] }).__heard ?? []);
}
// One scan into the pick page's item scan (typed as the scanner types it, then Enter), and the ONE tone it made.
async function scanAndHear(page: Page, code: string): Promise<Tone> {
  const before = (await heard(page)).length;
  const input = page.getByTestId("pick-scan-input");
  await input.fill(code);
  await input.press("Enter");
  await expect.poll(async () => (await heard(page)).length).toBe(before + 1);
  return (await heard(page))[before]!;
}

const scanLine = (page: Page) => page.locator("[data-testid^='pick-scan-line-']");

// Scan every unit of a one-line pick with the given codes: each a good tone, no problem said, the line counting up.
async function scanCounts(page: Page, line: Locator, codes: string[]): Promise<Tone[]> {
  const tones: Tone[] = [];
  for (const [n, code] of codes.entries()) {
    tones.push(await scanAndHear(page, code));
    await expect(page.getByTestId("pick-scan-problem")).toHaveCount(0);
    await expect(line).toContainText(`${n + 1} / ${QTY}`);
  }
  for (const tone of tones) expect(tone).toEqual(tones[0]);
  await expect(line).toHaveAttribute("data-exact", "true");
  await expect(page.getByTestId("pick-scan-complete")).toBeVisible();
  return tones;
}

// The pick page's Set Picked, and the server's answer (the order's move, or the parcel's).
async function setPicked(page: Page, rpc: string) {
  const button = page.getByTestId("pick-order-set-picked");
  await expect(button).toBeEnabled();
  const [answer] = await Promise.all([page.waitForResponse((res) => res.url().endsWith(rpc)), button.click()]);
  expect(answer.status()).toBe(200);
}

const orderStatus = async (page: Page, orderId: string) =>
  String((await api(page, "selling.v1.OrderService/OrderDetail", { teamId: ground.warehouse, orderId })).order?.status ?? "");

// A list's search box typed, and the list's server read that carries the term — the answer the rows are drawn from.
async function search(page: Page, input: string, rpc: string, term: string) {
  const answered = page.waitForResponse(
    (res) => res.url().endsWith(rpc) && (res.request().postData() ?? "").includes(`"q":${JSON.stringify(term)}`),
  );
  await page.getByTestId(input).fill(term);
  await expect(page.getByTestId(input)).toHaveValue(term);
  expect((await answered).status()).toBe(200);
}

// The seller's wide list's product rows (⚠ `product-row-tags-…` sits under the `product-row-` prefix too).
const sellerRows = (page: Page) => page.getByTestId("products-table").locator('tbody tr[data-testid^="product-row-"]');
// The warehouse's wide list's rows.
const stockRows = (page: Page) => page.getByTestId("inventory-table").locator('tbody tr[data-testid^="stock-row-"]');

test.describe("a product's former codes still find it", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.seller = await team(`E2E Former Seller ${SUFFIX}`, T_OLD, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Former WH ${SUFFIX}`, W_CODE, "TEAM_TYPE_WAREHOUSE");
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 10, minFee: 0 });
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
    });

    const person = async (teamId: string, username: string, role: string) =>
      String(
        (await api(page, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name: `${username} ${role}`, role })).user
          .id,
      );
    const sellerOwner = await person(ground.seller, T_OWNER, "ROLE_SELLING_OWNER");
    await person(ground.warehouse, W_OWNER, "ROLE_WAREHOUSE_OWNER");
    await person(ground.warehouse, W_ADMIN, "ROLE_WAREHOUSE_ADMIN");
    await person(ground.warehouse, W_STAFF, "ROLE_WAREHOUSE_STAFF");

    ground.rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `fc-${SUFFIX}`, name: "E2E former codes" })).rack
        .id,
    );
    const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Former Cat ${SUFFIX}` })).category.id;
    const product = async (part: string, name: string) => {
      const made = await api(page, "product.v1.ProductService/ProductCreate", { teamId: ground.seller, productCodePart: part, name, categoryId: category });
      return made.product as { id: string; productCode: string };
    };
    const p = await product(P_PART, P_NAME);
    const q = await product(Q_PART, Q_NAME);
    expect(p.productCode).toBe(OLD_P);
    expect(q.productCode).toBe(OLD_Q);
    ground.p = String(p.id);
    ground.q = String(q.id);

    // P onto W's rack: one restock, accepted whole onto the rack — W then holds it (Q stays on no shelf).
    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Former BCA ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-FC-${SUFFIX}`,
          openingBalance: 1_000_000,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: ground.seller,
      accountId: account,
      operational: true,
    });
    const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
      financeAccountId: account,
      items: [{ productId: ground.p, productCode: OLD_P, name: P_NAME, count: STOCK, total: STOCK * 10_000 }],
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouse,
      requestId: restock.request.id,
      lines: [{ itemId: restock.request.items[0].id, receivedCount: STOCK, placements: [{ placementId: ground.rack, quantity: STOCK }] }],
    });

    // The seller's shop (its owner on it) and a courier for the samples.
    const shop = String(
      (
        await api(page, "selling.v1.ShopService/ShopCreate", {
          teamId: ground.seller,
          name: `E2E Former Shop ${SUFFIX}`,
          shopCode: `FCS${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: shop, userId: sellerOwner });
    const channels = await api(page, "shipment.v1.ShipmentChannelService/ShipmentChannelList", {
      dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"],
      page: { page: 1, limit: 100 },
    });
    const map = (channels.items as { channel?: { mapData: Record<string, { code: string }> } }[]).find((i) => i.channel)?.channel?.mapData;
    const jne = Object.entries(map ?? {}).find(([, c]) => c.code === "jne")?.[0] ?? "";
    expect(jne, "the seeded jne courier").toBeTruthy();

    // An order of P, placed by root, its line carrying the code P has at that moment (as the order form sends it).
    const place = async (key: string, code: string) =>
      String(
        (
          await api(page, "selling.v1.OrderService/OrderCreate", {
            idempotencyKey: `e2e-fc-${SUFFIX}-${key}`,
            shipmentChannelId: "1",
            teamId: ground.seller,
            shopId: shop,
            warehouseId: ground.warehouse,
            customerName: `E2E Former Buyer ${key}`,
            platformTotal: 100_000,
            platformCreatedAtUnix: Math.floor(Date.now() / 1000),
            orderExternalRefId: `FCO${SUFFIX}${key.toUpperCase()}`,
            items: [{ productId: ground.p, productCode: code, name: P_NAME, quantity: QTY }],
          })
        ).order.id,
      );

    // A sample of P, asked by T's owner (the form is custom_shipments.spec.ts's) — its line takes P's code at create.
    const owner = await pageAs(browser, T_OWNER, PASSWORD, ground.seller);
    const sample = async (key: string) =>
      String(
        (
          await api(owner, "inventory.v1.CustomShipmentService/CustomShipmentCreate", {
            teamId: ground.seller,
            kind: "CUSTOM_SHIPMENT_KIND_SAMPLE",
            warehouseId: ground.warehouse,
            lines: [{ productId: ground.p, quantity: String(QTY) }],
            recipient: { name: `Sari Former ${key} ${SUFFIX}`, phone: "081234500152", address: "Jl. Kopi 152, Bandung" },
            shipmentChannelId: jne,
            payer: "CUSTOM_SHIPMENT_PAYER_WAREHOUSE",
            idempotencyKey: `e2e-fc-${key}-${SUFFIX}`,
          })
        ).customShipment.id,
      );

    // BEFORE the change.
    ground.o1 = await place("o1", OLD_P);
    ground.s1 = await sample("s1");

    // T's selling owner changes the team's code: its products recompose (`<old>-<part>` → `<new>-<part>`).
    ground.codeUpdate = await api(owner, "team.v1.TeamService/TeamCodeUpdate", { teamId: ground.seller, teamCode: T_NEW });
    const after = (await api(page, "product.v1.ProductService/ProductDetail", { teamId: ground.seller, productId: ground.p })).product;
    expect(after.productCode, "P recomposed under the new team code").toBe(NEW_P);

    // AFTER the change.
    ground.o2 = await place("o2", NEW_P);
    ground.s2 = await sample("s2");
    await owner.close();

    const confirmed = await api(page, "selling.v1.OrderService/OrderStatusChange", {
      teamId: ground.warehouse,
      orderIds: [ground.o1, ground.o2],
      to: "ORDER_STATUS_PROCESSED",
    });
    for (const x of confirmed.results as { orderId: string; moved?: boolean; refusedReason?: string }[]) {
      if (!x.moved) throw new Error(`confirm #${x.orderId}: ${x.refusedReason}`);
    }

    await page.close();
  });

  test("regression #152: ProductCodesByIds answers each product's live code and former codes; an id the caller may not see is left out", async ({
    page,
    browser,
  }) => {
    type Codes = { items?: Record<string, { productCode?: string; formerCodes?: string[] }> };

    await test.step("regression: the team code change answered — 2 products recomposed under the new code", async () => {
      expect(ground.codeUpdate.changed, JSON.stringify(ground.codeUpdate)).toBe(true);
      expect(ground.codeUpdate.team?.teamCode).toBe(T_NEW);
      expect(ground.codeUpdate.productsRecomposed).toBe(2);
    });

    await test.step("regression: the selling owner reads both products — the live code, the old one as the only former code", async () => {
      await as(page, T_OWNER, PASSWORD, ground.seller);
      const res = (await api(page, "product.v1.ProductService/ProductCodesByIds", {
        teamId: ground.seller,
        productIds: [ground.p, ground.q],
      })) as Codes;
      expect(res.items?.[ground.p]).toEqual({ productCode: NEW_P, formerCodes: [OLD_P] });
      expect(res.items?.[ground.q]).toEqual({ productCode: NEW_Q, formerCodes: [OLD_Q] });
    });

    await test.step("regression: warehouse:staff reads P (W holds it) — Q, never held by W, is left out, not refused", async () => {
      const staff = await pageAs(browser, W_STAFF, PASSWORD, ground.warehouse);
      const res = (await api(staff, "product.v1.ProductService/ProductCodesByIds", {
        teamId: ground.warehouse,
        productIds: [ground.p, ground.q],
      })) as Codes;
      expect(res.items?.[ground.p]).toEqual({ productCode: NEW_P, formerCodes: [OLD_P] });
      expect(Object.keys(res.items ?? {})).toEqual([ground.p]);
      await staff.close();
    });
  });

  test("regression #152: warehouse:staff picks an order placed BEFORE the team code change with the NEW sticker — trimmed, any case", async ({
    page,
  }) => {
    await installEar(page);
    await as(page, W_STAFF, PASSWORD, ground.warehouse);
    await page.goto(`/warehouse-orders/${ground.o1}`);
    await expect(page.getByTestId("order-status-2")).toBeVisible();
    const line = scanLine(page);

    await test.step("regression: the line keeps the code it was written with, and takes the product's live code too", async () => {
      await expect(line).toHaveCount(1);
      await expect(line).toHaveAttribute("data-code", OLD_P);
      await expect(line).toHaveAttribute("data-scan-codes", holds(NEW_P.toLowerCase()));
      await expect(line).toHaveAttribute("data-scan-codes", holds(OLD_P.toLowerCase()));
      await expect(line).toContainText(`0 / ${QTY}`);
    });

    await test.step("regression: the NEW code scanned (spaces around it, then in lower case) counts every unit", async () => {
      await scanCounts(page, line, [`  ${NEW_P}  `, NEW_P.toLowerCase()]);
    });

    await test.step("regression: Set Picked moves the order to picked", async () => {
      await setPicked(page, "/warehouse.selling.v1.OrderService/OrderStatusChange");
      await expect(page.getByTestId("order-status-5")).toBeVisible();
      expect(await orderStatus(page, ground.o1)).toBe("ORDER_STATUS_PICKED");
    });
  });

  test("regression #152: warehouse:staff picks an order placed AFTER the team code change with an OLD sticker — trimmed, any case; part of the old code is the wrong scan", async ({
    page,
  }) => {
    await installEar(page);
    await as(page, W_STAFF, PASSWORD, ground.warehouse);
    await page.goto(`/warehouse-orders/${ground.o2}`);
    await expect(page.getByTestId("order-status-2")).toBeVisible();
    const line = scanLine(page);

    await test.step("regression: the line carries the live code, and takes the product's former code too", async () => {
      await expect(line).toHaveCount(1);
      await expect(line).toHaveAttribute("data-code", NEW_P);
      await expect(line).toHaveAttribute("data-scan-codes", holds(OLD_P.toLowerCase()));
      await expect(line).toContainText(`0 / ${QTY}`);
    });

    const partial = OLD_P.slice(0, -1);
    const wrong = await test.step("regression: PART of the old code is refused — Not on this order, the wrong sound, nothing counted", async () => {
      const tone = await scanAndHear(page, partial);
      await expect(page.getByTestId("pick-scan-problem")).toContainText(`Not on this order: ${partial}`);
      await expect(line).toContainText(`0 / ${QTY}`);
      await expect(line).not.toHaveAttribute("data-exact", "true");
      await expect(page.getByTestId("pick-order-set-picked")).toBeDisabled();
      return tone;
    });

    await test.step("regression: the OLD code scanned (lower case with spaces, then as printed) counts every unit", async () => {
      const [good] = await scanCounts(page, line, [`  ${OLD_P.toLowerCase()} `, OLD_P]);
      // The partial scan's tone was the wrong one: lower and longer than the good scan's.
      expect(wrong.hz, "the wrong sound is lower than the good one").toBeLessThan(good!.hz);
      expect(wrong.seconds, "the wrong sound is longer than the good one").toBeGreaterThan(good!.seconds);
    });

    await test.step("regression: Set Picked moves the order to picked", async () => {
      await setPicked(page, "/warehouse.selling.v1.OrderService/OrderStatusChange");
      await expect(page.getByTestId("order-status-5")).toBeVisible();
      expect(await orderStatus(page, ground.o2)).toBe("ORDER_STATUS_PICKED");
    });
  });

  test("regression #152: warehouse:owner picks a sample asked AFTER the team code change with an OLD sticker, and one asked BEFORE with the NEW sticker", async ({
    page,
  }) => {
    await installEar(page);
    await as(page, W_OWNER, PASSWORD, ground.warehouse);

    const pickSample = async (id: string, lineCode: string, takes: string, scans: string[]) => {
      await page.goto(`/inventories/custom-shipments/${id}`);
      await expect(page.getByTestId("custom-shipment-pick-page")).toBeVisible();
      const line = scanLine(page);
      await expect(line).toHaveCount(1);
      await expect(line).toHaveAttribute("data-code", lineCode);
      await expect(line).toHaveAttribute("data-scan-codes", holds(takes.toLowerCase()));
      await scanCounts(page, line, scans);
      await setPicked(page, "/warehouse.inventory.v1.CustomShipmentService/CustomShipmentPicked");
      await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-picked")).toBeVisible();
      await expect(page.getByTestId("pick-scan-input")).toHaveCount(0);
    };

    await test.step("regression: the sample asked after the change (its line on the live code) takes the OLD code — lower case with spaces, then as printed", async () => {
      await pickSample(ground.s2, NEW_P, OLD_P, [` ${OLD_P.toLowerCase()}  `, OLD_P]);
    });

    await test.step("regression: the sample asked before the change (its line keeps the old code) takes the NEW code", async () => {
      await pickSample(ground.s1, OLD_P, NEW_P, [NEW_P.toLowerCase(), `  ${NEW_P}`]);
    });
  });

  test("regression #152: selling:owner's Products search finds the product by its former code typed exactly, any case; part of it finds nothing; the live code and the name still find it", async ({
    page,
  }) => {
    await as(page, T_OWNER, PASSWORD, ground.seller);
    await page.goto("/products");
    await expect(page.getByTestId("products-table")).toBeVisible();
    await expect(sellerRows(page)).toHaveCount(2);

    const finds = async (term: string) => {
      await search(page, "product-search", "/warehouse.product.v1.ProductService/ProductList", term);
      await expect(sellerRows(page)).toHaveCount(1);
      await expect(page.getByTestId(`product-row-${NEW_P}`)).toBeVisible();
    };
    const findsNothing = async (term: string) => {
      await search(page, "product-search", "/warehouse.product.v1.ProductService/ProductList", term);
      await expect(page.getByTestId("products-empty")).toBeVisible();
      await expect(sellerRows(page)).toHaveCount(0);
    };

    await test.step("regression: the former code typed exactly finds the product (on its live code)", async () => {
      await finds(OLD_P);
    });
    await test.step("regression: the former code in lower case finds it too", async () => {
      await finds(OLD_P.toLowerCase());
    });
    await test.step("regression: part of the former code finds nothing — its start, then its end", async () => {
      await findsNothing(OLD_P.slice(0, -1));
      await findsNothing(OLD_P.slice(1).toLowerCase());
    });
    await test.step("regression: the live code still finds it, and part of the live code or of the name as before", async () => {
      await finds(NEW_P);
      await finds(P_PART.toLowerCase());
      await finds(`Former Kopi ${SUFFIX}`);
    });
  });

  test("regression #152: warehouse:admin's Products search finds the held product by its former code typed exactly, any case; part of it finds nothing; the live code and the name still find it", async ({
    page,
  }) => {
    await as(page, W_ADMIN, PASSWORD, ground.warehouse);
    await page.goto("/products");
    await expect(page.getByTestId("inventory-table")).toBeVisible();
    await expect(stockRows(page)).toHaveCount(1);
    await expect(page.getByTestId(`stock-row-${NEW_P}`)).toBeVisible();

    const finds = async (term: string) => {
      await search(page, "inventory-search", "/warehouse.inventory.v1.InventoryService/WarehouseStockList", term);
      await expect(stockRows(page)).toHaveCount(1);
      await expect(page.getByTestId(`stock-row-${NEW_P}`)).toBeVisible();
    };
    const findsNothing = async (term: string) => {
      await search(page, "inventory-search", "/warehouse.inventory.v1.InventoryService/WarehouseStockList", term);
      await expect(page.getByTestId("inventory-none-match")).toBeVisible();
      await expect(stockRows(page)).toHaveCount(0);
    };

    // A term both lists answer: findsNothing first, so the next `finds` waits on a fresh answer, never on stale rows.
    await test.step("regression: part of the former code finds nothing — its start, then its end", async () => {
      await findsNothing(OLD_P.slice(0, -1));
      await findsNothing(OLD_P.slice(1).toLowerCase());
    });
    await test.step("regression: the former code typed exactly finds the product (on its live code)", async () => {
      await finds(OLD_P);
    });
    await test.step("regression: the former code in lower case finds it too", async () => {
      await finds(OLD_P.toLowerCase());
    });
    await test.step("regression: the live code still finds it, and part of the live code or of the name as before", async () => {
      await finds(NEW_P);
      await finds(P_PART.toLowerCase());
      await finds(`Former Kopi ${SUFFIX}`);
    });
  });
});

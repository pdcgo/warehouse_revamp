import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";
import { expectMoveCounted, expectMovesOffered } from "./order_moves_metric";

// ── warehouse:all wants to validate an order's package — validate package order's givens of
//    docs/acceptances/inventory/order.md (the when was "pick order" when this file was first written) ──────────────
//
// validate package order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the
// checks for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows'
// statuses are the owner's, set by hand — never by this file.
//
// Business rules:
// - docs/business/inventory/order.md, How Warehouse Process The Order › Order Picked Process — the crew takes the goods
//   from their placement, opens the order's page ("usually for fast, staff scan `receipt_file`"), scans the label on
//   each item taken, makes sure all are picked, and changes the status.
// - docs/business/order/context_decision.md — processed → picked is the WAREHOUSE's move, written to the order's timeline
//   with who made it; picked → shipping (the handover) follows it.
// - scan-label-opens-the-pick-page / a-label-scan-reads-the-ref-or-the-receipt — a scanned tracking number opens its one
//   order's pick page; the-pick-page-opens-first-by-the-label — the racks first, EVERY rack the take drew from with its
//   own quantity (#135/#151); the-item-scans-live-on-the-page — a scan counts its line up to the ordered quantity, an item
//   not on the order or one too many is refused with the wrong sound, Set Picked is on only once every line is exact;
//   two people on one order each count on their own page, and the second Set Picked changes nothing.
// - two-orders-on-one-label-are-shown-not-chosen (docs/business/inventory/order_decision.md) — a label code matching
//   several live orders shows them all and opens none; a `cancel` order is skipped, so a label whose only order is
//   cancelled finds nothing to open: the wrong sound and a sentence.
// - the-label-qr-is-the-product-code (docs/technical/frontend/restock_decision.md) — a restock sticker's QR is the product
//   code alone, so a scan of the sticker is the product wherever the product is asked for.
//
// Run as EVERY warehouse role (warehouse:owner, warehouse:admin, warehouse:staff), each in its own browser session.
//
// The ground (beforeAll, root): one warehouse with two racks (A, B); one seller (return warehouse = that warehouse) with
// a shop; product ONE restocked onto rack A only; per role a product TWO restocked 1 onto rack A and 2 onto rack B (its
// whole stock, so the order's take draws from both); per role a product THREE, sent under its REAL product code (as the
// app sends it), restocked 2 onto rack A by a restock of its own whose stickers are printed. Per role, orders placed by
// root and confirmed by root, so each stands processed: (1) ONE ×2 with a tracking number on its label, (2) TWO ×3,
// (3)–(5) ONE ×2, two ONE ×2 that carry the SAME tracking number, THREE ×2, ONE ×2 with a tracking number (the parcel
// before the cancelled one), and ONE ×2 that another person sets picked; plus one ONE ×2 with a tracking number placed
// and then cancelled by root as the seller (never confirmed). The metric check has a shop of its own with two orders.
// A selling:owner of the seller reads the selling team's side.
//
// The WHEN — the role validates the order's package:
//   (… opened by receipt scan …) / (… receipt scan) / (… receipt of cancelled order scanned) — Orders › Scan Label,
//                                  the label's tracking number scanned.
//   every other given            — the order's pick page opened directly (/warehouse-orders/<id>).
//
// How each then is read:
// - `pick page opens from receipt scan` — the scan answers with the order's own pick page (its URL, its line).
// - `pick page shows 1 rack for 1 product` / `… 2 racks with quantity of each` — the pick list's line for the product
//   names exactly the racks the take drew from, each with its own quantity (×n).
// - `every scanned item correct` — each scan is taken (the scanner's good sound, no problem said), the line reads n / n
//   and the page says all items are scanned. (restock sticker scanned) — what is scanned is what each unit's sticker
//   says: Cetak Label for the restock that brought the units in prints one sticker per unit, and each sticker's QR is
//   read without a decoder — the shape the sticker's own QR component draws for the product code, at every level and
//   margin (the_labels_read_in_one_call.spec.ts's way) — so the text scanned is the text the QR carries.
// - `status changed from processed to picked` — after Set Picked the page reads Picked, the order's own record says
//   ORDER_STATUS_PICKED, and on Orders it has left Confirmed and stands on Picked.
// - `pick recorded in order timeline` — the warehouse's order detail › Timeline: ONE Picked step, by the role's user.
// - `selling team sees order picked` — the seller (selling:owner) opens the order: its stepper stands on picked and its
//   timeline shows the Picked step.
// - `order can be handed over` — the page's next step is Mark Handed Over, and pressing it moves the order to shipping.
// - `scan refused with wrong sound` — the scanner's WRONG sound (the browser's oscillator, recorded: lower and longer
//   than the good one — lib/beep.ts, "two tones that cannot be mistaken"), the page says why, the line does not count it.
// - `cannot set picked` — Set Picked stays off; pressed anyway, no status change is sent and the order stays processed.
//   Read for (item not on order scanned) as the crew's slip it is: one unit of the order's product scanned and the other
//   product scanned in place of the second — the wrong item does not make up the order.
// - `item count stays at ordered quantity` — after one scan too many the line still reads 2 / 2.
// - (not every item scanned) — one of the two units scanned.
// - `both orders shown` — Scan Label lists the two orders, each by its number, under the "several orders" warning.
// - `no pick page opened` — a beat later the page is still Orders with Scan Label open, no pick page and no item scan
//   anywhere, and the orders are where they were.
// - `scan marked with wrong sound` — the cancelled order's label: the scan's answer is marked as an error (the order is
//   cancelled, or no order is found — both say nothing opens), no order is offered to open, and the tone is the wrong
//   one, told apart from the good tone the same dialog made for the parcel scanned just before it (a live order's label,
//   which opened its pick page).
// - `set picked refused` — the role's page counted every unit while the order was processed; another person of the
//   warehouse (the next role's user) sets it picked first; the role's Set Picked is answered "not moved, already picked",
//   the order stays picked, and its timeline still has ONE Picked step — the other person's.
// - `message says already picked` — the page says so: its toast reads "already picked".
// - `pick recorded in analytic metric` — Analytic › Order › Order status moves (`metrics/orders/moves`, #84) counts a
//   pick as a Picked, processed → picked (the-order-metric-ids-name-what-moved). Its own test, last in the file, on a
//   shop of its own with TWO processed orders of which the test validates ONE (opened by its label), read as
//   warehouse:owner (a warehouse reads every count of the orders it ships): Add Metric › Order offers Order status moves,
//   and Analytic by shop over the last 7 days, filtered to that shop, reads `created_count` 2 (the fold landed) and
//   `picked_count` exactly 1 — the untouched order, still processed, adds nothing (order_moves_metric.ts).
test.describe("warehouse:all wants to validate an order's package", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;

  const COND_SCAN = "status: processed · 1 product · 1 rack · opened by receipt scan · all items scanned";
  const COND_TWO_RACKS = "status: processed · 1 product · 2 racks · all items scanned";
  const COND_NOT_ON_ORDER = "status: processed · item not on order scanned";
  const COND_TOO_MANY = "status: processed · more items than ordered scanned";
  const COND_NOT_EVERY = "status: processed · not every item scanned";
  const COND_STICKER = "status: processed · 1 product · restock sticker scanned";
  const COND_TWIN = "status: processed · 1 receipt on 2 orders · receipt scan";
  const COND_CANCELLED = "status: cancel · receipt of cancelled order scanned";
  const COND_ALREADY = "status: picked · set picked by another person";

  // Order kinds, per role, in placing order — each stands processed once root confirms them.
  const KINDS = ["scan", "twoRacks", "notOnOrder", "tooMany", "notEvery", "twinA", "twinB", "sticker", "before", "already"] as const;
  type Kind = (typeof KINDS)[number];
  // The kinds that take product ONE (twoRacks takes TWO, sticker THREE).
  const ONE_KINDS = KINDS.filter((k) => k !== "twoRacks" && k !== "sticker");

  const QTY = 2; // product ONE and THREE, per order
  const ON_A = 1; // product TWO: rack A
  const ON_B = 2; // product TWO: rack B
  // Every ONE order of every role, the cancelled one, the metric shop's two — and a few spare.
  const ONE_STOCK = ROLES.length * (ONE_KINDS.length + 1) * QTY + 2 * QTY + 4;
  const UNIT_COST = 10_000;
  const PLATFORM_TOTAL = 100_000;

  const username = (key: string) => `e2eopk${key}${SUFFIX}`;
  const SELLER_OWNER = username("sel");
  // Team codes are at most 10 characters. SUFFIX is ONE per worker, shared by every spec file the worker runs, so each
  // code's prefix must be this file's alone (PS/PW collided with restock_warehouse_wants_to_accept): the Z… ones are.
  const SELLER_CODE = `ZPS${SUFFIX}`;
  const WH_CODE = `ZPW${SUFFIX}`;
  const SKU_ONE = `ZKA${SUFFIX}`;
  const skuTwo = (key: string) => `ZKB${SUFFIX}${key.toUpperCase()}`;
  const partThree = (key: string) => `ZKC${SUFFIX}${key.toUpperCase()}`;
  const receiptOf = (key: string) => `ZRS${SUFFIX}${key.toUpperCase()}`;
  const twinReceipt = (key: string) => `ZRT${SUFFIX}${key.toUpperCase()}`;
  const beforeReceipt = (key: string) => `ZRR${SUFFIX}${key.toUpperCase()}`;
  const cancelledReceipt = (key: string) => `ZRC${SUFFIX}${key.toUpperCase()}`;
  const METRIC_RECEIPT = `ZRM${SUFFIX}`;
  const RACK_A = `zpa-${SUFFIX}`;
  const RACK_B = `zpb-${SUFFIX}`;

  const ground = {
    seller: "",
    warehouse: "",
    rackA: "",
    rackB: "",
    one: "",
    two: {} as Record<string, string>,
    three: {} as Record<string, string>,
    // THREE's real product code (`<team code>-<part>`), as the server made it — what its stickers and its order carry.
    threeCode: {} as Record<string, string>,
    stickerRestock: "",
    orders: {} as Record<string, Record<Kind, string>>,
    cancelled: {} as Record<string, string>,
    // The metric check's shop and its two orders: [the one validated, the one left processed].
    metricShop: "",
    metricOrders: [] as string[],
  };

  // The order's own record, read with the page's signed-in token — its status, as the server keeps it.
  async function statusOf(page: Page, team: string, orderId: string): Promise<string> {
    const res = await api(page, "selling.v1.OrderService/OrderDetail", { teamId: team, orderId });
    return String(res.order?.status ?? "");
  }

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // THE SCANNER'S EAR. lib/beep.ts makes its two sounds with the browser's AudioContext (an oscillator, no audio file);
  // headless has no speaker, so the page gets a stand-in that hears each tone — its pitch and how long it plays — and
  // makes no sound. Installed before the app loads, so the app's lazy context is this one. A full page load starts a
  // new ear; the app's own (client-side) navigation keeps it.
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
  // One scan into a scan field (the pick page's item scan, or Scan Label's), and the ONE tone it made.
  async function scanAndHear(page: Page, code: string, field = "pick-scan-input"): Promise<Tone> {
    const before = (await heard(page)).length;
    const input = page.getByTestId(field);
    await input.fill(code);
    await input.press("Enter");
    await expect.poll(async () => (await heard(page)).length).toBe(before + 1);
    return (await heard(page))[before]!;
  }
  // The wrong sound: the low, longer buzz — told apart from the good scan's tone the same page made.
  function expectWrongSound(tone: Tone, good: Tone) {
    expect.soft(tone.hz, "the wrong sound is lower than the good one").toBeLessThan(good.hz);
    expect.soft(tone.seconds, "the wrong sound is longer than the good one").toBeGreaterThan(good.seconds);
  }

  // WHAT A QR SAYS, read without a decoder: the shape (viewBox + paths) the sticker's own QR component draws for a text,
  // at every error-correction level and quiet zone it could be set up with — so the check pins the CONTENT, not how the
  // sticker happens to draw it (the_labels_read_in_one_call.spec.ts's way).
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
    const viewBox = /viewBox="([^"]*)"/.exec(svg)?.[1] ?? "";
    const paths = [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
    return `${viewBox}|${paths.join("|")}`;
  }

  // Watch the page for a status change being sent.
  function countMoves(page: Page) {
    const sent = { n: 0 };
    page.on("request", (req) => {
      if (req.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")) sent.n += 1;
    });
    return sent;
  }

  const scanLine = (page: Page) => page.locator("[data-testid^='pick-scan-line-']");

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

    ground.seller = await team(`E2E Opk Seller ${SUFFIX}`, SELLER_CODE, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Opk Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");
    const rack = async (code: string, name: string) =>
      String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code, name })).rack.id);
    ground.rackA = await rack(RACK_A, "E2E opk shelf A");
    ground.rackB = await rack(RACK_B, "E2E opk shelf B");
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 10, minFee: 0 });
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
    });

    // A user per warehouse role, and the seller's owner who reads the selling team's side.
    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.warehouse,
        username: username(r.key),
        password: PASSWORD,
        name: `Opk ${r.given} ${SUFFIX}`,
        role: r.role,
      });
    }
    const sellerOwner = String(
      (
        await api(page, "user.v1.UserService/CreateUser", {
          teamId: ground.seller,
          username: SELLER_OWNER,
          password: PASSWORD,
          name: `Opk selling:owner ${SUFFIX}`,
          role: "ROLE_SELLING_OWNER",
        })
      ).user.id,
    );

    // The seller's products: ONE (rack A only), a TWO per role (1 on rack A, 2 on rack B — its whole stock), and a THREE
    // per role (the sticker's product).
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Opk Cat ${SUFFIX}` });
    const product = async (sku: string) =>
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.seller,
          productCodePart: sku,
          name: `E2E ${sku}`,
          categoryId: category.category.id,
        })
      ).product as { id: string; productCode: string };
    ground.one = String((await product(SKU_ONE)).id);
    for (const r of ROLES) ground.two[r.key] = String((await product(skuTwo(r.key))).id);
    for (const r of ROLES) {
      const made = await product(partThree(r.key));
      ground.three[r.key] = String(made.id);
      ground.threeCode[r.key] = made.productCode;
      expect(made.productCode, "THREE's real code carries the team's part").toContain(partThree(r.key));
    }

    const supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.seller, name: `E2E Opk Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Opk BCA ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `89${SUFFIX}01`,
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

    type Line = { productId: string; sku: string; count: number; placements: { placementId: string; quantity: number }[] };
    const restock = async (lines: Line[]) => {
      const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: ground.seller,
        warehouseId: ground.warehouse,
        financeAccountId: account,
        items: lines.map((l) => ({
          productId: l.productId,
          productCode: l.sku,
          name: `E2E ${l.sku}`,
          count: l.count,
          total: UNIT_COST * l.count,
          supplierId: supplier,
        })),
      });
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: raised.request.id,
        lines: (raised.request.items as { id: string; productId: string }[]).map((item) => {
          const line = lines.find((l) => l.productId === String(item.productId))!;
          return { itemId: item.id, receivedCount: line.count, placements: line.placements };
        }),
      });
      return String(raised.request.id);
    };
    await restock([
      { productId: ground.one, sku: SKU_ONE, count: ONE_STOCK, placements: [{ placementId: ground.rackA, quantity: ONE_STOCK }] },
      ...ROLES.map((r) => ({
        productId: ground.two[r.key]!,
        sku: skuTwo(r.key),
        count: ON_A + ON_B,
        placements: [
          { placementId: ground.rackA, quantity: ON_A },
          { placementId: ground.rackB, quantity: ON_B },
        ],
      })),
    ]);
    // THREE comes in by a restock of its own, so its Cetak Label prints only THREE's stickers: one per unit.
    ground.stickerRestock = await restock(
      ROLES.map((r) => ({
        productId: ground.three[r.key]!,
        sku: ground.threeCode[r.key]!,
        count: QTY,
        placements: [{ placementId: ground.rackA, quantity: QTY }],
      })),
    );

    // The seller's shops, its owner on them: the orders' shop, and the metric check's own (so no other test's pick
    // counts on it).
    const shopOf = async (name: string, shopCode: string) => {
      const id = String(
        (await api(page, "selling.v1.ShopService/ShopCreate", { teamId: ground.seller, name, shopCode, marketplace: "MARKETPLACE_SHOPEE" }))
          .shop.id,
      );
      await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: id, userId: sellerOwner });
      return id;
    };
    const shop = await shopOf(`E2E Opk Shop ${SUFFIX}`, `ZPK${SUFFIX}`);
    ground.metricShop = await shopOf(`E2E Opk Metric Shop ${SUFFIX}`, `ZPM${SUFFIX}`);

    const place = async (o: { key: string; shopId: string; productId: string; code: string; quantity: number; receipt?: string }) =>
      String(
        (
          await api(page, "selling.v1.OrderService/OrderCreate", {
            idempotencyKey: `e2e-opk-${SUFFIX}-${o.key}`,
            shipmentChannelId: "1",
            teamId: ground.seller,
            shopId: o.shopId,
            warehouseId: ground.warehouse,
            customerName: `E2E Opk Buyer ${o.key}`,
            platformTotal: PLATFORM_TOTAL,
            platformCreatedAtUnix: Math.floor(Date.now() / 1000),
            orderExternalRefId: `ZOP${SUFFIX}${o.key.toUpperCase()}`,
            ...(o.receipt ? { receiptCode: o.receipt } : {}),
            items: [{ productId: o.productId, productCode: o.code, name: `E2E ${o.code}`, quantity: o.quantity }],
          })
        ).order.id,
      );

    // GIVEN — per role, the orders placed by root, then confirmed by root: each stands processed.
    const placed: string[] = [];
    for (const r of ROLES) {
      ground.orders[r.key] = {} as Record<Kind, string>;
      for (const kind of KINDS) {
        const receipt =
          kind === "scan"
            ? receiptOf(r.key)
            : kind === "twinA" || kind === "twinB"
              ? twinReceipt(r.key)
              : kind === "before"
                ? beforeReceipt(r.key)
                : undefined;
        const id = await place({
          key: `${r.key}${kind}`,
          shopId: shop,
          ...(kind === "twoRacks"
            ? { productId: ground.two[r.key]!, code: skuTwo(r.key), quantity: ON_A + ON_B }
            : kind === "sticker"
              ? { productId: ground.three[r.key]!, code: ground.threeCode[r.key]!, quantity: QTY }
              : { productId: ground.one, code: SKU_ONE, quantity: QTY }),
          receipt,
        });
        ground.orders[r.key]![kind] = id;
        placed.push(id);
      }
      // (status: cancel …) — placed with its label, then cancelled by the seller's side; never confirmed.
      const dead = await place({
        key: `${r.key}cancelled`,
        shopId: shop,
        productId: ground.one,
        code: SKU_ONE,
        quantity: QTY,
        receipt: cancelledReceipt(r.key),
      });
      await api(page, "selling.v1.OrderService/OrderCancel", { teamId: ground.seller, orderId: dead });
      ground.cancelled[r.key] = dead;
    }
    for (const n of [1, 2]) {
      const id = await place({
        key: `metric${n}`,
        shopId: ground.metricShop,
        productId: ground.one,
        code: SKU_ONE,
        quantity: QTY,
        ...(n === 1 ? { receipt: METRIC_RECEIPT } : {}),
      });
      ground.metricOrders.push(id);
      placed.push(id);
    }
    const confirmed = await api(page, "selling.v1.OrderService/OrderStatusChange", {
      teamId: ground.warehouse,
      orderIds: placed,
      to: "ORDER_STATUS_PROCESSED",
    });
    for (const x of confirmed.results as { orderId: string; moved?: boolean; refusedReason?: string }[]) {
      if (!x.moved) throw new Error(`confirm #${x.orderId}: ${x.refusedReason}`);
    }

    await page.close();
  });

  // On Orders: the order has left Confirmed and stands on Picked.
  async function expectOnPickedTab(page: Page, orderId: string) {
    await page.goto("/warehouse-orders");
    await expect(page.getByTestId("pick-queue-table")).toBeVisible();
    await page.getByTestId("pick-tab-confirm").click();
    await expect(page.getByTestId("pick-tab-confirm")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pick-queue-table")).toBeVisible();
    await expect.soft(page.getByTestId(`pick-queue-row-${orderId}`)).toHaveCount(0);
    await page.getByTestId("pick-tab-picked").click();
    await expect(page.getByTestId("pick-tab-picked")).toHaveAttribute("aria-selected", "true");
    await expect.soft(page.getByTestId(`pick-queue-row-${orderId}`)).toBeVisible();
  }

  // The order's pick page, opened directly, its item scan waiting.
  async function openPickPage(page: Page, orderId: string) {
    await page.goto(`/warehouse-orders/${orderId}`);
    await expect(page.getByTestId("order-status-2")).toBeVisible();
    await expect(page.getByTestId("pick-scan-input")).toBeVisible();
  }

  // Orders › Scan Label, open and waiting for a label.
  async function openScanLabel(page: Page) {
    await page.getByTestId("warehouse-orders-scan-label").click();
    await expect(page.getByTestId("scan-label-input")).toBeVisible();
  }

  // Set Picked, and the server's answer to it.
  async function setPicked(page: Page) {
    const button = page.getByTestId("pick-order-set-picked");
    await expect(button).toBeEnabled();
    const [answer] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
      button.click(),
    ]);
    return answer;
  }

  // Set Picked is off; pressed anyway, nothing is sent and the order stays processed.
  async function expectCannotSetPicked(page: Page, orderId: string, sent: { n: number }) {
    const button = page.getByTestId("pick-order-set-picked");
    await expect.soft(button).toBeDisabled();
    await expect.soft(page.getByTestId("pick-scan-complete")).toHaveCount(0);
    const before = sent.n;
    await button.click({ force: true });
    await page.waitForTimeout(500);
    expect.soft(sent.n, "no status change sent").toBe(before);
    await expect.soft(page.getByTestId("order-status-2")).toBeVisible();
    expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PROCESSED");
  }

  // No pick page opened: a beat later the page is still Orders, Scan Label still open, no item scan anywhere.
  async function expectNoPickPage(page: Page) {
    await page.waitForTimeout(800);
    await expect.soft(page).toHaveURL(/\/warehouse-orders$/);
    await expect.soft(page.getByTestId("scan-label-dialog")).toBeVisible();
    await expect.soft(page.getByTestId("pick-scan-input")).toHaveCount(0);
    await expect.soft(page.getByTestId("pick-list-table")).toHaveCount(0);
  }

  // The rack cells of one product's pick-list line.
  const shelvesOf = (page: Page, productId: string) =>
    page.getByTestId(`pick-line-${productId}`).locator(`[data-testid^='pick-shelf-${productId}-']`);

  for (const r of ROLES) {
    test(`${r.given} validate package order (${COND_SCAN})`, async ({ page, browser }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.scan;
      expect(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PROCESSED");

      // WHEN — Orders › Scan Label, the parcel's tracking number scanned.
      await page.goto("/warehouse-orders");
      await openScanLabel(page);
      const label = page.getByTestId("scan-label-input");
      await label.fill(receiptOf(r.key));
      await label.press("Enter");

      await test.step("then: pick page opens from receipt scan", async () => {
        await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}$`));
        await expect.soft(page.getByTestId("pick-list-table")).toContainText(SKU_ONE);
        await expect.soft(page.getByTestId("order-status-2")).toBeVisible();
        await expect(page.getByTestId("pick-scan-input")).toBeVisible();
      });

      await test.step("then: pick page shows 1 rack for 1 product", async () => {
        await expect.soft(shelvesOf(page, ground.one)).toHaveCount(1);
        const shelf = page.getByTestId(`pick-shelf-${ground.one}-${ground.rackA}`);
        await expect.soft(shelf).toContainText(RACK_A);
        await expect.soft(shelf).toContainText(`×${QTY}`);
      });

      await test.step("then: every scanned item correct", async () => {
        const line = scanLine(page);
        await expect(line).toHaveCount(1);
        await expect.soft(line).toHaveAttribute("data-code", SKU_ONE);
        await expect.soft(line).toHaveAttribute("data-quantity", String(QTY));
        const tones: Tone[] = [];
        for (let n = 0; n < QTY; n += 1) {
          tones.push(await scanAndHear(page, SKU_ONE));
          await expect.soft(page.getByTestId("pick-scan-problem")).toHaveCount(0);
          await expect.soft(line).toContainText(`${n + 1} / ${QTY}`);
        }
        // Every scan the same good tone.
        for (const tone of tones) expect.soft(tone).toEqual(tones[0]);
        await expect(line).toHaveAttribute("data-exact", "true");
        await expect.soft(page.getByTestId("pick-scan-complete")).toBeVisible();
      });

      await test.step("then: status changed from processed to picked", async () => {
        const answer = await setPicked(page);
        expect.soft(answer.status()).toBe(200);
        await expect.soft(page.getByTestId("order-status-5")).toBeVisible();
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PICKED");
        await expectOnPickedTab(page, orderId);
      });

      await test.step("then: pick recorded in order timeline", async () => {
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible();
        await page.getByTestId("order-detail-tab-timeline").click();
        await expect(page.getByTestId("order-detail-timeline")).toBeVisible();
        await expect.soft(page.getByTestId("order-timeline-picked")).toHaveCount(1);
        await expect.soft(page.getByTestId("order-timeline-picked-by")).toContainText(username(r.key));
      });

      await test.step("then: selling team sees order picked", async () => {
        const seller = await browser.newPage();
        await signIn(seller, SELLER_OWNER, ground.seller);
        await seller.goto(`/orders/${orderId}`);
        await expect(seller.getByTestId("order-detail-page")).toBeVisible();
        await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "picked");
        await expect.soft(seller.getByTestId("section-timeline").getByTestId("order-timeline-picked")).toBeVisible();
        await seller.close();
      });

      await test.step("then: order can be handed over", async () => {
        await page.goto(`/warehouse-orders/${orderId}`);
        await expect(page.getByTestId("order-status-5")).toBeVisible();
        const advance = page.getByTestId("pick-order-advance");
        await expect(advance).toContainText("Mark Handed Over");
        const [answer] = await Promise.all([
          page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
          advance.click(),
        ]);
        expect.soft(answer.status()).toBe(200);
        await expect.soft(page.getByTestId("order-status-6")).toBeVisible();
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_SHIPPING");
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} validate package order (${COND_TWO_RACKS})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.twoRacks;
      const productId = ground.two[r.key]!;
      const sku = skuTwo(r.key);

      // WHEN — the order's pick page.
      await openPickPage(page, orderId);

      await test.step("then: pick page shows 2 racks with quantity of each", async () => {
        await expect.soft(shelvesOf(page, productId)).toHaveCount(2);
        const a = page.getByTestId(`pick-shelf-${productId}-${ground.rackA}`);
        const b = page.getByTestId(`pick-shelf-${productId}-${ground.rackB}`);
        await expect.soft(a).toContainText(RACK_A);
        await expect.soft(a).toContainText(`×${ON_A}`);
        await expect.soft(b).toContainText(RACK_B);
        await expect.soft(b).toContainText(`×${ON_B}`);
      });

      await test.step("then: status changed from processed to picked", async () => {
        for (let n = 0; n < ON_A + ON_B; n += 1) await scanAndHear(page, sku);
        await expect(scanLine(page)).toHaveAttribute("data-exact", "true");
        const answer = await setPicked(page);
        expect.soft(answer.status()).toBe(200);
        await expect.soft(page.getByTestId("order-status-5")).toBeVisible();
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PICKED");
        await expectOnPickedTab(page, orderId);
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} validate package order (${COND_NOT_ON_ORDER})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.notOnOrder;
      const sent = countMoves(page);

      // WHEN — on the pick page, one unit of the order's product, then ANOTHER product of the seller in place of the
      // second.
      await openPickPage(page, orderId);
      const line = scanLine(page);
      const good = await scanAndHear(page, SKU_ONE);
      await expect(line).toContainText(`1 / ${QTY}`);
      const wrong = await scanAndHear(page, skuTwo(r.key));

      await test.step("then: scan refused with wrong sound", async () => {
        expectWrongSound(wrong, good);
        await expect.soft(page.getByTestId("pick-scan-problem")).toContainText("Not on this order");
        await expect.soft(line).toContainText(`1 / ${QTY}`);
        await expect.soft(line).not.toHaveAttribute("data-exact", "true");
      });

      await test.step("then: cannot set picked", async () => {
        await expectCannotSetPicked(page, orderId, sent);
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} validate package order (${COND_TOO_MANY})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.tooMany;

      // WHEN — on the pick page, every unit scanned, then one more.
      await openPickPage(page, orderId);
      const line = scanLine(page);
      let good: Tone | undefined;
      for (let n = 0; n < QTY; n += 1) good = await scanAndHear(page, SKU_ONE);
      await expect(line).toHaveAttribute("data-exact", "true");
      const wrong = await scanAndHear(page, SKU_ONE);

      await test.step("then: scan refused with wrong sound", async () => {
        expectWrongSound(wrong, good!);
        await expect.soft(page.getByTestId("pick-scan-problem")).toContainText("more than ordered");
      });

      await test.step("then: item count stays at ordered quantity", async () => {
        await expect.soft(line).toContainText(`${QTY} / ${QTY}`);
        await expect.soft(line).toHaveAttribute("data-exact", "true");
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PROCESSED");
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} validate package order (${COND_NOT_EVERY})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.notEvery;
      const sent = countMoves(page);

      // WHEN — on the pick page, one of the two units scanned.
      await openPickPage(page, orderId);
      await scanAndHear(page, SKU_ONE);
      await expect(scanLine(page)).toContainText(`1 / ${QTY}`);

      await test.step("then: cannot set picked", async () => {
        await expectCannotSetPicked(page, orderId, sent);
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} validate package order (${COND_STICKER})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.sticker;
      const code = ground.threeCode[r.key]!;

      // The stickers on the units: Cetak Label for the restock that brought them in prints one per unit — and what
      // each one's QR says, read by its shape.
      await page.goto(`/inventories/restock/labels?ids=${ground.stickerRestock}`);
      await expect(page.getByTestId("labels-page")).toBeVisible();
      const printed = page.getByTestId("labels-print-root").locator(".print-label");
      await expect(printed).toHaveCount(ROLES.length * QTY);
      const stickers = (
        await printed.evaluateAll((els) =>
          els.map((el) => ({
            sku: el.querySelector('[data-testid="label-sku"]')?.textContent?.trim() ?? "",
            svg: el.querySelector("svg")?.outerHTML ?? "",
          })),
        )
      ).filter((s) => s.sku === code);
      expect(stickers, "one sticker per unit of the order's product").toHaveLength(QTY);
      const says = qrShapes(code);
      const scanned = stickers.map((s, i) => {
        expect(says.has(shapeOf(s.svg)), `sticker ${i + 1}: its QR says ${code}`).toBe(true);
        return code;
      });

      // WHEN — on the order's pick page, each unit's sticker scanned.
      await openPickPage(page, orderId);

      await test.step("then: every scanned item correct", async () => {
        const line = scanLine(page);
        await expect(line).toHaveCount(1);
        await expect.soft(line).toHaveAttribute("data-code", code);
        await expect.soft(line).toHaveAttribute("data-quantity", String(QTY));
        const tones: Tone[] = [];
        for (const [n, text] of scanned.entries()) {
          tones.push(await scanAndHear(page, text));
          await expect.soft(page.getByTestId("pick-scan-problem")).toHaveCount(0);
          await expect.soft(line).toContainText(`${n + 1} / ${QTY}`);
        }
        for (const tone of tones) expect.soft(tone).toEqual(tones[0]);
        await expect(line).toHaveAttribute("data-exact", "true");
        await expect.soft(page.getByTestId("pick-scan-complete")).toBeVisible();
        await expect.soft(page.getByTestId("pick-order-set-picked")).toBeEnabled();
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} validate package order (${COND_TWIN})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const twins = [ground.orders[r.key]!.twinA, ground.orders[r.key]!.twinB];

      // WHEN — Orders › Scan Label, the label both orders carry.
      await page.goto("/warehouse-orders");
      await openScanLabel(page);
      const label = page.getByTestId("scan-label-input");
      await label.fill(twinReceipt(r.key));
      await label.press("Enter");

      await test.step("then: both orders shown", async () => {
        const result = page.getByTestId("scan-label-result");
        await expect(result).toHaveAttribute("data-state", "several");
        await expect.soft(page.getByTestId("scan-label-several")).toBeVisible();
        await expect.soft(page.locator("[data-testid^='scan-label-match-']")).toHaveCount(2);
        for (const id of twins) {
          await expect.soft(page.getByTestId(`scan-label-match-${id}`)).toBeVisible();
          await expect.soft(page.getByTestId(`scan-label-match-${id}`)).toContainText(`#${id}`);
        }
      });

      await test.step("then: no pick page opened", async () => {
        await expectNoPickPage(page);
        for (const id of twins) expect.soft(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_PROCESSED");
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} validate package order (${COND_CANCELLED})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const cancelled = ground.cancelled[r.key]!;
      const before = ground.orders[r.key]!.before;
      expect(await statusOf(page, ground.warehouse, cancelled)).toBe("ORDER_STATUS_CANCEL");

      // The parcel before it: a live order's label, scanned — the good tone, and its pick page opens. Back to Orders by
      // the page's own Back, so the ear keeps listening.
      await page.goto("/warehouse-orders");
      await openScanLabel(page);
      const good = await scanAndHear(page, beforeReceipt(r.key), "scan-label-input");
      await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${before}$`));
      await page.getByTestId("pick-order-back").click();
      await expect(page).toHaveURL(/\/warehouse-orders$/);

      // WHEN — Scan Label, the cancelled order's label scanned.
      await openScanLabel(page);
      const tone = await scanAndHear(page, cancelledReceipt(r.key), "scan-label-input");

      await test.step("then: scan marked with wrong sound", async () => {
        expectWrongSound(tone, good);
        const result = page.getByTestId("scan-label-result");
        await expect.soft(result).toHaveAttribute("data-state", /^(cancelled|none)$/);
        await expect.soft(result).toContainText(cancelledReceipt(r.key));
        await expect.soft(page.locator("[data-testid^='scan-label-open-']")).toHaveCount(0);
      });

      await test.step("then: no pick page opened", async () => {
        await expectNoPickPage(page);
        expect.soft(await statusOf(page, ground.warehouse, cancelled)).toBe("ORDER_STATUS_CANCEL");
      });
    });
  }

  for (const [i, r] of ROLES.entries()) {
    test(`${r.given} validate package order (${COND_ALREADY})`, async ({ page, browser }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.already;
      const other = ROLES[(i + 1) % ROLES.length]!;

      // GIVEN — the role's page has every unit counted while the order is still processed …
      await openPickPage(page, orderId);
      for (let n = 0; n < QTY; n += 1) await scanAndHear(page, SKU_ONE);
      await expect(scanLine(page)).toHaveAttribute("data-exact", "true");
      // … and another person of the warehouse (the next role's user, on a page of their own) sets it picked first.
      const otherPage = await browser.newPage();
      await signIn(otherPage, username(other.key), ground.warehouse);
      const first = await api(otherPage, "selling.v1.OrderService/OrderStatusChange", {
        teamId: ground.warehouse,
        orderIds: [orderId],
        to: "ORDER_STATUS_PICKED",
      });
      expect((first.results as { moved?: boolean }[])[0]?.moved, "the other person's Set Picked moved it").toBe(true);
      expect(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PICKED");

      // WHEN — Set Picked, on the role's page.
      const answer = await setPicked(page);

      await test.step("then: set picked refused", async () => {
        expect.soft(answer.status()).toBe(200);
        const body = (await answer.json()) as { results?: { moved?: boolean; refusedReason?: string }[] };
        expect.soft(body.results?.[0]?.moved ?? false, "the role's Set Picked moved nothing").toBe(false);
        expect.soft(body.results?.[0]?.refusedReason ?? "").toContain("already picked");
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PICKED");
        // Nothing written twice: the timeline still has ONE Picked step — the other person's.
        await otherPage.goto(`/orders/${orderId}`);
        await expect(otherPage.getByTestId("order-detail-page")).toBeVisible();
        await otherPage.getByTestId("order-detail-tab-timeline").click();
        await expect(otherPage.getByTestId("order-detail-timeline")).toBeVisible();
        await expect.soft(otherPage.getByTestId("order-timeline-picked")).toHaveCount(1);
        await expect.soft(otherPage.getByTestId("order-timeline-picked-by")).toContainText(username(other.key));
        await expect.soft(otherPage.getByTestId("order-timeline-picked-by")).not.toContainText(username(r.key));
      });

      await test.step("then: message says already picked", async () => {
        await expect(page.locator('[data-scope="toast"][data-part="root"]').filter({ hasText: "already picked" })).toBeVisible();
      });

      await otherPage.close();
    });
  }

  // Its own test, LAST in the file: it moves one order of a shop of its own (see the head of this file).
  test(`warehouse:owner validate package order (${COND_SCAN}): pick recorded in analytic metric`, async ({ page }) => {
    await installEar(page);
    await signIn(page, username("own"), ground.warehouse);
    const [orderId, left] = ground.metricOrders;
    const shop = ground.metricShop;
    expect(await statusOf(page, ground.warehouse, orderId!)).toBe("ORDER_STATUS_PROCESSED");

    // WHEN — Orders › Scan Label opens the order; every unit scanned, Set Picked. The shop's other order stays processed.
    await page.goto("/warehouse-orders");
    await openScanLabel(page);
    const label = page.getByTestId("scan-label-input");
    await label.fill(METRIC_RECEIPT);
    await label.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}$`));
    await expect(page.getByTestId("pick-scan-input")).toBeVisible();
    for (let n = 0; n < QTY; n += 1) await scanAndHear(page, SKU_ONE);
    const answer = await setPicked(page);
    expect(answer.status()).toBe(200);
    expect(await statusOf(page, ground.warehouse, orderId!)).toBe("ORDER_STATUS_PICKED");
    expect(await statusOf(page, ground.warehouse, left!)).toBe("ORDER_STATUS_PROCESSED");

    await test.step("then: pick recorded in analytic metric", async () => {
      // Order status moves is offered under Order, and the shop's Picked reads the ONE pick.
      await expectMovesOffered(page);
      await expectMoveCounted(page, shop, "picked_count");
    });
  });
});

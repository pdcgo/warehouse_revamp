import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";
import { expectMoveCounted, expectMovesOffered } from "./order_moves_metric";

// ── warehouse:all wants to hand an order to the courier — hand over order's givens of docs/acceptances/inventory/order.md
//
// hand over order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are
// the owner's, set by hand — never by this file.
//
// Business rules:
// - docs/business/inventory/order.md, How Warehouse Process The Order › Order Shipping — the courier arrives, the crew
//   scans the parcel and the order's status changes to shipping, then the parcel is given to the courier.
// - docs/business/order/context_decision.md — picked-and-shipping-are-order-statuses (`shipping` is the handover scan's),
//   customer-service-sets-shipped-and-problem-by-hand (`shipping → shipped` is customer service's, by hand; each move one
//   timeline row).
// - docs/business/inventory/order_decision.md — a-label-scan-reads-the-ref-or-the-receipt (the handover scan finds the
//   order by its tracking number or its ref), two-orders-on-one-label-are-shown-not-chosen (several live orders on one
//   label: every one shown, none chosen; a cancelled one is skipped, so a live order beside its cancelled twin is the one;
//   no match: the wrong sound).
// - The handover dialog (pages/pick-queue/components/HandoverScanDialog.tsx, scanning-is-the-crews-hands): bulk handover
//   (the acceptance's name; the dialog's switch is `handover-mass`, labelled "Mass pickup") OFF hands every good scan over
//   at once, ON collects the scans into a list handed over together by one button; a parcel at another step is marked an
//   error with the wrong sound and is not in the list's hand over; the same label twice is not added twice; the bulk
//   button is off while the list holds nothing that can be handed over. The list's bulk Hand Over moves the ticked picked
//   orders and skips the others with a warning.
// - docs/technical/frontend/warehouse_order_list_decision.md — the-print-page-and-the-courier-count-prototype-is-accepted
//   (Per kurir, #83): in Serah ke Kurir the parcels are counted per courier over the scans that are ready or handed over,
//   most first, with the total; wrong-step / not-found scans are not counted; on screen only.
//
// Run as EVERY warehouse role (warehouse:owner, warehouse:admin, warehouse:staff), each in its own browser session.
//
// The ground (beforeAll, root): one warehouse with one rack; one seller (return warehouse = it) with a shop and a
// selling:cs on it; one product restocked onto the rack. Per role twenty-two orders of that product ×1, placed by root:
// root confirms every live one (processed) and moves the ones a given needs picked to picked; one is cancelled while
// pending. Each order's tracking number is its own unless the given puts one label on two orders; the resi given's
// order is picked with its first number on the label, then root as its seller changes the number (OrderReceiptUpdate).
// Every order ships by courier #1, except the bulk given's three: two by JNE, one by J&T (the seeded catalogue's, read by
// code). Besides, per role the metric check's own shop with TWO picked orders (so no other test's hand over counts on it).
//
// The WHEN — the role hands the order over:
//   (… receipt scan …)          Orders › Scan Handover, the label's tracking number scanned (bulk handover as the given
//                               says; off is the dialog's default).
//   (… selected from list …)    Orders, the orders ticked on the list (narrowed by their ref), the bulk bar's Hand Over.
//   The order's own page (/warehouse-orders/<id>, its next step Mark Handed Over) is no longer a given of its own — the
//   file stopped splitting givens by entry point (acceptances d7ca84e2) — and stays here as a regression test, last but one.
//
// How each then is read:
// - `status changed from picked to shipping` — the scan's line reads Handed over (or the page's status does), the order's
//   own record says ORDER_STATUS_SHIPPING, and on Orders it has left Picked and stands on Handed over.
// - `hand over recorded in (each) order timeline` — the warehouse's order detail › Timeline: ONE Shipping step, by the
//   role's @username.
// - `selling team sees order shipping` — the seller's customer service (selling:cs) opens the order: its stepper stands on
//   shipping and its timeline shows the Shipping step.
// - `order can be marked shipped` — the same selling:cs is offered Mark as Shipped and pressing it makes the order
//   ORDER_STATUS_SHIPPED (customer-service-sets-shipped-and-problem-by-hand: the move is the selling team's).
// - `scanned orders collected in list` — bulk handover on: each scan is a Ready line, the button counts them, and nothing
//   has been sent — every order still picked.
// - `status of every order changed from picked to shipping` — every order ORDER_STATUS_SHIPPING (its line Handed over, or
//   gone from the Picked tab).
// - `scan marked error with wrong sound` / `scan marked not found with wrong sound` — the scan's line is marked (Not picked
//   — Confirmed / Not found) and the tone it made is the WRONG one: the browser's oscillator is recorded (headless has no
//   speaker) and the tone is lower and longer than the good one. The good one is heard on the same dialog right after, by
//   scanning the same label again — a duplicate is answered with the good sound (lib/beep.ts: "a duplicate is not a
//   mistake"); the then is asserted before it. A label printed before its resi was changed carries the OLD number: that
//   scan is a not found too, and the order stays picked.
// - `order listed once` — bulk handover on, the label scanned twice: one line, the button counts 1.
// - `both orders shown` / `no order handed over` — the scan's line says several orders and names both; no status change
//   is sent and both stay picked.
// - `picked orders changed from picked to shipping` / `processed orders skipped with warning` — one Hand Over for the
//   ticked rows: the picked ones become shipping, the processed one is left out of the move, stays processed, and the
//   screen warns it was skipped.
// - `cannot hand over` — bulk handover on, only error scans: Hand Over is off; pressed anyway, nothing is sent and the
//   orders stay processed.
// - `only picked orders handed over` / `processed scans marked error` — bulk handover on, two picked parcels and a
//   processed one between them scanned: the processed one's line is marked an error (Not picked — Confirmed) as it is
//   scanned, the button counts only the 2 picked; one Hand Over moves exactly those two (the one call carries the picked
//   orders only), their lines read Handed over and they are shipping, while the processed order stays processed and its
//   line keeps its error mark.
// - `hand over recorded in analytic metric` — Analytic › Order › Order status moves (`metrics/orders/moves`, #84) counts
//   a hand over as a Handed over, picked → shipping (the-order-metric-ids-name-what-moved). Its own test per role, last
//   in the file — EVERY warehouse role on a shop of its own with TWO picked orders of which the role hands ONE over (Scan
//   Handover, bulk handover off), read as that role (a warehouse reads every count of the orders it ships): Add Metric ›
//   Order offers Order
//   status moves, and Analytic by shop over the last 7 days, filtered to that shop, reads `created_count` 2 (the fold
//   landed) and `handed_over_count` exactly 1 — the untouched order, still picked, adds nothing (order_moves_metric.ts).
// - `parcel count per courier shown` — the dialog's Per kurir strip names each courier of the scans once with its count
//   (JNE 2, J&T 1 — most first), and the total (3 parcels): read while the scans are collected (ready) and again after
//   they were handed over.
test.describe("warehouse:all wants to hand an order to the courier", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;

  const COND_ONE = "status: picked · 1 order · receipt scan · bulk handover off";
  const COND_MASS = "status: picked · multi orders · receipt scan · bulk handover on";
  const COND_LIST = "status: picked · multi orders · selected from list";
  const COND_PROCESSED = "status: processed · receipt scan";
  const COND_TWICE = "status: picked · same receipt scanned twice · bulk handover on";
  const COND_DUP = "status: picked · 1 receipt on 2 orders · receipt scan";
  const COND_MIX = "status: picked and processed · multi orders · selected from list";
  const COND_NOT_FOUND = "receipt not found · receipt scan";
  const COND_CANCELLED = "status: picked · 1 receipt on 1 order and 1 cancelled order · receipt scan";
  const COND_ONLY_ERRORS = "status: processed · bulk handover on · only error scans";
  const COND_SCAN_MIX = "status: picked and processed · multi orders · receipt scan · bulk handover on";
  const COND_RESI = "status: picked · resi changed after label printed · old label scanned";

  // Order kinds, per role. `picked` ones end picked, `processed` ones processed, `dead` cancelled while pending.
  const PICKED = [
    "one",
    "massA",
    "massB",
    "massC",
    "listA",
    "listB",
    "twice",
    "dupA",
    "dupB",
    "mixA",
    "mixB",
    "live",
    "page",
    "bulkA",
    "bulkB",
    "resi",
  ] as const;
  const PROCESSED = ["processed", "mixP", "errA", "errB", "bulkP"] as const;
  const KINDS = [...PICKED, ...PROCESSED, "dead"] as const;
  type Kind = (typeof KINDS)[number];

  // Per role, the metric check's two orders, on a shop of the role's own: one is handed over, the other stays picked.
  const metricReceipts = (key: string) => [`ZHR${SUFFIX}MT${key.toUpperCase()}A`, `ZHR${SUFFIX}MT${key.toUpperCase()}B`] as const;

  const STOCK = ROLES.length * (KINDS.length + 2) + 4;
  const UNIT_COST = 10_000;
  const PLATFORM_TOTAL = 100_000;

  const username = (key: string) => `e2eohv${key}${SUFFIX}`;
  const SELLER_CS = username("cs");
  // Team codes are at most 10 characters. SUFFIX is ONE per worker, shared by every spec file the worker runs, so each
  // code's prefix must be this file's alone: the ZH… ones are.
  const SELLER_CODE = `ZHS${SUFFIX}`;
  const WH_CODE = `ZHW${SUFFIX}`;
  const SKU = `ZHK${SUFFIX}`;
  const RACK = `zhr-${SUFFIX}`;
  // The tracking number on an order's label. One label on two orders: dupA/dupB share one, live/dead share one.
  const receiptOf = (key: string, kind: Kind) => {
    const label = kind === "dupA" || kind === "dupB" ? "DUP" : kind === "live" || kind === "dead" ? "LIVE" : kind.toUpperCase();
    return `ZHR${SUFFIX}${key.toUpperCase()}${label}`;
  };
  // The marketplace ref. The list givens' orders share a stem, so the list's search narrows to exactly them.
  const listStem = (key: string) => `ZHL${SUFFIX}${key.toUpperCase()}`;
  const mixStem = (key: string) => `ZHM${SUFFIX}${key.toUpperCase()}`;
  const refOf = (key: string, kind: Kind) =>
    kind.startsWith("list")
      ? `${listStem(key)}${kind.slice(4)}`
      : kind.startsWith("mix")
        ? `${mixStem(key)}${kind.slice(3)}`
        : `ZHO${SUFFIX}${key.toUpperCase()}${kind.toUpperCase()}`;
  // A label no order carries.
  const unknownLabel = (key: string) => `ZHX${SUFFIX}${key.toUpperCase()}NONE`;
  // The tracking number the `resi` order carries now — changed by its seller after its label (receiptOf) was printed.
  const newReceiptOf = (key: string) => `${receiptOf(key, "resi")}NEW`;

  const ground = {
    seller: "",
    warehouse: "",
    orders: {} as Record<string, Record<Kind, string>>,
    // Per role, the metric check's shop and its two picked orders, in metricReceipts' order.
    metricShops: {} as Record<string, string>,
    metricOrders: {} as Record<string, string[]>,
    // The seeded couriers (shipment_service's catalogue): id and name, by code.
    couriers: {} as Record<string, { id: string; name: string }>,
  };
  // The courier an order ships by: the mass given's parcels go to two couriers, so Per kurir has two counts to show.
  const MASS = ["massA", "massB", "massC"] as const;
  const channelOf = (kind: Kind) =>
    kind === "massA" || kind === "massB" ? ground.couriers.jne!.id : kind === "massC" ? ground.couriers.jnt!.id : "1";

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
  // makes no sound. Installed before the app loads, so the app's lazy context is this one.
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

  // Watch the page for a status change being sent, and what it asked to move.
  function watchMoves(page: Page) {
    const sent = { n: 0, ids: [] as string[][] };
    page.on("request", (req) => {
      if (!req.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")) return;
      sent.n += 1;
      const body = req.postDataJSON() as { orderIds?: (string | number)[] } | null;
      sent.ids.push((body?.orderIds ?? []).map(String));
    });
    return sent;
  }

  // Orders › Scan Handover: the dialog, bulk handover as asked (off is its default).
  async function openHandover(page: Page, mass: boolean) {
    await page.goto("/warehouse-orders");
    await page.getByTestId("warehouse-orders-handover").click();
    await expect(page.getByTestId("handover-dialog")).toBeVisible();
    await expect(page.getByTestId("handover-scan")).toBeVisible();
    if (mass) {
      await page.getByTestId("handover-mass").click();
      await expect(page.getByTestId("handover-submit")).toBeVisible();
    } else {
      await expect(page.getByTestId("handover-submit")).toHaveCount(0);
    }
  }

  // One scan into the dialog, and the ONE tone it made (made once the scan has been answered).
  async function scan(page: Page, code: string): Promise<Tone> {
    const before = (await heard(page)).length;
    const field = page.getByTestId("handover-scan");
    await field.fill(code);
    await field.press("Enter");
    await expect.poll(async () => (await heard(page)).length, { timeout: 15_000 }).toBe(before + 1);
    return (await heard(page))[before]!;
  }

  const entry = (page: Page, code: string) => page.getByTestId(`handover-entry-${code}`);
  const entries = (page: Page) => page.getByTestId("handover-entries").locator("[data-testid^='handover-entry-']");

  // The dialog's Per kurir strip as it reads now: each courier's count, in its order, and the total. A plain read (the
  // then's step asserts it), so a strip that never shows reads as null instead of failing another then's step.
  type Strip = { couriers: { channel: string; count: string | null; text: string }[]; total: string } | null;
  async function courierStrip(page: Page): Promise<Strip> {
    const strip = page.getByTestId("handover-courier-counts");
    const shown = await strip.waitFor({ timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (!shown) return null;
    // A courier badge is a placeholder until the courier catalogue has loaded.
    await strip
      .getByTestId("order-courier-loading")
      .first()
      .waitFor({ state: "detached", timeout: 10_000 })
      .catch(() => {});
    const couriers: NonNullable<Strip>["couriers"] = [];
    for (const row of await strip.locator("[data-testid^='handover-courier-count-']").all()) {
      couriers.push({
        channel: ((await row.getAttribute("data-testid")) ?? "").replace("handover-courier-count-", ""),
        count: await row.getAttribute("data-count"),
        text: (await row.innerText()).replace(/\s+/g, " ").trim(),
      });
    }
    return { couriers, total: (await strip.getByTestId("handover-courier-total").innerText()).trim() };
  }

  // The wrong sound: the low, longer buzz — told apart from the good tone the same dialog makes for the same label scanned
  // again (a duplicate is answered with the good sound). Called after the then's own marks are asserted.
  async function expectWrongSound(page: Page, code: string, tone: Tone) {
    const good = await scan(page, code);
    expect.soft(tone, "the error scan's tone differs from the good one").not.toEqual(good);
    expect.soft(tone.hz, "the wrong sound is lower than the good one").toBeLessThan(good.hz);
    expect.soft(tone.seconds, "the wrong sound is longer than the good one").toBeGreaterThan(good.seconds);
  }

  // On Orders: the order has left Picked and stands on Handed over. The list is narrowed by the order's ref — a tab shows
  // 20 rows a page, and this file alone hands over more than 20 orders before its last test.
  async function expectOnHandoverTab(page: Page, orderId: string, ref: string) {
    await page.goto(`/warehouse-orders?q=${ref}`);
    await expect(page.getByTestId("pick-queue-table")).toBeVisible();
    await page.getByTestId("pick-tab-picked").click();
    await expect(page.getByTestId("pick-tab-picked")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pick-queue-table")).toBeVisible();
    await expect.soft(page.getByTestId(`pick-queue-row-${orderId}`)).toHaveCount(0);
    await page.getByTestId("pick-tab-handover").click();
    await expect(page.getByTestId("pick-tab-handover")).toHaveAttribute("aria-selected", "true");
    await expect.soft(page.getByTestId(`pick-queue-row-${orderId}`)).toBeVisible();
  }

  // The warehouse's order detail › Timeline: ONE Shipping step, by this user.
  async function expectHandoverInTimeline(page: Page, orderId: string, user: string) {
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByTestId("order-detail-page")).toBeVisible();
    await page.getByTestId("order-detail-tab-timeline").click();
    await expect(page.getByTestId("order-detail-timeline")).toBeVisible();
    await expect.soft(page.getByTestId("order-timeline-shipping")).toHaveCount(1);
    await expect.soft(page.getByTestId("order-timeline-shipping-by")).toContainText(user);
  }

  // Orders on the list (the tab, narrowed by their ref stem), ticked, and the bulk bar's Hand Over pressed.
  async function handOverFromList(page: Page, step: string, stem: string, ids: string[]) {
    await page.goto(`/warehouse-orders?step=${step}&q=${stem}`);
    await expect(page.getByTestId("pick-queue-table")).toBeVisible();
    for (const id of ids) await expect(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
    for (const id of ids) {
      await page.getByTestId(`pick-queue-select-${id}`).click();
    }
    await expect(page.getByTestId("pick-queue-bulk-count")).toContainText(`${ids.length} selected`);
    const [answer] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
      page.getByTestId("pick-queue-bulk-handover").click(),
    ]);
    return answer;
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

    ground.seller = await team(`E2E Ohv Seller ${SUFFIX}`, SELLER_CODE, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Ohv Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");

    // The seeded couriers' ids and names, by code.
    const channels = (await api(page, "shipment.v1.ShipmentChannelService/ShipmentChannelList", {
      dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"],
      page: { page: 1, limit: 100 },
    })) as { items: { channel?: { mapData: Record<string, { code: string; name: string }> } }[] };
    const map = channels.items.find((item) => item.channel)?.channel?.mapData ?? {};
    for (const [id, channel] of Object.entries(map)) ground.couriers[channel.code] = { id, name: channel.name };
    if (!ground.couriers.jne || !ground.couriers.jnt) throw new Error("the seeded couriers jne and jnt are not in the catalogue");
    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: RACK, name: "E2E ohv shelf" })).rack
        .id,
    );
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 10, minFee: 0 });
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
    });

    // A user per warehouse role, and the seller's customer service, who reads the selling team's side and marks shipped.
    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.warehouse,
        username: username(r.key),
        password: PASSWORD,
        name: `Ohv ${r.given} ${SUFFIX}`,
        role: r.role,
      });
    }
    const sellerCs = String(
      (
        await api(page, "user.v1.UserService/CreateUser", {
          teamId: ground.seller,
          username: SELLER_CS,
          password: PASSWORD,
          name: `Ohv selling:cs ${SUFFIX}`,
          role: "ROLE_SELLING_CS",
        })
      ).user.id,
    );

    // The seller's product, restocked onto the rack.
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Ohv Cat ${SUFFIX}` });
    const product = String(
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.seller,
          productCodePart: SKU,
          name: `E2E ${SKU}`,
          categoryId: category.category.id,
        })
      ).product.id,
    );
    const supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.seller, name: `E2E Ohv Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Ohv BCA ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `88${SUFFIX}01`,
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
    const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
      financeAccountId: account,
      items: [{ productId: product, productCode: SKU, name: `E2E ${SKU}`, count: STOCK, total: UNIT_COST * STOCK, supplierId: supplier }],
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouse,
      requestId: raised.request.id,
      lines: (raised.request.items as { id: string }[]).map((item) => ({
        itemId: item.id,
        receivedCount: STOCK,
        placements: [{ placementId: rack, quantity: STOCK }],
      })),
    });

    // The seller's shop, its customer service on it.
    const shop = String(
      (
        await api(page, "selling.v1.ShopService/ShopCreate", {
          teamId: ground.seller,
          name: `E2E Ohv Shop ${SUFFIX}`,
          shopCode: `ZHP${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: shop, userId: sellerCs });

    // GIVEN — per role, eighteen orders placed by root. The cancelled one is cancelled while pending; every other is
    // confirmed by root (processed), and the picked kinds moved on to picked.
    const live: string[] = [];
    const toPick: string[] = [];
    for (const r of ROLES) {
      ground.orders[r.key] = {} as Record<Kind, string>;
      for (const kind of KINDS) {
        const made = await api(page, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-ohv-${SUFFIX}-${r.key}-${kind}`,
          shipmentChannelId: channelOf(kind),
          teamId: ground.seller,
          shopId: shop,
          warehouseId: ground.warehouse,
          customerName: `E2E Ohv Buyer ${r.key} ${kind}`,
          platformTotal: PLATFORM_TOTAL,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: refOf(r.key, kind),
          receiptCode: receiptOf(r.key, kind),
          items: [{ productId: product, productCode: SKU, name: `E2E ${SKU}`, quantity: 1 }],
        });
        const id = String(made.order.id);
        ground.orders[r.key]![kind] = id;
        if (kind === "dead") {
          await api(page, "selling.v1.OrderService/OrderCancel", { teamId: ground.seller, orderId: id });
          continue;
        }
        live.push(id);
        if ((PICKED as readonly string[]).includes(kind)) toPick.push(id);
      }
    }
    // Per role, the metric check's shop and its two orders, both to be picked.
    for (const r of ROLES) {
      const metricShop = String(
        (
          await api(page, "selling.v1.ShopService/ShopCreate", {
            teamId: ground.seller,
            name: `E2E Ohv Metric Shop ${r.key} ${SUFFIX}`,
            shopCode: `ZHQ${r.key.toUpperCase()}${SUFFIX}`,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
      ground.metricShops[r.key] = metricShop;
      ground.metricOrders[r.key] = [];
      for (const [n, receipt] of metricReceipts(r.key).entries()) {
        const made = await api(page, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-ohv-${SUFFIX}-metric-${r.key}-${n}`,
          shipmentChannelId: "1",
          teamId: ground.seller,
          shopId: metricShop,
          warehouseId: ground.warehouse,
          customerName: `E2E Ohv Buyer metric ${r.key} ${n}`,
          platformTotal: PLATFORM_TOTAL,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: `ZHO${SUFFIX}MT${r.key.toUpperCase()}${n}`,
          receiptCode: receipt,
          items: [{ productId: product, productCode: SKU, name: `E2E ${SKU}`, quantity: 1 }],
        });
        const id = String(made.order.id);
        ground.metricOrders[r.key]!.push(id);
        live.push(id);
        toPick.push(id);
      }
    }
    const move = async (orderIds: string[], to: string) => {
      const res = await api(page, "selling.v1.OrderService/OrderStatusChange", { teamId: ground.warehouse, orderIds, to });
      for (const x of res.results as { orderId: string; moved?: boolean; refusedReason?: string }[]) {
        if (!x.moved) throw new Error(`${to} #${x.orderId}: ${x.refusedReason}`);
      }
    };
    await move(live, "ORDER_STATUS_PROCESSED");
    await move(toPick, "ORDER_STATUS_PICKED");

    // The `resi` orders: confirmed (processed — the warehouse confirmed it and printed the label) and picked with their
    // first tracking number on that label; then the seller changes the number (the-seller-edits-the-resi-until-handover).
    for (const r of ROLES) {
      const changed = await api(page, "selling.v1.OrderService/OrderReceiptUpdate", {
        teamId: ground.seller,
        orderId: ground.orders[r.key]!.resi,
        receiptCode: newReceiptOf(r.key),
      });
      if (String(changed.order?.receiptCode ?? "") !== newReceiptOf(r.key)) {
        throw new Error(`resi of #${ground.orders[r.key]!.resi} not changed: ${JSON.stringify(changed.order?.receiptCode)}`);
      }
    }

    await page.close();
  });

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_ONE})`, async ({ page, browser }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.one;
      const code = receiptOf(r.key, "one");
      expect(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PICKED");

      // WHEN — Orders › Scan Handover (bulk handover off), the parcel's tracking number scanned.
      await openHandover(page, false);
      await scan(page, code);

      await test.step("then: status changed from picked to shipping", async () => {
        await expect.soft(entry(page, code)).toHaveAttribute("data-state", "handedOver");
        await expect.soft(entry(page, code)).toContainText("Handed over");
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_SHIPPING");
        await expectOnHandoverTab(page, orderId, refOf(r.key, "one"));
      });

      await test.step("then: hand over recorded in order timeline", async () => {
        await expectHandoverInTimeline(page, orderId, username(r.key));
      });

      const seller = await browser.newPage();
      await signIn(seller, SELLER_CS, ground.seller);

      await test.step("then: selling team sees order shipping", async () => {
        await seller.goto(`/orders/${orderId}`);
        await expect(seller.getByTestId("order-detail-page")).toBeVisible();
        await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "shipping");
        await expect.soft(seller.getByTestId("section-timeline").getByTestId("order-timeline-shipping")).toBeVisible();
      });

      await test.step("then: order can be marked shipped", async () => {
        const ship = seller.getByTestId("order-action-ship");
        await expect(ship).toBeVisible();
        await expect.soft(ship).toContainText("Mark as Shipped");
        const [answer] = await Promise.all([
          seller.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
          ship.click(),
        ]);
        expect.soft(answer.status()).toBe(200);
        await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "shipped");
        expect.soft(await statusOf(seller, ground.seller, orderId)).toBe("ORDER_STATUS_SHIPPED");
      });
      await seller.close();
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_MASS})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const kinds = MASS;
      const ids = kinds.map((k) => ground.orders[r.key]![k]);
      const codes = kinds.map((k) => receiptOf(r.key, k));
      const sent = watchMoves(page);

      // WHEN — Orders › Scan Handover, bulk handover on, each parcel's tracking number scanned, then Hand Over.
      await openHandover(page, true);
      for (const code of codes) await scan(page, code);

      await test.step("then: scanned orders collected in list", async () => {
        await expect.soft(entries(page)).toHaveCount(codes.length);
        for (const code of codes) await expect.soft(entry(page, code)).toHaveAttribute("data-state", "ready");
        await expect.soft(page.getByTestId("handover-submit")).toContainText(`Hand Over ${codes.length}`);
        expect.soft(sent.n, "nothing handed over while collecting").toBe(0);
        for (const id of ids) expect.soft(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_PICKED");
      });

      // Per kurir while the scans are collected — read now, asserted in its then's step below.
      const collecting = await courierStrip(page);

      await test.step("then: status of every order changed from picked to shipping", async () => {
        const [answer] = await Promise.all([
          page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
          page.getByTestId("handover-submit").click(),
        ]);
        expect.soft(answer.status()).toBe(200);
        expect.soft(sent.n, "one call for the batch").toBe(1);
        for (const code of codes) await expect.soft(entry(page, code)).toHaveAttribute("data-state", "handedOver");
        for (const id of ids) expect.soft(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_SHIPPING");
      });

      await test.step("then: parcel count per courier shown", async () => {
        // The scans made: massA and massB by JNE, massC by J&T — JNE 2 first (most first), J&T 1, 3 parcels in all.
        const jne = ground.couriers.jne!;
        const jnt = ground.couriers.jnt!;
        const handedOver = await courierStrip(page);
        for (const [when, strip] of [
          ["while the scans are collected", collecting],
          ["after they were handed over", handedOver],
        ] as const) {
          expect.soft(strip, `${when}: the Per kurir strip is shown`).not.toBeNull();
          expect
            .soft(
              strip?.couriers.map((c) => [c.channel, c.count]),
              `${when}: each courier once with its count, most first`,
            )
            .toEqual([
              [jne.id, "2"],
              [jnt.id, "1"],
            ]);
          expect.soft(strip?.couriers[0]?.text ?? "", `${when}: JNE named with its count`).toBe(`${jne.name} 2`);
          expect.soft(strip?.couriers[1]?.text ?? "", `${when}: J&T named with its count`).toBe(`${jnt.name} 1`);
          expect.soft(strip?.total, `${when}: the total`).toBe(`${codes.length} parcels`);
        }
      });

      await test.step("then: hand over recorded in each order timeline", async () => {
        for (const id of ids) await expectHandoverInTimeline(page, id, username(r.key));
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_LIST})`, async ({ page }) => {
      await signIn(page, username(r.key), ground.warehouse);
      const ids = (["listA", "listB"] as const).map((k) => ground.orders[r.key]![k]);

      // WHEN — Orders › Picked, both orders ticked, the bulk bar's Hand Over.
      const answer = await handOverFromList(page, "picked", listStem(r.key), ids);

      await test.step("then: status of every order changed from picked to shipping", async () => {
        expect.soft(answer.status()).toBe(200);
        for (const id of ids) expect.soft(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_SHIPPING");
        for (const id of ids) await expect.soft(page.getByTestId(`pick-queue-row-${id}`)).toHaveCount(0);
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_PROCESSED})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.processed;
      const code = receiptOf(r.key, "processed");
      const sent = watchMoves(page);

      // WHEN — Orders › Scan Handover, a processed (not yet picked) parcel's tracking number scanned.
      await openHandover(page, false);
      const tone = await scan(page, code);

      await test.step("then: scan marked error with wrong sound", async () => {
        await expect.soft(entry(page, code)).toHaveAttribute("data-state", "wrongStep");
        await expect.soft(entry(page, code)).toContainText("Not picked — Confirmed");
        expect.soft(sent.n, "nothing handed over").toBe(0);
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PROCESSED");
        await expectWrongSound(page, code, tone);
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_TWICE})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const code = receiptOf(r.key, "twice");

      // WHEN — Orders › Scan Handover, bulk handover on, the same tracking number scanned twice.
      await openHandover(page, true);
      await scan(page, code);
      await scan(page, code);

      await test.step("then: order listed once", async () => {
        await expect.soft(entries(page)).toHaveCount(1);
        await expect.soft(entry(page, code)).toHaveAttribute("data-state", "ready");
        await expect.soft(page.getByTestId("handover-submit")).toContainText("Hand Over 1");
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_DUP})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const ids = (["dupA", "dupB"] as const).map((k) => ground.orders[r.key]![k]);
      const code = receiptOf(r.key, "dupA");
      const sent = watchMoves(page);

      // WHEN — Orders › Scan Handover, the one tracking number two picked orders carry scanned.
      await openHandover(page, false);
      await scan(page, code);

      await test.step("then: both orders shown", async () => {
        await expect.soft(entry(page, code)).toHaveAttribute("data-state", "several");
        const several = page.getByTestId(`handover-several-${code}`);
        for (const id of ids) await expect.soft(several).toContainText(`#${id}`);
      });

      await test.step("then: no order handed over", async () => {
        await expect.soft(entry(page, code)).toContainText("none handed over");
        expect.soft(sent.n, "no status change sent").toBe(0);
        for (const id of ids) expect.soft(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_PICKED");
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_MIX})`, async ({ page }) => {
      await signIn(page, username(r.key), ground.warehouse);
      const picked = (["mixA", "mixB"] as const).map((k) => ground.orders[r.key]![k]);
      const processed = ground.orders[r.key]!.mixP;
      const sent = watchMoves(page);

      // WHEN — Orders › All, the two picked orders and the processed one ticked, the bulk bar's Hand Over.
      const answer = await handOverFromList(page, "all", mixStem(r.key), [...picked, processed]);

      await test.step("then: picked orders changed from picked to shipping", async () => {
        expect.soft(answer.status()).toBe(200);
        for (const id of picked) expect.soft(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_SHIPPING");
      });

      await test.step("then: processed orders skipped with warning", async () => {
        await expect.soft(page.getByText("1 not picked yet — skipped")).toBeVisible();
        expect.soft(sent.ids, "one move, of the picked orders only").toEqual([expect.arrayContaining(picked)]);
        expect.soft(sent.ids[0] ?? [], "the processed order is not in the move").not.toContain(processed);
        expect.soft(await statusOf(page, ground.warehouse, processed)).toBe("ORDER_STATUS_PROCESSED");
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_NOT_FOUND})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const code = unknownLabel(r.key);
      const sent = watchMoves(page);

      // WHEN — Orders › Scan Handover, a label no order of this warehouse carries scanned.
      await openHandover(page, false);
      const tone = await scan(page, code);

      await test.step("then: scan marked not found with wrong sound", async () => {
        await expect.soft(entry(page, code)).toHaveAttribute("data-state", "notFound");
        await expect.soft(entry(page, code)).toContainText("Not found");
        expect.soft(sent.n, "nothing handed over").toBe(0);
        await expectWrongSound(page, code, tone);
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_CANCELLED})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.live;
      const cancelled = ground.orders[r.key]!.dead;
      const code = receiptOf(r.key, "live");
      expect(await statusOf(page, ground.warehouse, cancelled)).toBe("ORDER_STATUS_CANCEL");

      // WHEN — Orders › Scan Handover, the tracking number a picked order and a cancelled one both carry scanned.
      await openHandover(page, false);
      await scan(page, code);

      await test.step("then: status changed from picked to shipping", async () => {
        await expect.soft(entry(page, code)).toHaveAttribute("data-state", "handedOver");
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_SHIPPING");
        expect.soft(await statusOf(page, ground.warehouse, cancelled), "the cancelled twin is left alone").toBe("ORDER_STATUS_CANCEL");
        await expectOnHandoverTab(page, orderId, refOf(r.key, "live"));
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_ONLY_ERRORS})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const kinds = ["errA", "errB"] as const;
      const ids = kinds.map((k) => ground.orders[r.key]![k]);
      const codes = kinds.map((k) => receiptOf(r.key, k));
      const sent = watchMoves(page);

      // WHEN — Orders › Scan Handover, bulk handover on, only processed parcels scanned.
      await openHandover(page, true);
      for (const code of codes) await scan(page, code);
      for (const code of codes) await expect(entry(page, code)).toHaveAttribute("data-state", "wrongStep");

      await test.step("then: cannot hand over", async () => {
        const submit = page.getByTestId("handover-submit");
        await expect.soft(submit).toBeDisabled();
        await submit.click({ force: true });
        await page.waitForTimeout(500);
        expect.soft(sent.n, "no status change sent").toBe(0);
        for (const id of ids) expect.soft(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_PROCESSED");
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_SCAN_MIX})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const pickedKinds = ["bulkA", "bulkB"] as const;
      const picked = pickedKinds.map((k) => ground.orders[r.key]![k]);
      const pickedCodes = pickedKinds.map((k) => receiptOf(r.key, k));
      const processed = ground.orders[r.key]!.bulkP;
      const processedCode = receiptOf(r.key, "bulkP");
      for (const id of picked) expect(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_PICKED");
      expect(await statusOf(page, ground.warehouse, processed)).toBe("ORDER_STATUS_PROCESSED");
      const sent = watchMoves(page);

      // WHEN — Orders › Scan Handover, bulk handover on: a picked parcel, the processed one, the other picked one
      // scanned, then Hand Over.
      await openHandover(page, true);
      for (const code of [pickedCodes[0]!, processedCode, pickedCodes[1]!]) await scan(page, code);
      await expect(entries(page)).toHaveCount(3);
      // The processed scan's mark while the scans are collected — read now, asserted in its then's step below.
      const markWhileCollecting = await entry(page, processedCode).getAttribute("data-state");

      await test.step("then: only picked orders handed over", async () => {
        const submit = page.getByTestId("handover-submit");
        await expect.soft(submit, "the button counts the picked parcels only").toContainText("Hand Over 2");
        expect.soft(sent.n, "nothing handed over while collecting").toBe(0);
        const [answer] = await Promise.all([
          page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
          submit.click(),
        ]);
        expect.soft(answer.status()).toBe(200);
        expect.soft(sent.ids, "one move, of the picked orders").toEqual([expect.arrayContaining(picked)]);
        expect.soft(sent.ids[0] ?? [], "the processed order is not in the move").not.toContain(processed);
        for (const code of pickedCodes) await expect.soft(entry(page, code)).toHaveAttribute("data-state", "handedOver");
        for (const id of picked) expect.soft(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_SHIPPING");
        expect.soft(await statusOf(page, ground.warehouse, processed), "the processed order stays").toBe("ORDER_STATUS_PROCESSED");
      });

      await test.step("then: processed scans marked error", async () => {
        expect.soft(markWhileCollecting, "marked an error as it was scanned").toBe("wrongStep");
        await expect.soft(entry(page, processedCode), "and still after the hand over").toHaveAttribute("data-state", "wrongStep");
        await expect.soft(entry(page, processedCode)).toContainText("Not picked — Confirmed");
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_RESI})`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.resi;
      const oldCode = receiptOf(r.key, "resi");
      expect(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PICKED");
      const sent = watchMoves(page);

      // WHEN — Orders › Scan Handover, the tracking number on the parcel's printed label — the old one — scanned.
      await openHandover(page, false);
      const tone = await scan(page, oldCode);

      await test.step("then: scan marked not found with wrong sound", async () => {
        await expect.soft(entry(page, oldCode)).toHaveAttribute("data-state", "notFound");
        await expect.soft(entry(page, oldCode)).toContainText("Not found");
        expect.soft(sent.n, "nothing handed over").toBe(0);
        expect.soft(await statusOf(page, ground.warehouse, orderId), "the order is not handed over").toBe("ORDER_STATUS_PICKED");
        await expectWrongSound(page, oldCode, tone);
      });
    });
  }

  // A regression of the order page's entry point — no longer an acceptance given (the file stopped splitting givens by
  // entry point), so its title carries no given's condition.
  for (const r of ROLES) {
    test(`${r.given} hand over order from its own page (regression)`, async ({ page }) => {
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]!.page;

      // WHEN — the order's own page, its next step Mark Handed Over.
      await page.goto(`/warehouse-orders/${orderId}`);
      await expect(page.getByTestId("order-status-5")).toBeVisible();
      const advance = page.getByTestId("pick-order-advance");
      await expect(advance).toContainText("Mark Handed Over");
      const [answer] = await Promise.all([
        page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
        advance.click(),
      ]);

      await test.step("then: status changed from picked to shipping", async () => {
        expect.soft(answer.status()).toBe(200);
        await expect.soft(page.getByTestId("order-status-6")).toBeVisible();
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_SHIPPING");
        await expectOnHandoverTab(page, orderId, refOf(r.key, "page"));
      });
    });
  }

  // Its own test per role, LAST in the file: each moves one order of the role's own shop (see the head of this file).
  for (const r of ROLES) {
    test(`${r.given} hand over order (${COND_ONE}): hand over recorded in analytic metric`, async ({ page }) => {
      await installEar(page);
      await signIn(page, username(r.key), ground.warehouse);
      const [orderId, left] = ground.metricOrders[r.key]!;
      const shop = ground.metricShops[r.key]!;
      const code = metricReceipts(r.key)[0];
      expect(await statusOf(page, ground.warehouse, orderId!)).toBe("ORDER_STATUS_PICKED");

      // WHEN — Orders › Scan Handover (bulk handover off), ONE of the shop's two parcels scanned. The other stays picked.
      await openHandover(page, false);
      await scan(page, code);
      await expect(entry(page, code)).toHaveAttribute("data-state", "handedOver");
      expect(await statusOf(page, ground.warehouse, orderId!)).toBe("ORDER_STATUS_SHIPPING");
      expect(await statusOf(page, ground.warehouse, left!)).toBe("ORDER_STATUS_PICKED");

      await test.step("then: hand over recorded in analytic metric", async () => {
        // Order status moves is offered under Order, and the shop's Handed over reads the ONE hand over.
        await expectMovesOffered(page);
        await expectMoveCounted(page, shop, "handed_over_count");
      });
    });
  }
});

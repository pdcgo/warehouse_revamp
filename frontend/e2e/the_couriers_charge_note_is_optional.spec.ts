import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { listLanded } from "./pickers";
import { SUFFIX, api } from "./restock_helpers";

// THE COURIER'S CHARGE NEEDS NO NOTE — a charge typed with *What it was for* left empty SAVES at every site that asks
// for it, end to end on the real server and Postgres (backlog #146). A regression spec: no acceptance rows (order.md #81
// and return.md #11 — a charge WITH a note — still hold, in their own specs).
//
//   the-couriers-charge-note-is-optional (docs/business/balance/context_decision.md) — owner: *"and note "what it was
//     for" is optional too"*. A charge above 0 with no note is saved, at the arrival and at the accept alike: a restock's
//     Set Arrived and accept, a reshipping's Set Arrived and count-in, a warehouse transfer's accept, a return's accept.
//     The screens stop holding the save back (the shared courier form says *(optional)*, no error under it), the
//     services stop refusing, and a line that words the charge names the amount alone — *courier's charge Rp 8.000*, no
//     trailing dash or colon; a note given reads as before.
//   an-arrival-is-set-arrived (docs/technical/frontend/context_decision.md) — owner: *"in delivery accept, sign for box
//     is ambigue, change set arrived"*: the restock's arrival button reads **Set Arrived**, its dialog *Set Arrived —
//     Restock #<id>*, and the trail's new arrival rows say *set arrived* (pinned once, on the restock's site).
//
// Per site, ONE test: type the amount, leave the note empty — the `*-note-optional` marker shows where the shared form
// is used, no note error, the save is enabled — save, read the request it sent, the record back (the detail RPC), and
// the screen; where a line words the charge it reads the amount alone.
//
// THE GROUND (beforeAll, root through the API — every code carries SUFFIX): a selling team NQS…; warehouse W (NQW…) the
// restocks and reshippings come to, the team's return warehouse and the transfer's B, with a rack and STAFF (Nanda, who
// acts at every warehouse site but the transfer's: transfers.spec.ts acts as root, the warehouses' owner); warehouse A
// (NQA…) holding the team's stock on its rack, which ships the returned order and sends the transfer. One product.

const PASSWORD = "e2e-nq-optional-1";
const STAFF = `e2enqstaff${SUFFIX}`;
const RESTOCKS = "inventory.v1.RestockRequestService";
const PARCELS = "inventory.v1.CustomShipmentService";
const TRANSFERS = "inventory.v1.WarehouseTransferService";
const ORDERS = "selling.v1.OrderService";

// The amounts — each site its own, so a figure read back can only be that site's.
const SIGN_CHARGE = 8_000;
const ACCEPT_CHARGE = 9_000;
const ARRIVE_CHARGE = 7_000;
const RECEIVE_CHARGE = 6_000;
const TRANSFER_CHARGE = 15_000;
const RETURN_CHARGE = 12_500;

// "Rp 8.000" as the screens and the server's texts write it (a regular or a no-break space after Rp).
const rpText = (n: number) => `Rp\\s?${n.toLocaleString("id-ID").replace(".", "\\.")}`;
const rp = (n: number) => new RegExp(rpText(n));

const ground = {
  seller: "",
  sellerName: `E2E NQ Seller ${SUFFIX}`,
  wh: "", // W
  whA: "", // A
  rack: "",
  rackA: "",
  product: "",
  productCode: "",
  productName: `E2E NQ Lampu ${SUFFIX}`,
  // restocks at W, by site
  sign: "",
  accept: "",
  // reshipping parcels at W, by site
  arriveParcel: "",
  receiveParcel: "",
  transfer: "",
  order: "",
  orderItem: "",
};

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// A person signed in on `page`, working in `teamId`.
async function as(page: Page, username: string, password: string, teamId: string) {
  await signIn(page, username, password);
  await useTeam(page, teamId);
}

// The JSON a screen sent with its save — a proto3 empty string is left out, so a missing note reads "".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sentOf = (res: Response) => res.request().postDataJSON() as any;

// An answer of `method` the page waits for while `act` runs.
async function saved(page: Page, method: string, act: () => Promise<void>): Promise<Response> {
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith(`/warehouse.${method}`)), act()]);
  expect(res.status(), await res.text()).toBe(200);

  return res;
}

// A RackSelect inside `scope`: open it once its list has landed, click the rack.
async function pickRack(scope: Locator, rack: string) {
  await listLanded(scope.getByTestId(`rack-select-option-${rack}`));
  await scope.getByTestId("rack-select").click();
  await scope.getByTestId(`rack-select-option-${rack}`).click();
}

// The shared courier form (CourierCharge) after Ada and an amount: the note empty, said optional, no error under it.
async function noteLeftEmpty(page: Page, prefix: string) {
  await expect(page.getByTestId(`${prefix}-note`)).toHaveValue("");
  await expect(page.getByTestId(`${prefix}-note-optional`)).toBeVisible();
  await expect(page.getByTestId(`${prefix}-note-optional`)).toHaveText("(optional)");
  await expect(page.getByTestId(`${prefix}-note-error`)).toHaveCount(0);
}

// The restock's trail rows that are status moves, read on its page (`restock-timeline-<id>` carries data-kind).
const statusRows = (page: Page) => page.locator('[data-testid^="restock-timeline-"][data-kind="status"]');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function restockDetail(page: Page, id: string): Promise<any> {
  return (await api(page, `${RESTOCKS}/RestockRequestDetail`, { teamId: ground.wh, requestId: id })).request;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parcelDetail(page: Page, id: string): Promise<any> {
  return (await api(page, `${PARCELS}/CustomShipmentDetail`, { teamId: ground.wh, id })).customShipment;
}

async function seed(browser: Browser) {
  const root = await browser.newPage();
  await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(root, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.seller = await team(ground.sellerName, `NQS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.wh = await team(`E2E NQ Gudang W ${SUFFIX}`, `NQW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  ground.whA = await team(`E2E NQ Gudang A ${SUFFIX}`, `NQA${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await api(root, "user.v1.UserService/CreateUser", { teamId: ground.wh, username: STAFF, password: PASSWORD, name: STAFF, role: "ROLE_WAREHOUSE_STAFF" });

  const rack = async (teamId: string, code: string) =>
    String((await api(root, "inventory.v1.RackService/RackCreate", { teamId, code, name: code })).rack.id);
  ground.rack = await rack(ground.wh, `nq-w-${SUFFIX}`);
  ground.rackA = await rack(ground.whA, `nq-a-${SUFFIX}`);

  const category = (await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E NQ Cat ${SUFFIX}` })).category.id;
  const product = (
    await api(root, "product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `NQP${SUFFIX}`,
      name: ground.productName,
      categoryId: category,
    })
  ).product;
  ground.product = String(product.id);
  ground.productCode = String(product.productCode);

  const account = String(
    (
      await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E NQ Kas ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-NQ-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: ground.seller, accountId: account, operational: true });

  // A restock of `count` × Rp 10.000 to `warehouse` — its id and its one line's id.
  const raise = async (key: string, warehouse: string, count: number) => {
    const request = (
      await api(root, `${RESTOCKS}/RestockRequestCreate`, {
        teamId: ground.seller,
        warehouseId: warehouse,
        financeAccountId: account,
        receipt: `E2E-NQ-${key}-${SUFFIX}`,
        items: [{ productId: ground.product, productCode: ground.productCode, name: ground.productName, count, total: count * 10_000 }],
      })
    ).request;

    return { id: String(request.id), item: String(request.items[0].id) };
  };
  const accept = async (r: { id: string; item: string }, warehouse: string, rackId: string, count: number, broken = 0) =>
    api(root, `${RESTOCKS}/RestockRequestAccept`, {
      teamId: warehouse,
      requestId: r.id,
      lines: [
        {
          itemId: r.item,
          receivedCount: count,
          ...(broken > 0 ? { brokenCount: broken, brokenNote: "pecah di jalan" } : {}),
          placements: [{ placementId: rackId, quantity: count - broken }],
        },
      ],
    });

  // A's stock: 10 on its rack — the returned order's unit and the transfer's two come from it.
  await accept(await raise("STOCK", ground.whA, 10), ground.whA, ground.rackA, 10);

  // Restock Set Arrived: on its way. Restock accept: set arrived with NO charge, so Terima opens on none.
  ground.sign = (await raise("SIGN", ground.wh, 5)).id;
  ground.accept = (await raise("ACCEPT", ground.wh, 5)).id;
  await api(root, `${RESTOCKS}/RestockRequestArrive`, { teamId: ground.wh, requestId: ground.accept });

  // Two reshippings, each from a restock accepted with 1 broken: one on its way (Set Arrived), one set arrived with no
  // charge (count-in).
  const channels = await api(root, "shipment.v1.ShipmentChannelService/ShipmentChannelList", {
    dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"],
    page: { page: 1, limit: 100 },
  });
  const map = (channels.items as { channel?: { mapData: Record<string, { code: string }> } }[]).find((i) => i.channel)?.channel?.mapData;
  const jne = Object.entries(map ?? {}).find(([, c]) => c.code === "jne")?.[0] ?? "";
  expect(jne, "the seeded jne courier").toBeTruthy();
  const reship = async (key: string) => {
    const r = await raise(key, ground.wh, 4);
    await accept(r, ground.wh, ground.rack, 4, 1);
    const res = await api(root, `${RESTOCKS}/RestockResolutionCreate`, {
      teamId: ground.seller,
      restockId: r.id,
      type: "RESTOCK_RESOLUTION_TYPE_RESHIPPING",
      note: `kirim ulang ${key}`,
      reshipping: { shipmentChannelId: jne, lines: [{ productId: ground.product, count: "1", priceUnit: 10_000 }] },
      idempotencyKey: `e2e-nq-${key}-${SUFFIX}`,
    });

    return String(res.customShipment.id);
  };
  ground.arriveParcel = await reship("RS1");
  ground.receiveParcel = await reship("RS2");
  await api(root, `${PARCELS}/CustomShipmentArrive`, { teamId: ground.wh, id: ground.receiveParcel, doorCharge: 0 });

  // The transfer: 2 units from A to W, confirmed and shipped by A — at W's door.
  ground.transfer = String(
    (
      await api(root, `${TRANSFERS}/WarehouseTransferCreate`, {
        teamId: ground.seller,
        fromWarehouseId: ground.whA,
        toWarehouseId: ground.wh,
        lines: [{ productId: ground.product, count: "2" }],
      })
    ).transfer.id,
  );
  await api(root, `${TRANSFERS}/WarehouseTransferProcess`, { teamId: ground.whA, transferId: ground.transfer });
  await api(root, `${TRANSFERS}/WarehouseTransferShip`, { teamId: ground.whA, transferId: ground.transfer, receipt: `JNQ${SUFFIX}` });

  // The return: the team returns to W; one order of 1 unit shipped by A, walked to the courier and claimed back.
  await api(root, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: ground.seller, warehouseId: ground.wh });
  for (const wh of [ground.whA, ground.wh]) {
    await api(root, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wh, feePercent: 1, minFee: 0 });
  }
  const shop = String(
    (await api(root, "selling.v1.ShopService/ShopCreate", { teamId: ground.seller, name: `E2E NQ Shop ${SUFFIX}`, shopCode: `NQH${SUFFIX}`, marketplace: "MARKETPLACE_SHOPEE" }))
      .shop.id,
  );
  await api(root, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: shop, userId: ROOT_USER_ID });
  const placed = await api(root, `${ORDERS}/OrderCreate`, {
    idempotencyKey: `e2e-nq-return-${SUFFIX}`,
    shipmentChannelId: "1",
    teamId: ground.seller,
    shopId: shop,
    warehouseId: ground.whA,
    customerName: `E2E NQ Buyer ${SUFFIX}`,
    platformTotal: 100_000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `NQ${SUFFIX}RET`,
    receiptCode: `JQNQ${SUFFIX}`,
    items: [{ productId: ground.product, productCode: ground.productCode, name: ground.productName, quantity: 1 }],
  });
  ground.order = String(placed.order.id);
  ground.orderItem = String(placed.order.items[0].id);
  const move = async (teamId: string, to: string) => {
    const res = await api(root, `${ORDERS}/OrderStatusChange`, { teamId, orderIds: [ground.order], to: `ORDER_STATUS_${to}` });
    expect(res.results[0]?.moved, `${ground.order} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
  };
  for (const s of ["PROCESSED", "PICKED", "SHIPPING"]) await move(ground.whA, s);
  await move(ground.seller, "RETURN");

  await root.close();
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await seed(browser);
});

test.describe("the courier's charge with no note saves at every site (the-couriers-charge-note-is-optional)", () => {
  test("restock Set Arrived: the button and dialog say Set Arrived; Rp 8.000 with no note is set arrived and kept, the page shows the amount alone", async ({
    page,
  }) => {
    const id = ground.sign;
    await as(page, STAFF, PASSWORD, ground.wh);

    await test.step("regression: the restock's arrival is called Set Arrived — on its row, its page and its dialog", async () => {
      await page.goto("/inventories/restock?status=all");
      await expect(page.getByTestId("restock-inbound-page")).toBeVisible();
      const row = page.getByTestId(`restock-row-${id}`);
      await expect(row.getByTestId("restock-status-1")).toBeVisible();
      await expect(row.getByTestId(`restock-action-sign-${id}`)).toHaveText("Set Arrived");

      await page.goto(`/inventories/restock/${id}`);
      await expect(page.getByTestId("restock-detail-page")).toBeVisible();
      await expect(page.getByTestId(`restock-action-sign-${id}`)).toHaveText("Set Arrived");
      await page.getByTestId(`restock-action-sign-${id}`).click();
      await expect(page.getByRole("alertdialog", { name: `Set Arrived — Restock #${id}`, exact: true })).toBeVisible();
      await expect(page.getByTestId("confirm-action")).toHaveText("Set Arrived");
    });

    await test.step("regression: Ada, the amount typed, the note left empty — said optional, no error, Set Arrived enabled", async () => {
      await page.getByTestId("sign-courier-asked-yes").click();
      await page.getByTestId("sign-courier-charge").fill(String(SIGN_CHARGE));
      await noteLeftEmpty(page, "sign-courier");
      await expect(page.getByTestId("confirm-action")).toBeEnabled();
    });

    await test.step("regression: it saves — the charge sent and kept with no note", async () => {
      const res = await saved(page, `${RESTOCKS}/RestockRequestArrive`, () => page.getByTestId("confirm-action").click());
      const sent = sentOf(res);
      expect(Number(sent.warehouseAdditionalCost)).toBe(SIGN_CHARGE);
      expect(sent.warehouseAdditionalCostNote ?? "").toBe("");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);

      const kept = await restockDetail(page, id);
      expect(kept.status).toBe("RESTOCK_REQUEST_STATUS_ARRIVED");
      expect(kept.warehouseAdditionalCost).toBe(SIGN_CHARGE);
      expect(kept.warehouseAdditionalCostNote ?? "").toBe("");
    });

    await test.step("regression: the page shows the amount, an empty note and the noted line; the trail's new row says set arrived", async () => {
      await page.goto(`/inventories/restock/${id}`);
      await expect(page.getByTestId("restock-detail-page")).toBeVisible();
      await expect(page.getByTestId("restock-detail-courier-charge")).toHaveText(new RegExp(`^${rpText(SIGN_CHARGE)}$`));
      await expect(page.getByTestId("restock-detail-courier-charge-note")).toHaveText("");
      await expect(page.getByTestId("restock-detail-courier-charge-owed")).toContainText("Noted by this warehouse when the box was set arrived");

      const arrived = statusRows(page).filter({ hasText: "Set arrived" });
      await expect(arrived).toHaveCount(1);
      await expect(arrived.locator('[data-testid$="-description"]')).toHaveText("set arrived");
    });
  });

  test("restock accept: Rp 9.000 with no note — Terima enabled, accepted and kept; the trail names the amount alone", async ({ page }) => {
    const id = ground.accept;
    const pid = ground.product;
    await as(page, STAFF, PASSWORD, ground.wh);

    await page.goto(`/inventories/restock/${id}/accept`);
    await expect(page.getByTestId(`accept-line-${pid}`)).toBeVisible();
    // Set arrived with no charge, so Terima opens on none.
    await expect(page.getByTestId("accept-courier-none")).toBeVisible();

    await test.step("regression: everything counted in, then Ada, the amount typed, the note left empty — optional, no error", async () => {
      await page.getByTestId(`accept-all-arrived-${pid}`).click();
      await pickRack(page.getByTestId(`accept-placement-${pid}-0`), ground.rack);
      await expect(page.getByTestId(`accept-balanced-${pid}`)).toBeVisible();

      await page.getByTestId("accept-courier-edit").click();
      await page.getByTestId("accept-courier-asked-yes").click();
      await page.getByTestId("accept-courier-charge").fill(String(ACCEPT_CHARGE));
      await noteLeftEmpty(page, "accept-courier");
      // Terima no longer waits for the note — enabled with the form still open, and Done closes it on the amount alone.
      await expect(page.getByTestId("accept-submit")).toBeEnabled();
      await expect(page.getByTestId("accept-courier-done")).toBeEnabled();
      await page.getByTestId("accept-courier-done").click();
      await expect(page.getByTestId("accept-courier-owed")).toHaveText(new RegExp(`^${rpText(ACCEPT_CHARGE)}$`));
      // No note, so the line under it is who owes it back — no "<note> · " in front.
      await expect(page.getByTestId("accept-courier-paid-line")).toHaveText(/^Owed back by \S/);
      await expect(page.getByTestId("accept-courier-paid-line")).not.toContainText("·");
      await expect(page.getByTestId("accept-submit")).toBeEnabled();
    });

    await test.step("regression: it saves — accepted with the charge and no note", async () => {
      await page.getByTestId("accept-submit").click();
      const res = await saved(page, `${RESTOCKS}/RestockRequestAccept`, () => page.getByTestId("confirm-action").click());
      const sent = sentOf(res);
      expect(Number(sent.warehouseAdditionalCost)).toBe(ACCEPT_CHARGE);
      expect(sent.warehouseAdditionalCostNote ?? "").toBe("");
      await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));

      const kept = await restockDetail(page, id);
      expect(kept.status).toBe("RESTOCK_REQUEST_STATUS_ACCEPTED");
      expect(kept.warehouseAdditionalCost).toBe(ACCEPT_CHARGE);
      expect(kept.warehouseAdditionalCostNote ?? "").toBe("");
    });

    await test.step("regression: the page shows the amount alone; the accept's trail row reads the charge with no dash after it", async () => {
      await page.reload();
      await expect(page.getByTestId("restock-detail-page")).toBeVisible();
      await expect(page.getByTestId("restock-detail-courier-charge")).toHaveText(new RegExp(`^${rpText(ACCEPT_CHARGE)}$`));
      await expect(page.getByTestId("restock-detail-courier-charge-note")).toHaveText("");

      const counted = statusRows(page).filter({ hasText: "Counted in" });
      await expect(counted).toHaveCount(1);
      await expect(counted.locator('[data-testid$="-description"]')).toHaveText(
        new RegExp(`^accepted — 0 broken, 0 missing; courier's charge ${rpText(ACCEPT_CHARGE)}$`),
      );
    });
  });

  test("reshipping Set Arrived: Rp 7.000 with no note is set arrived and kept; the charge line and the trail name the amount alone", async ({ page }) => {
    const parcel = ground.arriveParcel;
    await as(page, STAFF, PASSWORD, ground.wh);

    await test.step("regression: Set Arrived from its Restok Masuk row — Ada, the amount, the note left empty: optional, no error", async () => {
      await page.goto("/inventories/restock?status=ongoing");
      const row = page.getByTestId(`inbound-row-${parcel}`);
      await expect(row.getByTestId("inbound-status-on_the_way")).toBeVisible();
      await row.getByTestId(`inbound-action-sign-${parcel}`).click();
      await expect(page.getByRole("alertdialog", { name: `Set Arrived — Reshipping #${parcel}`, exact: true })).toBeVisible();
      await page.getByTestId("inbound-sign-courier-asked-yes").click();
      await page.getByTestId("inbound-sign-courier-charge").fill(String(ARRIVE_CHARGE));
      await noteLeftEmpty(page, "inbound-sign-courier");
      await expect(page.getByTestId("confirm-action")).toBeEnabled();
    });

    await test.step("regression: it saves — the charge sent and kept with no note", async () => {
      const res = await saved(page, `${PARCELS}/CustomShipmentArrive`, () => page.getByTestId("confirm-action").click());
      const sent = sentOf(res);
      expect(Number(sent.doorCharge)).toBe(ARRIVE_CHARGE);
      expect(sent.doorChargeNote ?? "").toBe("");

      const kept = await parcelDetail(page, parcel);
      expect(kept.status).toBe("CUSTOM_SHIPMENT_STATUS_ARRIVED");
      expect(kept.shippingCost).toBe(ARRIVE_CHARGE);
      expect(kept.chargeNote ?? "").toBe("");
      // The trail's arrival row words the charge: the amount alone, no " — " after it.
      const arrivedLog = ((kept.logs ?? []) as { toStatus?: string; description?: string }[]).filter((l) => l.toStatus === "CUSTOM_SHIPMENT_STATUS_ARRIVED");
      expect(arrivedLog, JSON.stringify(kept.logs)).toHaveLength(1);
      expect(arrivedLog[0]!.description ?? "").toMatch(new RegExp(`^courier's charge ${rpText(ARRIVE_CHARGE)}$`));
    });

    await test.step("regression: its page shows the amount, and the charge line starts at its meaning — no dangling dash", async () => {
      await page.goto(`/inventories/custom-shipments/in/${parcel}`);
      await expect(page.getByTestId("inbound-detail-page")).toHaveAttribute("data-side", "warehouse");
      await expect(page.getByTestId("inbound-status-arrived")).toBeVisible();
      await expect(page.getByTestId("inbound-door-charge")).toContainText(rp(ARRIVE_CHARGE));
      await expect(page.getByTestId("inbound-door-charge-line")).toHaveText("noted at Tiba — final at count-in");
    });
  });

  test("reshipping count-in: Rp 6.000 with no note — Count In enabled, received and kept; the charge line and the trail name the amount alone", async ({
    page,
  }) => {
    const parcel = ground.receiveParcel;
    const pid = ground.product;
    await as(page, STAFF, PASSWORD, ground.wh);

    const dialog = page.getByTestId("inbound-receive-dialog");
    await test.step("regression: Count In — the unit onto the rack, then Ada, the amount, the note left empty: optional, no error", async () => {
      await page.goto("/inventories/restock?status=arrived");
      const row = page.getByTestId(`inbound-row-${parcel}`);
      await expect(row.getByTestId("inbound-status-arrived")).toBeVisible();
      await row.getByTestId(`inbound-action-receive-${parcel}`).click();
      await expect(dialog).toBeVisible();
      await dialog.getByTestId(`inbound-received-${pid}`).fill("1");
      await listLanded(dialog.getByTestId(`rack-select-option-${ground.rack}`));
      await dialog.getByTestId(`inbound-rack-${pid}`).click();
      await dialog.getByTestId(`rack-select-option-${ground.rack}`).click();
      await expect(dialog.getByTestId(`inbound-short-${pid}`)).toHaveText("1 good to the rack · 0 short");

      await dialog.getByTestId("inbound-receive-courier-asked-yes").click();
      await dialog.getByTestId("inbound-receive-courier-charge").fill(String(RECEIVE_CHARGE));
      await noteLeftEmpty(page, "inbound-receive-courier");
      await expect(dialog.getByTestId("inbound-receive-confirm")).toBeEnabled();
    });

    await test.step("regression: it saves — received with the charge and no note", async () => {
      const res = await saved(page, `${PARCELS}/CustomShipmentReceive`, () => dialog.getByTestId("inbound-receive-confirm").click());
      const sent = sentOf(res);
      expect(Number(sent.doorCharge)).toBe(RECEIVE_CHARGE);
      expect(sent.doorChargeNote ?? "").toBe("");
      await expect(dialog).toHaveCount(0);

      const kept = await parcelDetail(page, parcel);
      expect(kept.status).toBe("CUSTOM_SHIPMENT_STATUS_RECEIVED");
      expect(kept.shippingCost).toBe(RECEIVE_CHARGE);
      expect(kept.chargeNote ?? "").toBe("");
      // The count-in's trail row: what was counted, then the charge — the amount alone.
      const receivedLog = ((kept.logs ?? []) as { toStatus?: string; description?: string }[]).filter((l) => l.toStatus === "CUSTOM_SHIPMENT_STATUS_RECEIVED");
      expect(receivedLog, JSON.stringify(kept.logs)).toHaveLength(1);
      expect(receivedLog[0]!.description ?? "").toMatch(new RegExp(`^received — 0 broken, 0 short; courier's charge ${rpText(RECEIVE_CHARGE)}$`));
    });

    await test.step("regression: its page shows the amount, and the charge line starts at its meaning — no dangling dash", async () => {
      await page.goto(`/inventories/custom-shipments/in/${parcel}`);
      await expect(page.getByTestId("inbound-detail-page")).toHaveAttribute("data-side", "warehouse");
      await expect(page.getByTestId("inbound-status-received")).toBeVisible();
      await expect(page.getByTestId("inbound-door-charge")).toContainText(rp(RECEIVE_CHARGE));
      await expect(page.getByTestId("inbound-door-charge-line")).toHaveText(/^paid by this warehouse at the door; .+ owes it back$/);
    });
  });

  test("warehouse transfer accept: Rp 15.000 with no note — Accept enabled, counted in and kept; the page shows the amount alone", async ({ page }) => {
    const id = ground.transfer;
    await as(page, ROOT_USERNAME, ROOT_PASSWORD, ground.wh);
    const item = String(
      ((await api(page, `${TRANSFERS}/WarehouseTransferDetail`, { teamId: ground.wh, transferId: id })).transfer.items as { id: string }[])[0]!.id,
    );

    await test.step("regression: both units counted onto W's rack, the charge typed, the note left empty — no error, Accept enabled", async () => {
      await page.goto(`/inventories/transfer/${id}/accept`);
      await expect(page.getByTestId("accept-page")).toBeVisible();
      await page.getByTestId(`accept-line-${item}-arrived`).fill("2");
      await pickRack(page.getByTestId(`accept-line-${item}-placements`), ground.rack);
      await page.getByTestId(`accept-line-${item}-placement-0-qty`).fill("2");

      await page.getByTestId("accept-charge-amount").fill(String(TRANSFER_CHARGE));
      const note = page.getByTestId("accept-charge-note");
      await expect(note).toHaveValue("");
      // Its field no longer turns invalid (the-couriers-charge-note-is-optional) — the page has no error id of its own.
      await expect(note).not.toHaveAttribute("aria-invalid", "true");
      await expect(page.getByTestId("accept-submit")).toBeEnabled();
    });

    await test.step("regression: it saves — accepted with the charge and no note", async () => {
      await page.getByTestId("accept-submit").click();
      const res = await saved(page, `${TRANSFERS}/WarehouseTransferAccept`, () => page.getByTestId("confirm-action").click());
      const sent = sentOf(res);
      expect(Number(sent.warehouseAdditionalCost)).toBe(TRANSFER_CHARGE);
      expect(sent.warehouseAdditionalCostNote ?? "").toBe("");
      await expect(page).toHaveURL(new RegExp(`/inventories/transfer/${id}$`));

      const kept = (await api(page, `${TRANSFERS}/WarehouseTransferDetail`, { teamId: ground.wh, transferId: id })).transfer;
      expect(kept.status).toBe("WAREHOUSE_TRANSFER_STATUS_ACCEPTED");
      expect(kept.warehouseAdditionalCost).toBe(TRANSFER_CHARGE);
      expect(kept.warehouseAdditionalCostNote ?? "").toBe("");
    });

    await test.step("regression: the transfer's page shows the charge — the amount alone", async () => {
      await page.reload();
      await expect(page.getByTestId("transfer-detail-on-site")).toHaveText(new RegExp(`^${rpText(TRANSFER_CHARGE)}$`));
    });
  });

  test("return accept: Rp 12.500 with no note — Accept enabled, the return completed and the charge kept; its timeline row names the amount alone", async ({
    page,
  }) => {
    const orderId = ground.order;
    const itemId = ground.orderItem;
    await as(page, STAFF, PASSWORD, ground.wh);

    await test.step("regression: the unit onto W's rack, the charge typed, the note left empty — no error, ready, Accept enabled", async () => {
      await page.goto(`/warehouse-orders/${orderId}`);
      const open = page.getByTestId("pick-order-accept-return");
      await expect(open).toBeVisible({ timeout: 15_000 });
      await open.click();
      await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}/accept-return$`));
      await expect(page.getByTestId(`return-accept-line-${itemId}`)).toBeVisible({ timeout: 15_000 });
      await pickRack(page.getByTestId(`return-accept-rack-${itemId}-0`), ground.rack);

      await page.getByTestId("return-accept-charge").fill(String(RETURN_CHARGE));
      const note = page.getByTestId("return-accept-charge-note");
      await expect(note).toHaveValue("");
      await expect(note).not.toHaveAttribute("aria-invalid", "true");
      await expect(page.getByTestId("return-accept-charge-note-error")).toHaveCount(0);
      // The unfinished-lines message is gone and nothing else holds it: the note no longer does.
      await expect(page.getByTestId("return-accept-progress")).toHaveCount(0);
      await expect(page.getByTestId("return-accept-ready")).toBeVisible();
      await expect(page.getByTestId("return-accept-submit")).toBeEnabled();
    });

    await test.step("regression: it saves — the return completed, the charge sent with no note", async () => {
      await page.getByTestId("return-accept-submit").click();
      const res = await saved(page, `${ORDERS}/OrderReturnAccept`, () => page.getByTestId("confirm-action").click());
      const sent = sentOf(res);
      expect(Number(sent.courierCharge)).toBe(RETURN_CHARGE);
      expect(sent.courierChargeNote ?? "").toBe("");
      await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}$`));

      type Log = { status?: string; note?: string };
      const order = (await api(page, `${ORDERS}/OrderDetail`, { teamId: ground.wh, orderId })).order as { status: string; timelineLogs?: Log[] };
      expect(order.status).toBe("ORDER_STATUS_RETURN_COMPLETED");
      // The accept's own row carries the charge as its note: the amount alone, no ": " after it.
      const accepted = (order.timelineLogs ?? []).filter((l) => l.status === "ORDER_STATUS_RETURN_COMPLETED");
      expect(accepted, JSON.stringify(order.timelineLogs)).toHaveLength(1);
      expect(accepted[0]!.note ?? "").toMatch(new RegExp(`^Courier charge ${rpText(RETURN_CHARGE)}$`));
    });

    await test.step("regression: the order's timeline shows that row — Courier charge and the amount, nothing after it", async () => {
      await page.goto(`/orders/${orderId}`);
      await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("order-detail-tab-timeline").click();
      await expect(page.getByTestId("order-detail-timeline")).toBeVisible();
      await expect(page.getByTestId("order-timeline-return_completed")).toHaveCount(1);
      await expect(page.getByTestId("order-timeline-return_completed-note")).toHaveText(new RegExp(`^Courier charge ${rpText(RETURN_CHARGE)}$`));
    });
  });
});

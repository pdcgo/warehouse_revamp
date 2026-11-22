import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";

// THE SUPPLIER'S RESHIPPING COMES IN — an INBOUND custom shipment, end to end on the real server, Postgres and the Pub/Sub
// emulator (backlog #101, phase 1 backend + phase 2 screens). A regression spec: no acceptance rows. The rules:
//
//   docs/business/custom_shipments/context_decision.md#a-suppliers-reshipping-comes-in-as-a-custom-shipment (+ its 🔄) —
//     recording a `reshipping` resolution creates its inbound parcel in the same step, by the selling team: lines
//     (product, count, the seller's price), the courier, an optional resi, the warehouse it comes to (opening on the
//     restock's); it arrives Tiba → Terima, or ends Hilang; the resi is editable until Tiba, the price until Terima, and
//     typing it moves NO money; good units enter stock at the seller's price; the courier's charge at the door is the
//     restock's (noted at Tiba, final at Terima, owed back through Team Balance — `custom_shipment_fee`); the warehouse
//     reads no seller price (a-warehouse-sees-no-seller-money);
//   docs/business/inventory/restock_decision.md#a-restock-problem-is-settled-by-resolution-rows — its 🔄 *a late
//     shortfall reopens a settled restock*: a short / broken Terima lifts *Selesai* and puts the matching tag back on;
//     🔄 *the restock's history keeps every settle and reopen* (Riwayat `data-kind` resolution / settled / reopened);
//   docs/technical/frontend/restock_decision.md#the-restock-resolutions-prototype-is-accepted — Catat Resolusi → Kirim
//     Ulang (its page) / Retur ke Supplier (Paket Baru on *Kirim balik ke supplier*, the `return` row riding the parcel);
//     the inbound parcels at the top of Restok Masuk in their step's tab (a restock-only filter hides them); the seller's
//     Kirim Paket lists them under Semua + a third Kind *Reshipping from supplier*; a warehouse's queue leaves them out.
//
// THE GROUND, all this spec's own (root seeds it through the API): a selling team (ZINS…) and its warehouse (ZINW…) with
// two racks — the shelf every restock's good units went on, and an empty one the main parcel is counted onto; Sari, the
// team's SELLING_ADMIN, and Wawan, the warehouse's STAFF; one product and its supplier; two accounts — one pays the main
// restock alone (so its balance is read undisturbed), the other every other restock. Every restock is 10 × Rp 10.000,
// ACCEPTED with a problem: `main` 2 broken (the reshipping flow, serial), `settle` 2 missing, `lost` 1 broken, `ret` 2
// broken, `list` 2 broken (one each for the independent tests), and `ongoing` — raised, never accepted — the restock row
// the parcel must sit above on Restok Masuk.

const PASSWORD = "e2e-zin-inbound-1";
const SARI = `e2ezinsel${SUFFIX}`;
const WAWAN = `e2ezinwh${SUFFIX}`;
const RESTOCKS = "inventory.v1.RestockRequestService";
const PARCELS = "inventory.v1.CustomShipmentService";
const SUPPLIER = {
  name: `E2E ZIN Pemasok ${SUFFIX}`,
  contact: "0812-7700-4321",
  address: "Jl. Pemasok Ulang No. 3, Bandung",
};
const ORDERED = 10;
const TOTAL = 100_000;
const UNIT = TOTAL / ORDERED; // Rp 10.000 a unit — what the Kirim Ulang page opens its price on
const OPENING = 1_000_000;

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

type Key = "main" | "settle" | "lost" | "ret" | "list";

const ground = {
  seller: "",
  sellerName: `E2E ZIN Seller ${SUFFIX}`,
  warehouse: "",
  warehouseName: `E2E ZIN Gudang ${SUFFIX}`,
  shelf: "",
  inRack: "",
  inRackCode: `zin-in-${SUFFIX}`,
  product: "",
  productCode: "",
  productName: `E2E Lampu Meja ${SUFFIX}`,
  supplier: "",
  account: "",
  spare: "",
  jne: "",
  restocks: {} as Record<Key | "ongoing", string>,
  items: {} as Record<Key | "ongoing", string>,
  // Filled by the serial flow.
  parcel: "",
};

// `user` signed in on `page`, working in `team` (the active team is per tab, in sessionStorage).
async function as(page: Page, user: string, team: string) {
  await login(page, user, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
}

async function pageAs(browser: Browser, user: string, team: string) {
  const page = await browser.newPage();
  await as(page, user, team);

  return page;
}

// A reshipping recorded through the API, as the selling team — its inbound parcel's id.
async function reshipByApi(page: Page, key: Key, count: number, price: number): Promise<string> {
  const res = await api(page, `${RESTOCKS}/RestockResolutionCreate`, {
    teamId: ground.seller,
    restockId: ground.restocks[key],
    type: "RESTOCK_RESOLUTION_TYPE_RESHIPPING",
    note: `kirim ulang ${key}`,
    reshipping: { shipmentChannelId: ground.jne, lines: [{ productId: ground.product, count: String(count), priceUnit: price }] },
    idempotencyKey: `e2e-zin-${key}-${SUFFIX}`,
  });

  return String(res.customShipment.id);
}

async function openRestock(page: Page, id: string) {
  await page.goto(`/inventories/restock/${id}`);
  await expect(page.getByTestId("restock-detail-page")).toBeVisible();
}

async function openParcel(page: Page, id: string, side: "selling" | "warehouse") {
  await page.goto(`/inventories/custom-shipments/in/${id}`);
  await expect(page.getByTestId("inbound-detail-page")).toHaveAttribute("data-side", side);
}

// The restock's resolution rows of one type (each row carries `data-type`; its parts are `resolution-row-<id>-…`).
const resolutionRows = (page: Page, type: "RESHIPPING" | "RETURN") =>
  page.getByTestId("restock-detail-resolutions-section").locator(`[data-testid^="resolution-row-"][data-type="${type}"]`);

const timeline = (page: Page, kind: string) => page.locator(`[data-testid^="restock-timeline-"][data-kind="${kind}"]`);

// The account's balance as its page shows it, once `text` is in its history (the restock's payment posts by event).
async function accountOnceRecorded(page: Page, accountId: string, text: string) {
  let balance = "";
  let rows = 0;
  await expect(async () => {
    await page.goto(`/financial-accounts/${accountId}`);
    await expect(page.getByTestId("account-log-table")).toContainText(text, { timeout: 3_000 });
    const shown = page.getByTestId("account-detail-balance");
    await expect(shown).toHaveText(/\d/, { timeout: 3_000 });
    balance = (await shown.innerText()).trim();
    rows = await page.locator('[data-testid^="account-log-row-"]').count();
  }).toPass({ timeout: 45_000 });

  return { balance, rows };
}

// The seller money a warehouse reader must never receive — proto3 JSON leaves an unset field out, so a key present is a
// value sent.
function priceKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => priceKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [...(k === "priceUnit" ? [`${path}.${k}`] : []), ...priceKeys(v, `${path}.${k}`)]);
  }

  return [];
}

// The selling team's Team Balance entries for one parcel's courier charge (custom_shipment_fee), as the ledger holds them.
async function parcelFees(page: Page, parcel: string) {
  type Log = { sourceType: string; sourceId?: string };
  const ledger = await api(page, "liability.v1.LiabilityService/LiabilityLogList", {
    teamId: ground.seller,
    filter: { counterpartyId: ground.warehouse },
    page: { page: 1, limit: 200 },
  });
  const logs = Object.values(
    ((ledger.items ?? []) as { log?: { mapData: Record<string, Log> } }[]).find((it) => it.log)?.log?.mapData ?? {},
  );

  return logs.filter((l) => l.sourceType === "LIABILITY_SOURCE_TYPE_CUSTOM_SHIPMENT_FEE" && String(l.sourceId) === parcel);
}

// TERIMA from the warehouse's Restok Masuk (Tiba's tab): `received` of what was sent, the good ones onto `rack`.
async function countIn(door: Page, parcel: string, received: number, rack: string, shortLine: string) {
  const pid = ground.product;
  await door.goto("/inventories/restock?status=arrived");
  const row = door.getByTestId(`inbound-row-${parcel}`);
  await expect(row.getByTestId("inbound-status-arrived")).toBeVisible();
  await row.getByTestId(`inbound-action-receive-${parcel}`).click();
  const dialog = door.getByTestId("inbound-receive-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId(`inbound-received-${pid}`).fill(String(received));
  await dialog.getByTestId(`inbound-rack-${pid}`).click();
  await dialog.getByTestId(`rack-select-option-${rack}`).click();
  await expect(dialog.getByTestId(`inbound-short-${pid}`)).toHaveText(shortLine);
  const [res] = await Promise.all([
    door.waitForResponse((r) => r.url().endsWith(`/warehouse.${PARCELS}/CustomShipmentReceive`)),
    dialog.getByTestId("inbound-receive-confirm").click(),
  ]);
  expect(res.status(), await res.text()).toBe(200);
  await expect(dialog).toHaveCount(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.request().postDataJSON() as any;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const root = await browser.newPage();
  await login(root, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(root, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.seller = await team(ground.sellerName, `ZINS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(ground.warehouseName, `ZINW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const rack = async (code: string, name: string) =>
    String((await api(root, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code, name })).rack.id);
  ground.shelf = await rack(`zin-shelf-${SUFFIX}`, "E2E ZIN shelf");
  ground.inRack = await rack(ground.inRackCode, "E2E ZIN reshipping shelf");

  const user = (teamId: string, username: string, role: string) =>
    api(root, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name: username, role });
  await user(ground.seller, SARI, "ROLE_SELLING_ADMIN");
  await user(ground.warehouse, WAWAN, "ROLE_WAREHOUSE_STAFF");

  const category = (await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E ZIN Cat ${SUFFIX}` })).category.id;
  const product = await api(root, "product.v1.ProductService/ProductCreate", {
    teamId: ground.seller,
    productCodePart: `ZINP${SUFFIX}`,
    name: ground.productName,
    categoryId: category,
  });
  ground.product = String(product.product.id);
  ground.productCode = String(product.product.productCode);
  ground.supplier = String((await api(root, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.seller, ...SUPPLIER })).supplier.id);

  const account = async (tag: string) => {
    const id = String(
      (
        await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E ZIN ${tag} ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-ZIN-${tag}-${SUFFIX}`,
          openingBalance: OPENING,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: ground.seller, accountId: id, operational: true });

    return id;
  };
  ground.account = await account("MAIN");
  ground.spare = await account("SPARE");

  const channels = await api(root, "shipment.v1.ShipmentChannelService/ShipmentChannelList", {
    dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"],
    page: { page: 1, limit: 100 },
  });
  const map = (channels.items as { channel?: { mapData: Record<string, { code: string }> } }[]).find((i) => i.channel)?.channel?.mapData;
  ground.jne = Object.entries(map ?? {}).find(([, c]) => c.code === "jne")?.[0] ?? "";
  expect(ground.jne, "the seeded jne courier").toBeTruthy();

  // The restocks: 10 × Rp 10.000 from the supplier, counted in with their problem (the good units on the shelf).
  const raise = async (key: Key | "ongoing") => {
    const raised = await api(root, `${RESTOCKS}/RestockRequestCreate`, {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
      financeAccountId: key === "main" ? ground.account : ground.spare,
      receipt: `E2E-ZIN-${key.toUpperCase()}-${SUFFIX}`,
      items: [
        { productId: ground.product, productCode: ground.productCode, name: ground.productName, count: ORDERED, total: TOTAL, supplierId: ground.supplier },
      ],
    });
    ground.restocks[key] = String(raised.request.id);
    ground.items[key] = String(raised.request.items[0].id);
  };
  const accept = async (key: Key, problem: { broken: number } | { missing: number }) => {
    const received = "missing" in problem ? ORDERED - problem.missing : ORDERED;
    const broken = "broken" in problem ? problem.broken : 0;
    await api(root, `${RESTOCKS}/RestockRequestAccept`, {
      teamId: ground.warehouse,
      requestId: ground.restocks[key],
      lines: [
        {
          itemId: ground.items[key],
          receivedCount: received,
          ...(broken > 0 ? { brokenCount: broken, brokenNote: "pecah di jalan" } : { missingNote: "tidak ada di kardus" }),
          placements: [{ placementId: ground.shelf, quantity: received - broken }],
        },
      ],
    });
  };
  for (const [key, problem] of [
    ["main", { broken: 2 }],
    ["settle", { missing: 2 }],
    ["lost", { broken: 1 }],
    ["ret", { broken: 2 }],
    ["list", { broken: 2 }],
  ] as const) {
    await raise(key);
    await accept(key, problem);
  }
  await raise("ongoing");

  await root.close();
});

test.describe("the reshipping parcel, from Kirim Ulang to stock", () => {
  test.describe.configure({ mode: "serial", timeout: 150_000 });

  test("seller: Kirim Ulang opens on the problem units, saving creates the parcel on its way — its resi and prices editable, no money moved", async ({
    page,
  }) => {
    const id = ground.restocks.main;
    const pid = ground.product;
    const NOTE = `supplier kirim ulang 2 unit ${SUFFIX}`;
    const RESI = `JNE-ZIN-${SUFFIX}`;
    await as(page, SARI, ground.seller);
    // The paying account once the restock's own payment has posted: Rp 1.000.000 − Rp 100.000.
    const before = await accountOnceRecorded(page, ground.account, `Restock #${id}`);
    expect(before.balance).toBe(rp(OPENING - TOTAL));

    // ── Catat Resolusi → Kirim Ulang, from the problem restock (Diterima, 2 broken) ───────────────────────────────────
    await openRestock(page, id);
    const section = page.getByTestId("restock-detail-resolutions-section");
    await expect(section.getByTestId("resolution-empty")).toBeVisible();
    await section.getByTestId("resolution-record").click();
    await page.getByTestId("resolution-record-reshipping").click();
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}/reshipping$`));
    await expect(page.getByTestId("reshipping-form")).toBeVisible();

    // Opened on the problem units: one line, the product, its 2 broken units at the line's Rp 10.000; the warehouse
    // opens on the restock's — only the courier is missing.
    await expect(page.locator('[data-testid^="reshipping-line-"]')).toHaveCount(1);
    await expect(page.getByTestId(`reshipping-product-${pid}`)).toContainText(ground.productCode);
    await expect(page.getByTestId(`reshipping-count-${pid}`)).toHaveValue("2");
    await expect(page.getByTestId(`reshipping-price-${pid}`)).toHaveValue("10.000");
    await expect(page.getByTestId("reshipping-ready-missing-courier")).toBeVisible();
    await expect(page.getByTestId("reshipping-save")).toBeDisabled();

    // Editable: the price typed to Rp 12.000; the courier picked; no resi (optional); the resolution's note.
    await page.getByTestId(`reshipping-price-${pid}`).fill("12000");
    await expect(page.getByTestId(`reshipping-price-${pid}`)).toHaveValue("12.000");
    await page.getByTestId("reshipping-courier").getByTestId("shipment-channel-select").getByRole("combobox").click();
    await page.getByTestId("shipment-channel-option-jne").click();
    await page.getByTestId("reshipping-note").fill(NOTE);
    await expect(page.getByTestId("reshipping-ready-ready")).toBeVisible();

    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/warehouse.${RESTOCKS}/RestockResolutionCreate`)),
      page.getByTestId("reshipping-save").click(),
    ]);
    expect(res.status(), await res.text()).toBe(200);
    const sent = res.request().postDataJSON();
    expect(sent.type).toBe("RESTOCK_RESOLUTION_TYPE_RESHIPPING");
    expect(String(sent.reshipping.warehouseId)).toBe(ground.warehouse);
    expect(sent.reshipping.resi ?? "").toBe("");
    expect(sent.reshipping.lines).toHaveLength(1);
    expect(String(sent.reshipping.lines[0].productId)).toBe(pid);
    expect(String(sent.reshipping.lines[0].count)).toBe("2");
    expect(Number(sent.reshipping.lines[0].priceUnit)).toBe(12_000);
    const parcel = String((await res.json()).customShipment.id);
    ground.parcel = parcel;

    // ── Back on the restock: the reshipping row, linking its parcel, on its way ───────────────────────────────────────
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));
    const row = resolutionRows(page, "RESHIPPING");
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-testid$="-parcel-link"]')).toHaveText(`Reshipping #${parcel}`);
    await expect(row.getByTestId("inbound-status-on_the_way")).toBeVisible();
    await expect(row.locator('[data-testid$="-note"]')).toHaveText(NOTE);
    await expect(timeline(page, "resolution")).toHaveCount(1);

    // ── The inbound parcel's page, the seller's side — its answer carries the seller's price (the key the warehouse's
    // answer is checked for below, so that check cannot pass on a renamed field). Reloaded: the link's page may draw
    // from the restock page's cached read. ─────────────────────────────────────────────────────────────────────────────
    await row.locator('[data-testid$="-parcel-link"]').click();
    await expect(page).toHaveURL(new RegExp(`/inventories/custom-shipments/in/${parcel}$`));
    const answer = page.waitForResponse((r) => r.url().endsWith(`/warehouse.${PARCELS}/CustomShipmentDetail`));
    await page.reload();
    await expect(page.getByTestId("inbound-detail-page")).toHaveAttribute("data-side", "selling");
    expect(priceKeys(await (await answer).json())).toEqual([".customShipment.items[0].priceUnit"]);
    await expect(page.getByTestId("inbound-title")).toHaveText(`Reshipping #${parcel}`);
    await expect(page.getByTestId("inbound-status-on_the_way")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-kind-reshipping")).toBeVisible();
    await expect(page.getByTestId("inbound-supplier")).toHaveText(SUPPLIER.name);
    await expect(page.getByTestId("inbound-other")).toHaveText(ground.warehouseName);
    await expect(page.getByTestId("inbound-restock")).toHaveText(`Restock #${id}`);
    await expect(page.getByTestId("inbound-resi")).toHaveText("No tracking number yet");
    const line = page.getByTestId(`inbound-line-${pid}`);
    await expect(line).toContainText(ground.productCode);
    await expect(line).toContainText(rp(12_000));
    await expect(page.getByTestId("inbound-total")).toContainText(rp(24_000));
    await expect(page.getByTestId("inbound-trail-created")).toBeVisible();
    await expect(page.getByTestId("inbound-trail-arrived")).toHaveCount(0);

    // Ubah Resi — while on its way.
    await page.getByTestId(`inbound-action-edit-resi-${parcel}`).click();
    await page.getByTestId("inbound-resi-input").fill(RESI);
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("inbound-resi")).toContainText(RESI);

    // Ubah Harga — Rp 12.000 → Rp 12.500 a unit.
    await page.getByTestId(`inbound-action-edit-prices-${parcel}`).click();
    const price = page.getByTestId(`inbound-price-${pid}`);
    await expect(price).toHaveValue("12.000");
    await price.fill("12500");
    await page.getByTestId("confirm-action").click();
    await expect(line).toContainText(rp(12_500));
    await expect(page.getByTestId("inbound-total")).toContainText(rp(25_000));

    // No money moved: the paying account reads what it read before, with no new row; nothing on Team Balance.
    await page.waitForTimeout(3_000);
    const after = await accountOnceRecorded(page, ground.account, `Restock #${id}`);
    expect(after).toEqual(before);
    expect(await parcelFees(page, parcel)).toEqual([]);
  });

  test("warehouse: Restok Masuk shows the parcel at the top of its step's tab with no seller price; Tandai Tiba notes the door charge", async ({
    page,
    browser,
  }) => {
    const parcel = ground.parcel;
    const pid = ground.product;
    const CHARGE_NOTE = `ongkir COD di pintu ${SUFFIX}`;
    await as(page, WAWAN, ground.warehouse);

    // ── Restok Masuk, Ongoing: the parcel's row above the restock on its way ──────────────────────────────────────────
    await page.goto("/inventories/restock?status=ongoing");
    await expect(page.getByTestId("restock-inbound-page")).toBeVisible();
    const table = page.getByTestId("restock-inbound-table");
    const row = page.getByTestId(`inbound-row-${parcel}`);
    await expect(row).toBeVisible();
    await expect(page.getByTestId(`restock-row-${ground.restocks.ongoing}`)).toBeVisible();
    const order = await table.locator("tbody > tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid") ?? ""));
    const firstRestock = order.findIndex((t) => t.startsWith("restock-row-"));
    expect(order.indexOf(`inbound-row-${parcel}`), order.join(" ")).toBeGreaterThanOrEqual(0);
    expect(order.map((t) => t.startsWith("inbound-row-")).lastIndexOf(true), order.join(" ")).toBeLessThan(firstRestock);
    await expect(row.getByTestId("inbound-status-on_the_way")).toBeVisible();
    await expect(row.getByTestId("custom-shipment-kind-reshipping")).toBeVisible();
    await expect(page.getByTestId(`inbound-for-${parcel}`)).toContainText(`restock #${ground.restocks.main}`);
    await expect(page.getByTestId(`inbound-items-${parcel}`)).toContainText(ground.productName);
    await expect(page.getByTestId(`inbound-resi-${parcel}`)).toContainText(`JNE-ZIN-${SUFFIX}`);
    await expect(row).not.toContainText("Rp");

    // A restock-only filter (From) leaves the parcels out rather than show ones it did not narrow.
    await page.goto(`/inventories/restock?status=ongoing&from=${ground.seller}`);
    await expect(page.getByTestId(`restock-row-${ground.restocks.ongoing}`)).toBeVisible();
    await expect(row).toHaveCount(0);

    // ── Its page, the warehouse's side: no seller price on the screen, nor in the answer it was drawn from ────────────
    const answer = page.waitForResponse((r) => r.url().endsWith(`/warehouse.${PARCELS}/CustomShipmentDetail`));
    await openParcel(page, parcel, "warehouse");
    const seen = await (await answer).json();
    expect(seen.customShipment.items, JSON.stringify(seen)).toHaveLength(1);
    expect(priceKeys(seen), JSON.stringify(seen)).toEqual([]);
    await expect(page.getByTestId("inbound-other")).toHaveText(ground.sellerName);
    await expect(page.getByTestId(`inbound-line-${pid}`)).toContainText(ground.productCode);
    await expect(page.getByTestId("inbound-total")).toHaveCount(0);
    await expect(page.getByTestId("inbound-lines-card")).not.toContainText("Rp");
    await expect(page.getByTestId(`inbound-action-edit-prices-${parcel}`)).toHaveCount(0);
    await expect(page.getByTestId(`inbound-action-sign-${parcel}`)).toBeVisible();

    // ── Tandai Tiba from its Restok Masuk row, the courier's door charge noted ────────────────────────────────────────
    await page.goto("/inventories/restock?status=ongoing");
    await row.getByTestId(`inbound-action-sign-${parcel}`).click();
    await page.getByTestId("inbound-sign-courier-asked-yes").click();
    await page.getByTestId("inbound-sign-courier-charge").fill("8000");
    await page.getByTestId("inbound-sign-courier-note").fill(CHARGE_NOTE);
    const [arrived] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/warehouse.${PARCELS}/CustomShipmentArrive`)),
      page.getByTestId("confirm-action").click(),
    ]);
    expect(arrived.status(), await arrived.text()).toBe(200);
    const sentArrive = arrived.request().postDataJSON();
    expect(Number(sentArrive.doorCharge)).toBe(8_000);
    expect(sentArrive.doorChargeNote).toBe(CHARGE_NOTE);
    await expect(row).toHaveCount(0);

    // It moved to the Arrived tab, Terima on its row.
    await page.goto("/inventories/restock?status=arrived");
    await expect(row.getByTestId("inbound-status-arrived")).toBeVisible();
    await expect(row.getByTestId(`inbound-action-receive-${parcel}`)).toBeVisible();

    // The page says it arrived, the charge noted — final at count-in.
    await openParcel(page, parcel, "warehouse");
    await expect(page.getByTestId("inbound-status-arrived")).toBeVisible();
    await expect(page.getByTestId("inbound-door-charge")).toContainText(rp(8_000));
    await expect(page.getByTestId("inbound-door-charge")).toContainText(CHARGE_NOTE);
    await expect(page.getByTestId("inbound-door-charge")).toContainText("noted at Tiba — final at count-in");
    await expect(page.getByTestId("inbound-trail-arrived")).toBeVisible();

    // The seller, after Tiba: the resi no longer editable, nor Hilang; the prices still are (until Terima).
    const sari = await pageAs(browser, SARI, ground.seller);
    await openParcel(sari, parcel, "selling");
    await expect(sari.getByTestId("inbound-status-arrived")).toBeVisible();
    await expect(sari.getByTestId(`inbound-action-edit-prices-${parcel}`)).toBeVisible();
    await expect(sari.getByTestId(`inbound-action-edit-resi-${parcel}`)).toHaveCount(0);
    await expect(sari.getByTestId(`inbound-action-mark-lost-${parcel}`)).toHaveCount(0);
    // Nothing owed yet — the charge moves money only at Terima.
    expect(await parcelFees(sari, parcel)).toEqual([]);
    await sari.close();
  });

  test("warehouse: Terima puts the good units on a rack at the seller's price, and the door charge reaches Team Balance once", async ({
    page,
    browser,
  }) => {
    const parcel = ground.parcel;
    const pid = ground.product;
    await as(page, WAWAN, ground.warehouse);

    // ── Terima: both units good, onto the empty rack; the door charge opens with Tiba's ───────────────────────────────
    await page.goto("/inventories/restock?status=arrived");
    await page.getByTestId(`inbound-action-receive-${parcel}`).click();
    await expect(page.getByTestId("inbound-receive-dialog").getByTestId(`inbound-count-${pid}`)).toContainText("Sent 2 pcs");
    await expect(page.getByTestId("inbound-receive-courier-charge")).toHaveValue("8.000");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("inbound-receive-dialog")).toHaveCount(0);
    const sent = await countIn(page, parcel, 2, ground.inRack, "2 good to the rack · 0 short");
    expect(String(sent.lines[0].received)).toBe("2");
    expect(String(sent.lines[0].rackId)).toBe(ground.inRack);
    expect(Number(sent.doorCharge)).toBe(8_000);

    // Received: the Accepted tab holds it now; its page counts 2 good, 0 short, on the rack (the warehouse's column).
    await page.goto("/inventories/restock?status=accepted");
    await expect(page.getByTestId(`inbound-row-${parcel}`).getByTestId("inbound-status-received")).toBeVisible();
    await openParcel(page, parcel, "warehouse");
    await expect(page.getByTestId("inbound-status-received")).toBeVisible();
    await expect(page.getByTestId(`inbound-good-${pid}`)).toHaveText("2");
    await expect(page.getByTestId(`inbound-shortcount-${pid}`)).toHaveText("0");
    await expect(page.getByTestId(`inbound-line-${pid}`)).toContainText(new RegExp(ground.inRackCode, "i"));
    await expect(page.getByTestId("inbound-trail-received")).toBeVisible();
    await expect(page.getByTestId("inbound-lines-card")).not.toContainText("Rp");

    // In stock on that rack: the 2 units.
    await page.goto(`/inventories/racks/${ground.inRack}`);
    await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${pid}`)).toHaveText("2");

    // ── The seller: received, no act left; the stock-in valued at ITS price, Rp 12.500 ────────────────────────────────
    const sari = await pageAs(browser, SARI, ground.seller);
    await openParcel(sari, parcel, "selling");
    await expect(sari.getByTestId("inbound-status-received")).toBeVisible();
    await expect(sari.getByTestId(`inbound-good-${pid}`)).toHaveText("2");
    await expect(sari.locator(`[data-testid^="inbound-action-"]`)).toHaveCount(0);
    await expect(sari.getByTestId("inbound-door-charge")).toContainText("your team owes it back");

    const listed = await api(sari, "inventory.v1.InventoryService/OwnerBatchList", {
      teamId: ground.seller,
      filter: { productId: pid },
      dataRequest: ["OWNER_BATCH_LIST_DATA_TYPE_BATCH"],
      page: { page: 1, limit: 50 },
    });
    const batches = Object.values(
      ((listed.items ?? []) as { batch?: { mapData: Record<string, { unitCost?: number; ready?: string }> } }[]).find((i) => i.batch)?.batch
        ?.mapData ?? {},
    );
    const atPrice = batches.filter((b) => b.unitCost === 12_500);
    expect(atPrice, JSON.stringify(batches)).toHaveLength(1);
    expect(String(atPrice[0]!.ready)).toBe("2");
    await sari.goto(`/products/${pid}`);
    const batchRow = sari.locator('[data-testid^="pd-batch-row-"]').filter({ hasText: rp(12_500) });
    await expect(batchRow).toHaveCount(1);
    await expect(batchRow).toContainText(rp(25_000));

    // The restock's reshipping row says what was counted in.
    await openRestock(sari, ground.restocks.main);
    await expect(resolutionRows(sari, "RESHIPPING").locator('[data-testid$="-outcome"]')).toHaveText("Counted in: 2 good · 0 broken · 0 short");

    // ── Team Balance: the Rp 8.000 door charge, ONCE, as a custom_shipment_fee (liability hears it by event) ──────────
    await expect.poll(async () => (await parcelFees(sari, parcel)).length, { timeout: 45_000 }).toBe(1);
    await sari.goto(`/liability/${ground.warehouse}`);
    await expect(sari.getByTestId("liability-detail-page")).toBeVisible();
    await expect(sari.getByTestId("liability-detail-tab-loading")).toHaveCount(0);
    const entries = sari
      .getByTestId("liability-detail-all")
      .locator('[data-testid^="liability-detail-entry-"]')
      .filter({ hasText: new RegExp(`parcel #${parcel}(?!\\d)`) });
    await expect(entries).toHaveCount(1);
    await expect(entries).toContainText("8.000");
    await sari.waitForTimeout(3_000);
    expect(await parcelFees(sari, parcel)).toHaveLength(1);
    await sari.close();
  });
});

test.describe("the reshipping parcel — settle and reopen, Hilang, the return, the lists", () => {
  test.describe.configure({ timeout: 150_000 });

  test("a short Terima on a SETTLED restock reopens it: Selesai lifted, Barang kurang back on, Riwayat says reopened", async ({ page, browser }) => {
    const id = ground.restocks.settle;
    const pid = ground.product;
    await as(page, SARI, ground.seller);
    const parcel = await reshipByApi(page, "settle", 2, UNIT);
    const tags = page.getByTestId("restock-tags-box");

    // ── Tandai Selesai first: Barang kurang comes off (the reshipping still on its way is said in the dialog) ─────────
    await openRestock(page, id);
    await expect(tags).toContainText("Barang kurang");
    await page.getByTestId("resolution-settle").click();
    await expect(page.getByTestId("resolution-settle-open")).toBeVisible();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("restock-detail-settled")).toBeVisible();
    await expect(page.getByTestId("resolution-settled")).toBeVisible();
    await expect(page.getByTestId("resolution-settle")).toHaveCount(0);
    await expect(tags).not.toContainText("Barang kurang");
    await expect(timeline(page, "settled")).toHaveCount(1);
    await expect(timeline(page, "reopened")).toHaveCount(0);

    // ── The warehouse signs for it (API) and counts it in SHORT on the screen: 1 of the 2 ────────────────────────────
    const door = await pageAs(browser, WAWAN, ground.warehouse);
    await api(door, `${PARCELS}/CustomShipmentArrive`, { teamId: ground.warehouse, id: parcel, doorCharge: 0 });
    await countIn(door, parcel, 1, ground.shelf, "1 good to the rack · 1 short");
    await openParcel(door, parcel, "warehouse");
    await expect(door.getByTestId(`inbound-shortcount-${pid}`)).toHaveText("1");
    await door.close();

    // ── The restock is open again ─────────────────────────────────────────────────────────────────────────────────────
    await openRestock(page, id);
    await expect(page.getByTestId("restock-detail-status")).toBeVisible();
    await expect(page.getByTestId("restock-detail-settled")).toHaveCount(0);
    await expect(page.getByTestId("resolution-settled")).toHaveCount(0);
    await expect(page.getByTestId("resolution-settle")).toBeVisible();
    await expect(tags).toContainText("Barang kurang");
    const reopened = timeline(page, "reopened");
    await expect(reopened).toHaveCount(1);
    await expect(reopened).toContainText(`Reshipping #${parcel}`);
    await expect(timeline(page, "settled")).toHaveCount(1);
    await expect(resolutionRows(page, "RESHIPPING").locator('[data-testid$="-outcome"]')).toHaveText("Counted in: 1 good · 0 broken · 1 short");

    // …and so says the restock's data: the mark lifted, the missing tag back.
    const detail = (await api(page, `${RESTOCKS}/RestockRequestDetail`, { teamId: ground.seller, requestId: id })).request;
    expect(Number(detail.settledAtUnix ?? 0)).toBe(0);
    expect(((detail.tags ?? []) as { appTask?: string }[]).map((t) => t.appTask)).toContain("restock.problem.missing");
  });

  test("the seller marks a parcel on its way Hilang: lost on its page, on the restock's row, and in the warehouse's Lost tab", async ({
    page,
    browser,
  }) => {
    const REASON = `kurir tidak pernah datang ${SUFFIX}`;
    await as(page, SARI, ground.seller);
    const parcel = await reshipByApi(page, "lost", 1, UNIT);

    await openParcel(page, parcel, "selling");
    await expect(page.getByTestId("inbound-status-on_the_way")).toBeVisible();
    await page.getByTestId(`inbound-action-mark-lost-${parcel}`).click();
    await page.getByTestId("inbound-lost-reason").fill(REASON);
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("inbound-status-lost")).toBeVisible();
    await expect(page.getByTestId("inbound-trail-lost")).toContainText(REASON);
    await expect(page.locator('[data-testid^="inbound-action-"]')).toHaveCount(0);

    await openRestock(page, ground.restocks.lost);
    await expect(resolutionRows(page, "RESHIPPING").getByTestId("inbound-status-lost")).toBeVisible();

    const door = await pageAs(browser, WAWAN, ground.warehouse);
    await door.goto("/inventories/restock?status=lost");
    await expect(door.getByTestId(`inbound-row-${parcel}`).getByTestId("inbound-status-lost")).toBeVisible();
    await door.goto("/inventories/restock?status=ongoing");
    await expect(door.getByTestId("restock-inbound-page")).toBeVisible();
    await expect(door.getByTestId(`restock-row-${ground.restocks.ongoing}`)).toBeVisible();
    await expect(door.getByTestId(`inbound-row-${parcel}`)).toHaveCount(0);
    await door.close();
  });

  test("Retur ke Supplier opens Paket Baru on Kirim balik ke supplier, and the return row links the parcel it created", async ({ page }) => {
    const id = ground.restocks.ret;
    const pid = ground.product;
    const NOTE = `retur 2 unit pecah ${SUFFIX}`;
    await as(page, SARI, ground.seller);

    await openRestock(page, id);
    await page.getByTestId("resolution-record").click();
    await page.getByTestId("resolution-record-return").click();
    await expect(page).toHaveURL(/\/inventories\/custom-shipments\/new$/);
    await expect(page.getByTestId("custom-shipment-form-return")).toContainText(`Return for restock #${id}`);
    await expect(page.getByTestId("custom-shipment-form-reship")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-form-restock-facts")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-form-name")).toHaveValue(SUPPLIER.name);
    await expect(page.getByTestId(`custom-shipment-form-broken-${pid}`)).toBeVisible();

    await page.getByTestId(`custom-shipment-form-broken-count-${pid}`).fill("2");
    await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
    await page.getByTestId("shipment-channel-option-jne").click();
    await page.getByTestId("custom-shipment-form-return-note").fill(NOTE);
    await expect(page.getByTestId("custom-shipment-form-ready")).toBeVisible();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/warehouse.${PARCELS}/CustomShipmentCreate`)),
      page.getByTestId("custom-shipment-form-submit").click(),
    ]);
    expect(res.status(), await res.text()).toBe(200);
    const sent = res.request().postDataJSON();
    expect(sent.kind).toBe("CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP");
    expect(String(sent.restockId)).toBe(id);
    expect(sent.resolution?.note).toBe(NOTE);
    const out = String((await res.json()).customShipment.id);

    // Back on the restock: the return row, its parcel linked, Diminta.
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));
    const row = resolutionRows(page, "RETURN");
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-testid$="-parcel-link"]')).toHaveText(`Parcel #${out}`);
    await expect(row.getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(row.locator('[data-testid$="-note"]')).toHaveText(NOTE);

    await row.locator('[data-testid$="-parcel-link"]').click();
    await expect(page).toHaveURL(new RegExp(`/inventories/custom-shipments/${out}$`));
    await expect(page.getByTestId("custom-shipment-detail-kind").getByTestId("custom-shipment-kind-reship")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-restock")).toContainText(`#${id}`);
  });

  test("Kirim Paket: the seller's list shows the inbound parcel under Semua and under Reshipping from supplier; a warehouse's queue leaves it out", async ({
    page,
    browser,
  }) => {
    const id = ground.restocks.list;
    await as(page, SARI, ground.seller);
    const inbound = await reshipByApi(page, "list", 2, UNIT);
    const out = String(
      (
        await api(page, `${PARCELS}/CustomShipmentCreate`, {
          teamId: ground.seller,
          kind: "CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP",
          warehouseId: ground.warehouse,
          restockId: id,
          lines: [{ productId: ground.product, restockItemId: ground.items.list, quantity: "2" }],
          recipient: { name: SUPPLIER.name, phone: SUPPLIER.contact, address: SUPPLIER.address },
          shipmentChannelId: ground.jne,
          payer: "CUSTOM_SHIPMENT_PAYER_WAREHOUSE",
          idempotencyKey: `e2e-zin-out-${SUFFIX}`,
        })
      ).customShipment.id,
    );

    // ── Semua: both ways ──────────────────────────────────────────────────────────────────────────────────────────────
    await page.goto("/inventories/custom-shipments");
    await expect(page.getByTestId("custom-shipments-selling")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-tab-all")).toHaveAttribute("aria-selected", "true");
    const inRow = page.getByTestId(`custom-shipment-row-in-${inbound}`);
    const outRow = page.getByTestId(`custom-shipment-row-${out}`);
    await expect(inRow).toBeVisible();
    await expect(outRow).toBeVisible();
    await expect(inRow.getByTestId("custom-shipment-kind-reshipping")).toBeVisible();
    await expect(inRow.getByTestId("inbound-status-on_the_way")).toBeVisible();
    await expect(inRow).toContainText(`From ${SUPPLIER.name}`);
    await expect(inRow).toContainText(`for restock #${id}`);
    await expect(page.getByTestId(`inbound-value-${inbound}`)).toHaveText(rp(2 * UNIT));

    // ── Kind: Reshipping from supplier — the inbound only ─────────────────────────────────────────────────────────────
    await page.getByTestId("custom-shipment-kind").click();
    await page.getByTestId("custom-shipment-kind-option-reshipping").click();
    await expect(page).toHaveURL(/[?&]kind=reshipping(&|$)/);
    await expect(inRow).toBeVisible();
    await expect(outRow).toHaveCount(0);

    // Kind: Reship — the outbound only.
    await page.getByTestId("custom-shipment-kind").click();
    await page.getByTestId("custom-shipment-kind-option-reship").click();
    await expect(page).toHaveURL(/[?&]kind=reship(&|$)/);
    await expect(outRow).toBeVisible();
    await expect(inRow).toHaveCount(0);

    // The inbound row opens its page.
    await page.goto("/inventories/custom-shipments?kind=reshipping");
    await inRow.getByTestId("custom-shipment-kind-reshipping").click();
    await expect(page).toHaveURL(new RegExp(`/inventories/custom-shipments/in/${inbound}$`));

    // ── The warehouse's Kirim Paket queue: what it ships — the inbound parcel left out, and no third Kind ─────────────
    const door = await pageAs(browser, WAWAN, ground.warehouse);
    await door.goto("/inventories/custom-shipments");
    await expect(door.getByTestId("custom-shipments-warehouse")).toBeVisible();
    await expect(door.getByTestId(`custom-shipment-row-${out}`)).toBeVisible();
    await expect(door.getByTestId(`custom-shipment-row-in-${inbound}`)).toHaveCount(0);
    await expect(door.getByTestId(`custom-shipment-row-${inbound}`)).toHaveCount(0);
    await door.getByTestId("custom-shipment-kind").click();
    await expect(door.getByTestId("custom-shipment-kind-option-reship")).toBeVisible();
    await expect(door.getByTestId("custom-shipment-kind-option-reshipping")).toHaveCount(0);
    await door.keyboard.press("Escape");

    // …and so the data: unasked, the queue is outbound; asked INBOUND, the parcel coming in.
    const ids = async (filter: Record<string, unknown>) =>
      (
        ((await api(door, `${PARCELS}/CustomShipmentList`, { teamId: ground.warehouse, filter, page: { page: 1, limit: 50 } })).customShipments ??
          []) as { id: string }[]
      ).map((s) => String(s.id));
    const queue = await ids({});
    expect(queue).toContain(out);
    expect(queue).not.toContain(inbound);
    const incoming = await ids({ direction: "CUSTOM_SHIPMENT_DIRECTION_INBOUND" });
    expect(incoming).toContain(inbound);
    expect(incoming).not.toContain(out);
    await door.close();
  });
});

import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { api, login } from "./restock_helpers";

// CUSTOM SHIPMENTS — THE RESHIP AND THE *KAMI BAYAR* MONEY, end to end on the real server, Postgres and the Pub/Sub
// emulator (backlog #88). A regression spec: no acceptance rows exist for custom shipments yet. The rules
// (docs/business/custom_shipments/context_decision.md unless named):
//
//   a-custom-shipment-is-a-parcel-that-is-not-an-order — a RESHIP sends a problem restock's goods back to its supplier;
//   the-custom-shipments-prototype-is-accepted, *as drawn* — a reship sends only the broken units of a received restock
//     tagged *Barang rusak*, at most the broken count minus the units already on another live reship, to one supplier,
//     and takes NO rack stock; the recipient is filled in from the supplier (name, contact, address) and every field
//     stays editable; *Kami bayar* needs the paying account, its cost optional and editable until the handover; the
//     warehouse sees no seller money on any screen, nor in the data it receives;
//   a-custom-shipment-is-cancelled-only-while-requested — a cancelled reship's broken units can go on another reship;
//   the-courier-is-paid-by-the-team-or-by-the-warehouse (+ its P4 ✅) — *Kami bayar*: the courier cost leaves the
//     team's account as an expense, as a transfer's shipping (financial_account a-transfers-shipping-posts-as-an-expense):
//     *"Custom shipment #N shipping"* at create, the difference on each *Ubah Ongkir*, the money back on cancel; a
//     *Kami bayar* handover asks the warehouse no cost and posts nothing on Team Balance;
//   inventory a-restock-problem-is-a-system-tag — Terima with broken units puts *Barang rusak* on.
//
// THE GROUND, all this spec's own (root seeds it through the API): a selling team S (CSRS…) and its warehouse W
// (CSRW…) with one rack; Sari, S's SELLING_ADMIN (every selling screen), and Wawan, W's WAREHOUSE_STAFF (the queue, the
// pick, the handover); S's supplier with a name, a contact and an address; S's account (unique number E2E-CSR-…) opened
// at Rp 1.000.000; and a restock of 10 from that supplier, ACCEPTED with 4 broken — 6 on W's rack, 4 broken units the
// reships draw on. Serial: the reships share those 4 units — 3 (cancelled), 1 (Kami bayar, cancelled), then 2 (Kami
// bayar, handed over) and 2 (Gudang bayar, the ledger's sync point).

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-csr-reship-1";
const SARI = `e2ecsrsel${SUFFIX}`;
const WAWAN = `e2ecsrwh${SUFFIX}`;
const SERVICE = "inventory.v1.CustomShipmentService";
const SUPPLIER = {
  name: `E2E CSR Pemasok ${SUFFIX}`,
  contact: "0812-7700-1234",
  address: "Jl. Pemasok Rusak No. 7, Bandung",
};
const OPENING = 1_000_000;
const ORDERED = 10;
const BROKEN = 4;
const GOOD = ORDERED - BROKEN;
const BROKEN_NOTE = "kardus penyok, isi retak";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const MINUS = "\u2212";

const ground = {
  seller: "",
  warehouse: "",
  rack: "",
  product: "",
  productCode: "",
  supplier: "",
  account: "",
  accountName: `E2E CSR BCA ${SUFFIX}`,
  restock: "",
  restockItem: "",
  jne: "",
  // Filled as the tests go.
  availableBefore: "",
  firstReship: "",
};

// An RPC as the signed-in person — its status and JSON body (an error's `code` included).
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

// `user` signed in on `page`, working in `team`.
async function as(page: Page, user: string, password: string, team: string) {
  await login(page, user, password);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
}

async function pageAs(browser: Browser, user: string, password: string, team: string) {
  const page = await browser.newPage();
  await as(page, user, password, team);

  return page;
}

// The seller money a warehouse reader must never receive (a-warehouse-sees-no-seller-money), wherever it sits in a
// response — proto3 JSON leaves an unset field out, so a key present is a value sent.
const MONEY_KEYS = ["total", "shippingCost", "financeAccountId"];
function moneyKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [...(MONEY_KEYS.includes(k) ? [`${path}.${k}`] : []), ...moneyKeys(v, `${path}.${k}`)]);
  }

  return [];
}

// The product's stock at W: what W's rack page says it holds (as Wawan), and what S may still send from W
// (StockAvailability, as Sari).
async function rackHolds(page: Page): Promise<string> {
  await page.goto(`/inventories/racks/${ground.rack}`);
  const cell = page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${ground.product}`);
  await expect(cell).toBeVisible();

  return (await cell.innerText()).trim();
}

async function availableAtW(page: Page): Promise<string> {
  const res = await api(page, "inventory.v1.InventoryService/StockAvailability", {
    teamId: ground.seller,
    warehouseId: ground.warehouse,
    productIds: [ground.product],
  });

  return String((res.items as { productId: string; available?: string }[]).find((i) => i.productId === ground.product)?.available ?? "0");
}

// The reship form, opened as Sari: kind *Kirim balik ke supplier*, the restock picked, its broken line drawn.
async function openReshipForm(page: Page) {
  await page.goto("/inventories/custom-shipments/new");
  await expect(page.getByTestId("custom-shipment-form")).toBeVisible();
  await page.getByTestId("custom-shipment-form-kind-reship").click();
  await expect(page.getByTestId("custom-shipment-form-reship")).toBeVisible();
  await expect(page.getByTestId("custom-shipment-form-restock-loading")).toHaveCount(0);

  await page.getByTestId("custom-shipment-form-restock").click();
  const option = page.getByTestId(`custom-shipment-form-restock-option-${ground.restock}`);
  await expect(option).toBeVisible();

  return option;
}

async function pickCourier(page: Page) {
  await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
  await page.getByTestId("shipment-channel-option-jne").click();
}

// Submits the form and returns the new parcel's id, read off the detail page it lands on.
async function submit(page: Page): Promise<string> {
  await expect(page.getByTestId("custom-shipment-form-ready")).toBeVisible();
  await page.getByTestId("custom-shipment-form-submit").click();
  await expect(page).toHaveURL(/\/inventories\/custom-shipments\/\d+$/);
  await expect(page.getByTestId("custom-shipment-detail-page")).toBeVisible();

  return /\/inventories\/custom-shipments\/(\d+)$/.exec(page.url())![1]!;
}

async function openDetail(page: Page, id: string) {
  await page.goto(`/inventories/custom-shipments/${id}`);
  await expect(page.getByTestId("custom-shipment-detail-page")).toBeVisible();
}

// A row of the account's history, by its exact description.
function logRow(page: Page, description: string): Locator {
  return page
    .getByTestId("account-log-table")
    .locator('[data-testid^="account-log-row-"]')
    .filter({ has: page.getByText(description, { exact: true }) });
}

// The account's page reads `balance` and carries each row with its change — re-read until the listener has posted
// (financial_account hears inventory's events through the emulator).
async function accountReads(page: Page, balance: number, rows: { description: string; change: string }[]) {
  await expect(async () => {
    await page.goto(`/financial-accounts/${ground.account}`);
    await expect(page.getByTestId("financial-account-page")).toBeVisible();
    await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(balance), { timeout: 3_000 });
    for (const r of rows) {
      const row = logRow(page, r.description);
      await expect(row).toHaveCount(1, { timeout: 3_000 });
      await expect(row).toContainText(r.change, { timeout: 1_000 });
    }
  }).toPass({ timeout: 45_000 });
}

// A reship parcel of `quantity` broken units, created as Sari through the API.
async function reshipByApi(page: Page, key: string, quantity: number, payer: { cost: number } | "warehouse") {
  const res = await api(page, `${SERVICE}/CustomShipmentCreate`, {
    teamId: ground.seller,
    kind: "CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP",
    warehouseId: ground.warehouse,
    restockId: ground.restock,
    lines: [{ productId: ground.product, restockItemId: ground.restockItem, quantity: String(quantity) }],
    recipient: { name: SUPPLIER.name, phone: SUPPLIER.contact, address: SUPPLIER.address },
    shipmentChannelId: ground.jne,
    ...(payer === "warehouse"
      ? { payer: "CUSTOM_SHIPMENT_PAYER_WAREHOUSE" }
      : { payer: "CUSTOM_SHIPMENT_PAYER_TEAM", financeAccountId: ground.account, shippingCost: payer.cost }),
    idempotencyKey: `e2e-csr-${key}-${SUFFIX}`,
  });

  return String(res.customShipment.id);
}

test.describe("custom shipments — reships and the Kami bayar money", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.seller = await team(`E2E CSR Seller ${SUFFIX}`, `CSRS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E CSR WH ${SUFFIX}`, `CSRW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    ground.rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: "e2e-csr", name: "E2E CSR shelf" })).rack.id,
    );

    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.seller,
      username: SARI,
      password: PASSWORD,
      name: `Sari CSR ${SUFFIX}`,
      role: "ROLE_SELLING_ADMIN",
    });
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouse,
      username: WAWAN,
      password: PASSWORD,
      name: `Wawan CSR ${SUFFIX}`,
      role: "ROLE_WAREHOUSE_STAFF",
    });

    const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E CSR Cat ${SUFFIX}` })).category.id;
    const product = await api(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `CSRP${SUFFIX}`,
      name: `E2E Vas Keramik ${SUFFIX}`,
      categoryId: category,
    });
    ground.product = String(product.product.id);
    ground.productCode = String(product.product.productCode);

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.seller, ...SUPPLIER })).supplier.id,
    );

    ground.account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: ground.accountName,
          holderName: "E2E",
          accountNumber: `E2E-CSR-${SUFFIX}`,
          openingBalance: OPENING,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: ground.seller,
      accountId: ground.account,
      operational: true,
    });

    const channels = await api(page, "shipment.v1.ShipmentChannelService/ShipmentChannelList", {
      dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"],
      page: { page: 1, limit: 100 },
    });
    const map = (channels.items as { channel?: { mapData: Record<string, { code: string }> } }[]).find((i) => i.channel)?.channel?.mapData;
    ground.jne = Object.entries(map ?? {}).find(([, c]) => c.code === "jne")?.[0] ?? "";
    expect(ground.jne, "the seeded jne courier").toBeTruthy();

    // The restock: 10 from the supplier at Rp 0 (it moves no money), counted in with 4 broken — 6 on the rack.
    const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
      financeAccountId: ground.account,
      receipt: `E2E-CSR-${SUFFIX}`,
      items: [
        {
          productId: ground.product,
          productCode: ground.productCode,
          name: `E2E Vas Keramik ${SUFFIX}`,
          count: ORDERED,
          total: 0,
          supplierId: ground.supplier,
        },
      ],
    });
    ground.restock = String(restock.request.id);
    ground.restockItem = String(restock.request.items[0].id);
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouse,
      requestId: ground.restock,
      lines: [
        {
          itemId: ground.restockItem,
          receivedCount: ORDERED,
          brokenCount: BROKEN,
          brokenNote: BROKEN_NOTE,
          placements: [{ placementId: ground.rack, quantity: GOOD }],
        },
      ],
    });

    // The ground holds: the restock carries *Barang rusak* (a-restock-problem-is-a-system-tag).
    const detail = await api(page, "inventory.v1.RestockRequestService/RestockRequestDetail", {
      teamId: ground.seller,
      requestId: ground.restock,
    });
    const tags = (detail.request.tags ?? []) as { name: string; appTask?: string }[];
    expect(tags.map((t) => t.appTask), JSON.stringify(tags)).toContain("restock.problem.broken");

    // The stock at W before any reship exists: the 6 good units.
    ground.availableBefore = await availableAtW(page);
    expect(ground.availableBefore).toBe(String(GOOD));

    await page.close();
  });

  test("the reship form offers the Barang rusak restock, prefills its supplier as the editable recipient, and offers only its broken units", async ({
    page,
  }) => {
    await as(page, SARI, PASSWORD, ground.seller);

    // The restock is offered, with its broken units.
    const option = await openReshipForm(page);
    await expect(option).toContainText(`#${ground.restock}`);
    await expect(option).toContainText(`${BROKEN} broken units`);
    await option.click();
    await expect(page.getByTestId("custom-shipment-form-restock-facts")).toBeVisible();

    // The recipient is the supplier, filled in from its record — name, contact, address.
    await expect(page.getByTestId("custom-shipment-form-prefilled")).toContainText(SUPPLIER.name);
    await expect(page.getByTestId("custom-shipment-form-name")).toHaveValue(SUPPLIER.name);
    await expect(page.getByTestId("custom-shipment-form-phone")).toHaveValue(SUPPLIER.contact);
    await expect(page.getByTestId("custom-shipment-form-address")).toHaveValue(SUPPLIER.address);

    // Only the broken units: one line, the product's, 4 left — never the 6 good ones on the rack.
    const lines = page.getByTestId("custom-shipment-form-broken-lines");
    await expect(lines.locator(":scope > *")).toHaveCount(1);
    await expect(page.getByTestId(`custom-shipment-form-broken-${ground.product}`)).toContainText(ground.productCode);
    await expect(page.getByTestId(`custom-shipment-form-broken-left-${ground.product}`)).toHaveText(`${BROKEN} broken left`);

    // Every recipient field stays editable: the name and the address are changed before the create.
    const name = `${SUPPLIER.name} (bagian retur)`;
    const address = `${SUPPLIER.address} — gudang belakang`;
    await page.getByTestId("custom-shipment-form-name").fill(name);
    await page.getByTestId("custom-shipment-form-address").fill(address);

    // A reship of 3, Gudang bayar (the default).
    await page.getByTestId(`custom-shipment-form-broken-count-${ground.product}`).fill("3");
    await pickCourier(page);
    ground.firstReship = await submit(page);

    // Diminta, a reship, to the edited recipient, its 3 broken units with the note written at Terima.
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-detail-kind").getByTestId("custom-shipment-kind-reship")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-restock")).toContainText(`#${ground.restock}`);
    await expect(page.getByTestId("custom-shipment-detail-recipient")).toContainText(name);
    await expect(page.getByTestId("custom-shipment-detail-recipient")).toContainText(SUPPLIER.contact);
    await expect(page.getByTestId("custom-shipment-detail-address")).toHaveText(address);
    await expect(page.getByTestId(`custom-shipment-qty-${ground.product}`)).toHaveText("3");
    await expect(page.getByTestId(`custom-shipment-broken-${ground.product}`)).toHaveText(BROKEN_NOTE);

    // …and so on the selling list.
    await page.goto("/inventories/custom-shipments");
    const row = page.getByTestId(`custom-shipment-row-${ground.firstReship}`);
    await expect(row.getByTestId("custom-shipment-kind-reship")).toBeVisible();
    await expect(row.getByTestId("custom-shipment-status-requested")).toBeVisible();
  });

  test("a reship takes no rack stock: the product's stock at the warehouse is unchanged by its create", async ({ page }) => {
    // W's rack still holds the 6 good units Terima put there…
    await as(page, WAWAN, PASSWORD, ground.warehouse);
    expect(await rackHolds(page)).toBe(String(GOOD));

    // …and what S may send from W is what it was before the reship was created.
    const sari = await pageAs(page.context().browser()!, SARI, PASSWORD, ground.seller);
    expect(await availableAtW(sari)).toBe(ground.availableBefore);
    // The reship of 3 is live (Diminta) — its units came from the broken ones, not from the shelf.
    const detail = await api(sari, `${SERVICE}/CustomShipmentDetail`, { teamId: ground.seller, id: ground.firstReship });
    expect(detail.customShipment.status).toBe("CUSTOM_SHIPMENT_STATUS_REQUESTED");
    await sari.close();
  });

  test("a reship is capped at the broken units minus the live reships, and a cancelled one frees its units", async ({ page }) => {
    await as(page, SARI, PASSWORD, ground.seller);

    // The second form: 4 broken, 3 already on the live reship — 1 left.
    const option = await openReshipForm(page);
    await expect(option).toContainText("1 broken unit");
    await option.click();
    await expect(page.getByTestId(`custom-shipment-form-broken-left-${ground.product}`)).toHaveText(
      `1 left · ${BROKEN} broken, 3 already on a parcel`,
    );

    // More than that is not ready on the form…
    await page.getByTestId(`custom-shipment-form-broken-count-${ground.product}`).fill("2");
    await expect(page.getByTestId("custom-shipment-form-missing-overBroken")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-form-submit")).toBeDisabled();

    // …and refused by the server.
    const over = await call(page, `${SERVICE}/CustomShipmentCreate`, {
      teamId: ground.seller,
      kind: "CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP",
      warehouseId: ground.warehouse,
      restockId: ground.restock,
      lines: [{ productId: ground.product, restockItemId: ground.restockItem, quantity: "2" }],
      recipient: { name: SUPPLIER.name, phone: SUPPLIER.contact, address: SUPPLIER.address },
      shipmentChannelId: ground.jne,
      payer: "CUSTOM_SHIPMENT_PAYER_WAREHOUSE",
      idempotencyKey: `e2e-csr-over-${SUFFIX}`,
    });
    expect(over.status, JSON.stringify(over.body)).not.toBe(200);
    expect(over.body.code).toBe("failed_precondition");

    // Cancelling the first reship (Diminta) frees its 3: the form offers all 4 again.
    await openDetail(page, ground.firstReship);
    await page.getByTestId(`custom-shipment-action-cancel-${ground.firstReship}`).click();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-cancelled")).toBeVisible();

    const again = await openReshipForm(page);
    await expect(again).toContainText(`${BROKEN} broken units`);
    await again.click();
    await expect(page.getByTestId(`custom-shipment-form-broken-left-${ground.product}`)).toHaveText(`${BROKEN} broken left`);
  });

  test("Kami bayar: the cost is an expense on the team's account at create, Ubah Ongkir posts the difference, a cancel gives it back", async ({
    page,
  }) => {
    await as(page, SARI, PASSWORD, ground.seller);
    await accountReads(page, OPENING, []);

    // A reship of 1, Kami bayar from the team's account, Rp 20.000.
    const option = await openReshipForm(page);
    await option.click();
    await page.getByTestId(`custom-shipment-form-broken-count-${ground.product}`).fill("1");
    await pickCourier(page);
    await page.getByTestId("custom-shipment-form-payer-team").click();
    await expect(page.getByTestId("custom-shipment-form-team-pays")).toBeVisible();
    await page.getByTestId("custom-shipment-form-account").click();
    await page.getByTestId(`custom-shipment-form-account-option-${ground.account}`).click();
    await page.getByTestId("custom-shipment-form-cost").fill("20000");
    const id = await submit(page);
    await expect(page.getByTestId("custom-shipment-detail-ongkir")).toHaveText(rp(20_000));
    await expect(page.getByTestId("custom-shipment-detail-account")).toHaveText(ground.accountName);

    const shipping = `Custom shipment #${id} shipping`;
    await accountReads(page, OPENING - 20_000, [{ description: shipping, change: `${MINUS}${rp(20_000)}` }]);

    // Ubah Ongkir to Rp 25.000: the 5.000 difference leaves the account.
    await openDetail(page, id);
    await page.getByTestId(`custom-shipment-action-edit-cost-${id}`).click();
    const amount = page.getByTestId("custom-shipment-cost-amount");
    await expect(amount).toHaveValue("20.000");
    await amount.fill("25000");
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("custom-shipment-detail-ongkir")).toHaveText(rp(25_000));

    await accountReads(page, OPENING - 25_000, [
      { description: shipping, change: `${MINUS}${rp(20_000)}` },
      { description: `${shipping} edited`, change: `${MINUS}${rp(5_000)}` },
    ]);

    // Cancelled while Diminta: the 25.000 comes back.
    await openDetail(page, id);
    await page.getByTestId(`custom-shipment-action-cancel-${id}`).click();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-cancelled")).toBeVisible();

    await accountReads(page, OPENING, [
      { description: shipping, change: `${MINUS}${rp(20_000)}` },
      { description: `${shipping} edited`, change: `${MINUS}${rp(5_000)}` },
      { description: `${shipping} cancelled — money returned`, change: `+${rp(25_000)}` },
    ]);
  });

  test("Kami bayar handover: the warehouse is asked no cost, sees no amount anywhere, and nothing posts on Team Balance", async ({
    page,
  }) => {
    const browser = page.context().browser()!;
    const sari = await pageAs(browser, SARI, PASSWORD, ground.seller);

    // A Kami bayar reship of 2 at Rp 12.000, its cost then changed to Rp 15.000 (a cost-edit row on its trail).
    const id = await reshipByApi(sari, "team", 2, { cost: 12_000 });
    await api(sari, `${SERVICE}/CustomShipmentCostSet`, {
      teamId: ground.seller,
      id,
      financeAccountId: ground.account,
      shippingCost: 15_000,
    });

    // Wawan's queue: the parcel, no amount on its row.
    await as(page, WAWAN, PASSWORD, ground.warehouse);
    await page.goto("/inventories/custom-shipments");
    await expect(page.getByTestId("custom-shipments-warehouse")).toBeVisible();
    const row = page.getByTestId(`custom-shipment-row-${id}`);
    await expect(row.getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(row).not.toContainText("Rp");

    // Its pick page: the broken units come from the restock, no rack to walk to; no amount anywhere; the cost edit is
    // a row that says only that it changed.
    await page.goto(`/inventories/custom-shipments/${id}`);
    const pick = page.getByTestId("custom-shipment-pick-page");
    await expect(pick).toBeVisible();
    await expect(page.getByTestId("custom-shipment-lines-broken-hint")).toContainText(`#${ground.restock}`);
    await expect(page.getByTestId(`custom-shipment-qty-${ground.product}`)).toHaveText("2");
    await expect(page.getByTestId(`custom-shipment-broken-${ground.product}`)).toHaveText(BROKEN_NOTE);
    await expect(page.locator(`[data-testid^="custom-shipment-rack-${ground.product}-"]`)).toHaveCount(0);
    const edit = page.getByTestId("custom-shipment-timeline").locator('[data-kind="edit"]');
    await expect(edit).toHaveCount(1);
    await expect(edit).toContainText("Shipping cost changed");
    await expect(edit.locator('[data-testid$="-description"]')).toHaveCount(0);
    await expect(pick).not.toContainText("Rp");

    // The data it receives carries no seller money either.
    const seen = await api(page, `${SERVICE}/CustomShipmentDetail`, { teamId: ground.warehouse, id });
    expect(moneyKeys(seen), JSON.stringify(seen)).toEqual([]);
    expect(seen.customShipment.payer).toBe("CUSTOM_SHIPMENT_PAYER_TEAM");

    // The item scans, then Sudah Diambil.
    const scan = page.getByTestId("pick-scan-input");
    for (let n = 0; n < 2; n++) {
      await scan.fill(ground.productCode);
      await scan.press("Enter");
      await expect(scan).toHaveValue("");
    }
    await expect(page.getByTestId("pick-scan-complete")).toBeVisible();
    await page.getByTestId("pick-order-set-picked").click();
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-picked")).toBeVisible();

    // Serahkan ke Kurir: the team pays — no cost field, no amount.
    await page.getByTestId("custom-shipment-handover-open").click();
    const dialog = page.getByTestId("custom-shipment-handover");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("custom-shipment-handover-team-pays")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-handover-cost")).toHaveCount(0);
    await expect(dialog).not.toContainText("Rp");
    await dialog.getByTestId("custom-shipment-handover-resi").fill(`JNE-CSR-${SUFFIX}`);
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-handed_over")).toBeVisible();
    await expect(pick).not.toContainText("Rp");

    // THE LEDGER'S SYNC POINT — nothing is a positive sign that nothing posted, so a Gudang bayar reship of the last 2
    // broken units is handed over AFTER it, through the API (its debt itself is custom_shipments.spec.ts's): once its
    // entry has landed on the same subscription, the Kami bayar handover before it has been heard too.
    const sentinel = await reshipByApi(sari, "warehouse", 2, "warehouse");
    await api(page, `${SERVICE}/CustomShipmentPicked`, { teamId: ground.warehouse, id: sentinel });
    await api(page, `${SERVICE}/CustomShipmentHandover`, { teamId: ground.warehouse, id: sentinel, shippingCost: 7_000 });

    type Log = { sourceType: string; sourceId?: string };
    const parcelLogs = async () => {
      const ledger = await api(sari, "liability.v1.LiabilityService/LiabilityLogList", {
        teamId: ground.seller,
        filter: { counterpartyId: ground.warehouse },
        page: { page: 1, limit: 200 },
      });
      const logs = Object.values(
        ((ledger.items ?? []) as { log?: { mapData: Record<string, Log> } }[]).find((it) => it.log)?.log?.mapData ?? {},
      );

      return logs.filter((l) => l.sourceType === "LIABILITY_SOURCE_TYPE_CUSTOM_SHIPMENT_FEE");
    };
    await expect.poll(async () => (await parcelLogs()).map((l) => l.sourceId), { timeout: 45_000 }).toContain(sentinel);
    expect((await parcelLogs()).filter((l) => l.sourceId === id)).toEqual([]);

    // On Sari's Team Balance with W: the sync point's courier row, none for the Kami bayar parcel.
    await sari.goto(`/liability/${ground.warehouse}`);
    await expect(sari.getByTestId("liability-detail-tab-all")).toHaveAttribute("aria-selected", "true");
    const entries = sari.getByTestId("liability-detail-all").locator('[data-testid^="liability-detail-entry-"]');
    await expect(entries.filter({ hasText: new RegExp(`parcel #${sentinel}(?!\\d)`) })).toHaveCount(1);
    await expect(entries.filter({ hasText: new RegExp(`parcel #${id}(?!\\d)`) })).toHaveCount(0);

    // And the reships' pick and handover took no rack stock either.
    expect(await availableAtW(sari)).toBe(String(GOOD));
    expect(await rackHolds(page)).toBe(String(GOOD));
    await sari.close();
  });
});

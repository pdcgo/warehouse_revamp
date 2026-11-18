import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { listLanded } from "./pickers";
import { readXlsx } from "./xlsx";

// THE SELLING RESTOCK LIST COUNTS ITS RESTOCKS AND WRITES THEM AS A FILE — end to end, on the real server and Postgres
// (backlog #72 and #73):
//
//   the-restock-statistics-count-transactions-under-the-tabs (docs/technical/frontend/restock_decision.md) — under the
//     tabs, behind Statistik, shut on every visit and read only once opened (the order list's
//     the-statistics-are-shut-and-read-when-opened); Semua Status = the total, then a card per status led by its
//     transaction count; a status = Transaksi · Jumlah barang · Jumlah SKU (different products) · Nilai barang · Ongkir
//     COD · Nilai transaksi, and Rincian › on Nilai transaksi = the value per paying account;
//   jumlah-barang-counts-the-pieces-ordered — Jumlah barang is the pieces ORDERED, on every status, Diterima included;
//   the-couriers-charge-stays-out-of-total (docs/business/inventory/restock_decision.md) — Ongkir COD is the warehouse's
//     charge at the door and stays outside Nilai transaksi;
//   the-restock-list-exports-and-filters-by-courier — Ekspor writes the list as a file: the list's own filter (the tab
//     and the courier included), every page of it, newest first, the screen's columns;
//   monitoring-keeps-what-only-reads (context_decision.md) — an export stores a file, so the admin team's monitor is
//     offered no Ekspor and the server refuses it; the statistics are a read and stay. No warehouse role reads either
//     (the-warehouse-sees-the-cod-it-paid).
//
// The ground, all the spec's own: a selling team (Sari, SELLING_ADMIN, raises everything), its warehouse W (Gani,
// WAREHOUSE_OWNER, receives) and a second warehouse W2, two paying accounts (BCA, a bank; ShopeePay, an e-wallet):
//
//   A  ongoing    JNE   BCA   P1 ×2  Rp 20.000 + shipping Rp 5.000                       → value 25.000
//   B  arrived    JNE   SPay  P1 ×3  Rp 30.000, P2 ×1 Rp 15.000                           → value 45.000
//   C  accepted   J&T   BCA   P2 ×4  Rp 40.000 + shipping Rp 2.000, counted in 3 (short),
//                             the courier asked Rp 7.500 at the door (outside the value)   → value 42.000
//   D  accepted   JNE   SPay  P3 ×5  Rp 50.000                                            → value 50.000
//   E  lost       J&T   BCA   P1 ×1  Rp 10.000                                            → value 10.000
//   F  cancelled  none  BCA   P2 ×2  Rp 22.000, to W2                                     → value 22.000
//   G1–G6 ongoing none BCA   P1 ×1  Rp 1.000 each — the list's 11th and 12th rows sit on page 2 at 10 a page
//
// Not pinned (per the hand-offs): the phone's Statistik sheet and the export's phone icon, a *Tanpa kurir* pick
// (undefined), cancelReview (undefined), an Ekspor on the warehouse's inbound list (not in the slice).

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-restock-stat-1";
const SARI = `e2erssari${SUFFIX}`;
const GANI = `e2ersgani${SUFFIX}`;
const MONA = `e2ersmona${SUFFIX}`;

const SERVICE = "inventory.v1.RestockRequestService";

type Product = { id: string; productCode: string };

const state = {
  team: "",
  teamName: `E2E Stat Seller ${SUFFIX}`,
  warehouse: "",
  warehouseName: `E2E Stat WH ${SUFFIX}`,
  warehouse2: "",
  warehouse2Name: `E2E Stat WH2 ${SUFFIX}`,
  rack: "",
  couriers: {} as Record<string, { id: string; name: string }>,
  bca: "",
  bcaName: `E2E Stat BCA ${SUFFIX}`,
  spay: "",
  spayName: `E2E Stat ShopeePay ${SUFFIX}`,
  p1: { id: "", productCode: "" } as Product,
  p2: { id: "", productCode: "" } as Product,
  p3: { id: "", productCode: "" } as Product,
  supplierName: `E2E Stat Pemasok ${SUFFIX}`,
  storeName: `Toko Stat ${SUFFIX}`,
  supplier: "",
  store: "",
  sari: "",
  sariName: `Sari Stat ${SUFFIX}`,
  gani: "",
  ganiName: `Gani Stat ${SUFFIX}`,
  // The restocks by letter, and the fillers in raise order.
  r: {} as Record<string, string>,
  fillers: [] as string[],
  // Each restock's resi — the file's rows are told apart by it.
  resi: {} as Record<string, string>,
};

const resiOf = (key: string) => `E2E-RS-${key}-${SUFFIX}`;
const C_ORDER_ID = `0${SUFFIX}C`;

// An RPC as the signed-in person — the status and the JSON body.
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

      return { status: res.status, body: await res.json() };
    },
    [method, body, API_URL] as const,
  );
}

// A call that must succeed — its JSON body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// A SERVER STREAM as the signed-in person, over the Connect protocol's JSON envelopes: the request is one enveloped
// message; the answer is a message per step and an end-of-stream envelope (flag 0x02) carrying the error, if any.
async function stream(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const json = new TextEncoder().encode(JSON.stringify(b));
      const frame = new Uint8Array(5 + json.length);
      new DataView(frame.buffer).setUint32(1, json.length);
      frame.set(json, 5);

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/connect+json",
          "Connect-Protocol-Version": "1",
          Authorization: `Bearer ${bearer}`,
        },
        body: frame,
      });

      const buf = new Uint8Array(await res.arrayBuffer());
      if (!(res.headers.get("content-type") ?? "").includes("connect+json")) {
        return { status: res.status, messages: [], error: { code: "", message: new TextDecoder().decode(buf) } };
      }

      const messages: Record<string, unknown>[] = [];
      let error: { code: string; message?: string } | null = null;
      let at = 0;
      while (at + 5 <= buf.length) {
        const flags = buf[at]!;
        const size = new DataView(buf.buffer, buf.byteOffset + at + 1, 4).getUint32(0);
        const text = new TextDecoder().decode(buf.subarray(at + 5, at + 5 + size));
        const parsed = text ? JSON.parse(text) : {};
        if (flags & 0x02) {
          error = parsed.error ?? null;
        } else {
          messages.push(parsed);
        }
        at += 5 + size;
      }

      return { status: res.status, messages, error };
    },
    [method, body, API_URL] as const,
  );
}

async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// The person on the team's restock list.
async function openList(page: Page, username: string, password: string) {
  await signIn(page, username, password);
  await useTeam(page, state.team);
  await page.goto("/inventories/restock");
  await expect(page.getByTestId("restock-selling-page")).toBeVisible();
}

// Pick a courier in the list's filter, once the catalogue has landed.
async function pickCourier(page: Page, code: string) {
  const field = page.getByTestId("restock-courier-filter");
  const option = page.getByTestId(`shipment-channel-option-${code}`);
  await listLanded(option);
  await field.getByRole("combobox").click();
  await option.click();
}

/** Clicks Ekspor and reads the file it downloads. */
async function exportFile(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByTestId("restock-export").click();
  const download = await downloading;

  // The file's own name, not its storage key (a-download-keeps-its-files-name).
  expect(download.suggestedFilename()).toMatch(/^restok-\d{4}-\d{2}-\d{2}-\d{6}\.xlsx$/);
  await expect(page.getByText("Export ready — the file is downloading").first()).toBeVisible();

  return readXlsx(await download.path());
}

const COLUMNS = [
  "Order ID",
  "Resi",
  "Pemasok",
  "Gudang",
  "Produk",
  "Total",
  "Kurir",
  "Status",
  "Dibuat",
  "Dibuat oleh",
  "Diterima",
  "Diterima oleh",
];

// A moment as the file writes it — WIB, `yyyy-mm-dd hh:mm`.
const wib = (unix: number | string) =>
  new Date(Number(unix) * 1000).toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).slice(0, 16);

// One pile of the answer, every figure a number (proto3 JSON leaves a zero out, an int64 is a string).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pileOf = (p: any) => ({
  restocks: Number(p?.restockCount ?? 0),
  units: Number(p?.unitCount ?? 0),
  products: Number(p?.productCount ?? 0),
  goods: Number(p?.goodsValue ?? 0),
  shipping: Number(p?.shipmentCost ?? 0),
  courierCharge: Number(p?.courierCharge ?? 0),
  value: Number(p?.value ?? 0),
});

const STATUSES = {
  ongoing: "RESTOCK_REQUEST_STATUS_ONGOING",
  arrived: "RESTOCK_REQUEST_STATUS_ARRIVED",
  accepted: "RESTOCK_REQUEST_STATUS_ACCEPTED",
  lost: "RESTOCK_REQUEST_STATUS_LOST",
  cancelled: "RESTOCK_REQUEST_STATUS_CANCELLED",
} as const;

async function stat(page: Page, teamId: string, filter: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await ok<{ total?: any; byStatus?: any[]; byAccount?: any[] }>(page, `${SERVICE}/RestockSellingStat`, {
    teamId,
    filter,
  });

  return {
    total: pileOf(res.total),
    status: (s: string) => pileOf((res.byStatus ?? []).find((p) => p.status === s)),
    statuses: (res.byStatus ?? []).map((p) => p.status as string).sort(),
    accounts: (res.byAccount ?? [])
      .map((a) => ({
        status: a.status as string,
        account: String(a.financeAccountId ?? "0"),
        restocks: Number(a.restockCount ?? 0),
        value: Number(a.value ?? 0),
      }))
      .sort((x, y) => (x.status + x.account).localeCompare(y.status + y.account)),
  };
}

// How many restocks the LIST holds under a filter — its pager's total.
async function listTotal(page: Page, filter: Record<string, unknown>) {
  const res = await ok<{ pageInfo?: { totalItems?: string } }>(page, `${SERVICE}/RestockRequestList`, {
    teamId: state.team,
    filter,
    dataRequest: ["RESTOCK_REQUEST_LIST_DATA_TYPE_GENERAL"],
    page: { page: 1, limit: 10 },
  });

  return Number(res.pageInfo?.totalItems ?? 0);
}

test.describe.configure({ mode: "serial" });

test("Setup: a selling team, its warehouses, two paying accounts, three products, Sari, Gani and a monitor", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  state.team = await team(state.teamName, `RSS${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.warehouse = await team(state.warehouseName, `RSW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  state.warehouse2 = await team(state.warehouse2Name, `RSX${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const admin = await team(`E2E Stat Admin ${SUFFIX}`, `RSA${SUFFIX}`, "TEAM_TYPE_ADMIN");

  state.rack = String(
    (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: "e2e-stat", name: "e2e-stat" })).rack
      .id,
  );

  // The seeded couriers, by code.
  const channels = await ok<{ items: { channel?: { mapData: Record<string, { code: string; name: string }> } }[] }>(
    page,
    "shipment.v1.ShipmentChannelService/ShipmentChannelList",
    { dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"], page: { page: 1, limit: 100 } },
  );
  const map = channels.items.find((item) => item.channel)?.channel?.mapData ?? {};
  for (const [id, channel] of Object.entries(map)) state.couriers[channel.code] = { id, name: channel.name };
  expect(state.couriers.jne && state.couriers.jnt && state.couriers.sicepat).toBeTruthy();

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Stat ${SUFFIX}` })).category.id;
  const product = async (n: number) =>
    (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId: state.team,
        productCodePart: `RSP${n}${SUFFIX}`,
        name: `E2E Stat Kaos ${n} ${SUFFIX}`,
        categoryId: category,
      })
    ).product as Product;
  state.p1 = await product(1);
  state.p2 = await product(2);
  state.p3 = await product(3);

  state.supplier = String(
    (await ok(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: state.team, name: state.supplierName })).supplier.id,
  );
  state.store = String(
    (
      await ok(page, "supplier.v1.SupplierChannelService/SupplierChannelCreate", {
        teamId: state.team,
        supplierId: state.supplier,
        channelType: "MARKETPLACE_SHOPEE",
        name: state.storeName,
        uri: "https://shopee.example/toko-stat",
      })
    ).channel.id,
  );

  // Two OPERATIONAL paying accounts: a bank and an e-wallet.
  const account = async (type: string, provider: string, name: string, number: string) => {
    const id = String(
      (
        await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: state.team,
          type,
          provider,
          name,
          holderName: "E2E",
          accountNumber: number,
          openingBalance: 0,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: state.team,
      accountId: id,
      operational: true,
    });

    return id;
  };
  state.bca = await account("FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT", "FINANCIAL_ACCOUNT_PROVIDER_BCA", state.bcaName, `E2E-RS-BCA-${SUFFIX}`);
  state.spay = await account(
    "FINANCIAL_ACCOUNT_TYPE_WALLET",
    "FINANCIAL_ACCOUNT_PROVIDER_SHOPEEPAY",
    state.spayName,
    `0812${SUFFIX}`,
  );

  const user = async (teamId: string, username: string, name: string, role: string) =>
    String((await ok(page, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name, role })).user.id);
  state.sari = await user(state.team, SARI, state.sariName, "ROLE_SELLING_ADMIN");
  state.gani = await user(state.warehouse, GANI, state.ganiName, "ROLE_WAREHOUSE_OWNER");
  await user(admin, MONA, `Mona Stat ${SUFFIX}`, "ROLE_ADMIN_OWNER");
});

test("Setup: Sari raises twelve restocks, loses one and cancels one", async ({ page }) => {
  await signIn(page, SARI, PASSWORD);

  type Line = [Product, number, number, boolean?];
  const raise = async (key: string, opts: { courier?: string; account: string; shipping?: number; warehouse?: string; lines: Line[] }) => {
    state.resi[key] = resiOf(key);
    const res = await ok(page, `${SERVICE}/RestockRequestCreate`, {
      teamId: state.team,
      warehouseId: opts.warehouse ?? state.warehouse,
      financeAccountId: opts.account,
      receipt: state.resi[key],
      ...(key === "C" ? { invoiceRefId: C_ORDER_ID } : {}),
      ...(opts.courier ? { shipmentId: state.couriers[opts.courier]!.id } : {}),
      ...(opts.shipping ? { shipmentCost: opts.shipping } : {}),
      items: opts.lines.map(([p, count, total, supplied]) => ({
        productId: p.id,
        productCode: p.productCode,
        name: `line ${p.productCode}`,
        count,
        total,
        ...(supplied ? { supplierId: state.supplier, supplierChannelId: state.store } : {}),
      })),
    });

    return String(res.request.id);
  };

  state.r.A = await raise("A", { courier: "jne", account: state.bca, shipping: 5_000, lines: [[state.p1, 2, 20_000]] });
  state.r.B = await raise("B", { courier: "jne", account: state.spay, lines: [[state.p1, 3, 30_000], [state.p2, 1, 15_000]] });
  state.r.C = await raise("C", { courier: "jnt", account: state.bca, shipping: 2_000, lines: [[state.p2, 4, 40_000, true]] });
  state.r.D = await raise("D", { courier: "jne", account: state.spay, lines: [[state.p3, 5, 50_000]] });
  state.r.E = await raise("E", { courier: "jnt", account: state.bca, lines: [[state.p1, 1, 10_000]] });
  state.r.F = await raise("F", { account: state.bca, warehouse: state.warehouse2, lines: [[state.p2, 2, 22_000]] });
  for (let i = 1; i <= 6; i++) {
    state.fillers.push(await raise(`G${i}`, { account: state.bca, lines: [[state.p1, 1, 1_000]] }));
  }

  await ok(page, `${SERVICE}/RestockRequestMarkLost`, { teamId: state.team, requestId: state.r.E, description: "hilang di jalan" });
  await ok(page, `${SERVICE}/RestockRequestCancel`, { teamId: state.team, requestId: state.r.F, moneyReturned: false });
});

test("Setup: Gani marks B arrived, counts C in one short with Rp 7.500 paid at the door, and D whole", async ({ page }) => {
  await signIn(page, GANI, PASSWORD);

  await ok(page, `${SERVICE}/RestockRequestArrive`, { teamId: state.warehouse, requestId: state.r.B });

  const accept = async (id: string, received: number, charge: number) => {
    const detail = await ok(page, `${SERVICE}/RestockRequestDetail`, { teamId: state.warehouse, requestId: id });
    const item = detail.request.items[0] as { id: string; count: string };
    await ok(page, `${SERVICE}/RestockRequestAccept`, {
      teamId: state.warehouse,
      requestId: id,
      lines: [
        {
          itemId: item.id,
          receivedCount: received,
          ...(received < Number(item.count) ? { missingNote: "kurang satu di kardus" } : {}),
          placements: [{ placementId: state.rack, quantity: received }],
        },
      ],
      ...(charge > 0 ? { warehouseAdditionalCost: charge, warehouseAdditionalCostNote: "ongkir COD di pintu" } : {}),
    });
  };
  await accept(state.r.C!, 3, 7_500);
  await accept(state.r.D!, 5, 0);
});

test("Statistik: shut on a visit and nothing read; opened, the total and every status count the team's restocks", async ({
  page,
}) => {
  const reads: Request[] = [];
  page.on("request", (r) => {
    if (r.url().includes("RestockRequestService/RestockSellingStat")) reads.push(r);
  });

  await openList(page, SARI, PASSWORD);
  await expect(page.getByTestId(`restock-row-${state.r.A}`)).toBeVisible();

  // Shut on every visit: no panel, and the census is not read.
  await expect(page.getByTestId("restock-summary-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("restock-summary-panel")).toHaveCount(0);
  expect(reads).toHaveLength(0);

  await page.getByTestId("restock-summary-toggle").click();
  await expect(page.getByTestId("restock-summary-toggle")).toHaveAttribute("aria-expanded", "true");

  // Semua Status: the total, then one card per status, each led by its transactions.
  await expect(page.getByTestId("restock-summary-piles")).toBeVisible();
  expect(reads.length).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("restock-summary-total-value")).toHaveText("12 transactions");
  // Under it, compact: the pieces ordered (24) and the value (Rp 200.000) — never the courier's charge at the door.
  await expect(page.getByTestId("restock-summary-total")).toContainText("24 pcs · Rp 200rb");
  await expect(page.getByTestId("restock-summary-pile-ongoing-value")).toHaveText("7 transactions");
  await expect(page.getByTestId("restock-summary-pile-arrived-value")).toHaveText("1 transaction");
  await expect(page.getByTestId("restock-summary-pile-accepted-value")).toHaveText("2 transactions");
  await expect(page.getByTestId("restock-summary-pile-lost-value")).toHaveText("1 transaction");
  await expect(page.getByTestId("restock-summary-pile-cancelled-value")).toHaveText("1 transaction");
  await expect(page.getByTestId("restock-summary-pile-accepted")).toContainText("9 pcs · Rp 92rb");

  // A status tab: its six figures, whole. Diterima's pieces are those ORDERED (4 + 5), though C was counted in one short;
  // its products are P2 and P3; Ongkir COD is the warehouse's Rp 7.500, outside Nilai transaksi (goods + shipping).
  const before = reads.length;
  await page.getByTestId("restock-tab-accepted").click();
  await expect(page.getByTestId("restock-summary")).toHaveAttribute("data-pile", "accepted");
  await expect(page.getByTestId("restock-summary-measure-transactions-value")).toHaveText("2");
  await expect(page.getByTestId("restock-summary-measure-units-value")).toHaveText("9 pcs");
  await expect(page.getByTestId("restock-summary-measure-skus-value")).toHaveText("2");
  await expect(page.getByTestId("restock-summary-measure-goods-value")).toHaveText("Rp 90.000");
  await expect(page.getByTestId("restock-summary-measure-courier-charge-value")).toHaveText("Rp 7.500");
  await expect(page.getByTestId("restock-summary-measure-value-value")).toHaveText("Rp 92.000");
  // A tab change picks a pile of the census already read — it reads nothing.
  expect(reads.length).toBe(before);

  // Rincian ›: the value per paying account — the largest first, each with its count; they add up to the card.
  await page.getByTestId("restock-summary-payments").click();
  const dialog = page.getByTestId("restock-payments-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId(`restock-payment-name-${state.spay}`)).toHaveText(state.spayName);
  await expect(dialog.getByTestId(`restock-payment-count-${state.spay}`)).toHaveText("1 transaction");
  await expect(dialog.getByTestId(`restock-payment-value-${state.spay}`)).toHaveText("Rp 50.000");
  await expect(dialog.getByTestId(`restock-payment-name-${state.bca}`)).toHaveText(state.bcaName);
  await expect(dialog.getByTestId(`restock-payment-count-${state.bca}`)).toHaveText("1 transaction");
  await expect(dialog.getByTestId(`restock-payment-value-${state.bca}`)).toHaveText("Rp 42.000");
  const order = await dialog
    .getByTestId("restock-payments")
    .locator(":scope > [data-testid]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
  expect(order).toEqual([`restock-payment-${state.spay}`, `restock-payment-${state.bca}`]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Dalam Perjalanan: A and the six fillers — 8 pieces, one product, Rp 26.000 of goods + Rp 5.000 shipping.
  await page.getByTestId("restock-tab-ongoing").click();
  await expect(page.getByTestId("restock-summary-measure-transactions-value")).toHaveText("7");
  await expect(page.getByTestId("restock-summary-measure-units-value")).toHaveText("8 pcs");
  await expect(page.getByTestId("restock-summary-measure-skus-value")).toHaveText("1");
  await expect(page.getByTestId("restock-summary-measure-goods-value")).toHaveText("Rp 26.000");
  await expect(page.getByTestId("restock-summary-measure-courier-charge-value")).toHaveText("Rp 0");
  await expect(page.getByTestId("restock-summary-measure-value-value")).toHaveText("Rp 31.000");
  expect(reads.length).toBe(before);

  // A filter re-reads the census: JNE leaves A on its way, and on Semua Status A, B and D — nothing lost or cancelled.
  const jne = page.waitForRequest(
    (r) =>
      r.url().includes("RestockRequestService/RestockSellingStat") &&
      (r.postData() ?? "").includes(`"shipmentId":"${state.couriers.jne!.id}"`),
  );
  await pickCourier(page, "jne");
  await jne;
  await expect(page.getByTestId("restock-summary-measure-transactions-value")).toHaveText("1");
  await expect(page.getByTestId("restock-summary-measure-units-value")).toHaveText("2 pcs");
  await expect(page.getByTestId("restock-summary-measure-value-value")).toHaveText("Rp 25.000");

  await page.getByTestId("restock-tab-all").click();
  await expect(page.getByTestId("restock-summary-total-value")).toHaveText("3 transactions");
  await expect(page.getByTestId("restock-summary-pile-ongoing-value")).toHaveText("1 transaction");
  await expect(page.getByTestId("restock-summary-pile-arrived-value")).toHaveText("1 transaction");
  await expect(page.getByTestId("restock-summary-pile-accepted-value")).toHaveText("1 transaction");
  await expect(page.getByTestId("restock-summary-pile-lost-value")).toHaveText("0 transactions");
  await expect(page.getByTestId("restock-summary-pile-cancelled-value")).toHaveText("0 transactions");
});

test("Statistik API: the exact figures, every filter counts what the list holds, and only the restocks the team raised", async ({
  page,
}) => {
  await signIn(page, SARI, PASSWORD);

  const all = await stat(page, state.team);
  expect(all.total).toEqual({ restocks: 12, units: 24, products: 3, goods: 193_000, shipping: 7_000, courierCharge: 7_500, value: 200_000 });
  expect(all.status(STATUSES.ongoing)).toEqual({ restocks: 7, units: 8, products: 1, goods: 26_000, shipping: 5_000, courierCharge: 0, value: 31_000 });
  expect(all.status(STATUSES.arrived)).toEqual({ restocks: 1, units: 4, products: 2, goods: 45_000, shipping: 0, courierCharge: 0, value: 45_000 });
  expect(all.status(STATUSES.accepted)).toEqual({ restocks: 2, units: 9, products: 2, goods: 90_000, shipping: 2_000, courierCharge: 7_500, value: 92_000 });
  expect(all.status(STATUSES.lost)).toEqual({ restocks: 1, units: 1, products: 1, goods: 10_000, shipping: 0, courierCharge: 0, value: 10_000 });
  expect(all.status(STATUSES.cancelled)).toEqual({ restocks: 1, units: 2, products: 1, goods: 22_000, shipping: 0, courierCharge: 0, value: 22_000 });

  // Per status × paying account — each status's rows add up to its pile.
  const row = (status: string, account: string, restocks: number, value: number) => ({ status, account, restocks, value });
  expect(all.accounts).toEqual(
    [
      row(STATUSES.ongoing, state.bca, 7, 31_000),
      row(STATUSES.arrived, state.spay, 1, 45_000),
      row(STATUSES.accepted, state.bca, 1, 42_000),
      row(STATUSES.accepted, state.spay, 1, 50_000),
      row(STATUSES.lost, state.bca, 1, 10_000),
      row(STATUSES.cancelled, state.bca, 1, 22_000),
    ].sort((x, y) => (x.status + x.account).localeCompare(y.status + y.account)),
  );

  // Every filter the list takes: each status's card holds exactly the list's total on that tab, and the total its
  // Semua Status — a status with no restock under the filter is left out.
  const now = Math.floor(Date.now() / 1000);
  const filters: Record<string, unknown>[] = [
    {},
    { shipmentId: state.couriers.jne!.id },
    { shipmentId: state.couriers.jnt!.id },
    { shipmentId: state.couriers.sicepat!.id },
    { warehouseId: state.warehouse },
    { warehouseId: state.warehouse2 },
    { q: state.resi.C },
    { acceptedByUserId: state.gani },
    { createdByUserId: state.sari },
    { dateField: "RESTOCK_DATE_FIELD_LOST", fromUnix: String(now - 3600), toUnix: String(now + 60) },
    { dateField: "RESTOCK_DATE_FIELD_CREATED", fromUnix: String(now + 3600), toUnix: String(now + 7200) },
    { shipmentId: state.couriers.jne!.id, warehouseId: state.warehouse },
  ];
  for (const filter of filters) {
    const s = await stat(page, state.team, filter);
    expect(s.total.restocks, `total under ${JSON.stringify(filter)}`).toBe(await listTotal(page, filter));
    for (const status of Object.values(STATUSES)) {
      expect(s.status(status).restocks, `${status} under ${JSON.stringify(filter)}`).toBe(
        await listTotal(page, { ...filter, status }),
      );
    }
  }
  // Spot checks of what those filters hold.
  expect((await stat(page, state.team, { shipmentId: state.couriers.jne!.id })).total.restocks).toBe(3);
  expect((await stat(page, state.team, { warehouseId: state.warehouse2 })).statuses).toEqual([STATUSES.cancelled]);
  expect((await stat(page, state.team, { acceptedByUserId: state.gani })).status(STATUSES.accepted).restocks).toBe(2);

  // THE RAISING SIDE ONLY: the warehouse's own census of the same twelve restocks — which its list holds as the
  // receiving side — counts none of them (root reads it from outside).
  const root = await page.context().browser()!.newPage();
  await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);
  const listedAtW = await ok<{ pageInfo?: { totalItems?: string } }>(root, `${SERVICE}/RestockRequestList`, {
    teamId: state.warehouse,
    filter: {},
    dataRequest: ["RESTOCK_REQUEST_LIST_DATA_TYPE_GENERAL"],
    page: { page: 1, limit: 10 },
  });
  expect(Number(listedAtW.pageInfo?.totalItems ?? 0)).toBe(11);
  const atW = await stat(root, state.warehouse);
  expect(atW.total.restocks).toBe(0);
  expect(atW.statuses).toEqual([]);
  await root.close();
});

test("Refused: a warehouse role reads neither the census nor the file; the monitor reads the census and is refused the file", async ({
  page,
}) => {
  await signIn(page, GANI, PASSWORD);
  for (const teamId of [state.warehouse, state.team]) {
    const res = await call(page, `${SERVICE}/RestockSellingStat`, { teamId, filter: {} });
    expect(res.status, `stat as a warehouse owner in ${teamId}`).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  }
  const ganiFile = await stream(page, `${SERVICE}/RestockRequestExport`, { teamId: state.warehouse, filter: {} });
  expect(ganiFile.error?.code).toBe("permission_denied");
  expect(ganiFile.messages.some((m) => m.downloadUrl)).toBe(false);

  // The admin team's monitor: the census is a read (NO_SIDE_EFFECTS) — allowed; the export stores a file — refused.
  const monitor = await page.context().browser()!.newPage();
  await signIn(monitor, MONA, PASSWORD);
  const counted = await stat(monitor, state.team);
  expect(counted.total.restocks).toBe(12);
  const monaFile = await stream(monitor, `${SERVICE}/RestockRequestExport`, { teamId: state.team, filter: {} });
  expect(monaFile.error?.code).toBe("permission_denied");
  expect(monaFile.messages.some((m) => m.downloadUrl)).toBe(false);
  await monitor.close();

  // Sari's own stream ends in a link: the same call, allowed.
  const sari = await page.context().browser()!.newPage();
  await signIn(sari, SARI, PASSWORD);
  const sariFile = await stream(sari, `${SERVICE}/RestockRequestExport`, { teamId: state.team, filter: {} });
  expect(sariFile.error).toBeNull();
  const last = sariFile.messages[sariFile.messages.length - 1]!;
  expect(String(last.downloadUrl ?? "")).not.toBe("");
  expect(String(last.filename)).toMatch(/^restok-.*\.xlsx$/);
  expect(Number(last.done)).toBe(12);
  expect(Number(last.total)).toBe(12);
  await sari.close();
});

test("Ekspor: the file is every page of the list, newest first, in the screen's columns", async ({ page }) => {
  await openList(page, SARI, PASSWORD);

  // Ten a page: the list shows ten of its twelve — the file still holds all twelve.
  await page.getByTestId("restock-pager-size").click();
  await page.getByRole("option", { name: "10", exact: true }).click();
  await expect(page.locator('[data-testid^="restock-row-"]')).toHaveCount(10);
  await expect(page.getByTestId(`restock-row-${state.r.A}`)).toHaveCount(0);

  const file = await exportFile(page);
  const rows = file.get("Restok")!;
  expect(rows[0]).toEqual(COLUMNS);
  // Newest first — the fillers raised last, then F back to A.
  expect(rows.slice(1).map((r) => r[1])).toEqual(
    ["G6", "G5", "G4", "G3", "G2", "G1", "F", "E", "D", "C", "B", "A"].map((key) => state.resi[key]),
  );

  const detail = async (id: string) =>
    (await ok(page, `${SERVICE}/RestockRequestDetail`, { teamId: state.team, requestId: id })).request as {
      createdAtUnix: string;
      acceptedAtUnix?: string;
    };
  const byResi = (key: string) => rows.find((r) => r[1] === state.resi[key])!;

  // C: its Order ID kept as text (the leading 0), its supplier and store, the pieces ORDERED and its code, goods +
  // shipping exact (the courier's Rp 7.500 at the door stays out), J&T, Diterima, each date in WIB beside who.
  const c = await detail(state.r.C!);
  expect(c.acceptedAtUnix).toBeTruthy();
  expect(byResi("C")).toEqual([
    C_ORDER_ID,
    state.resi.C,
    `${state.supplierName} · ${state.storeName}`,
    state.warehouseName,
    `1 produk · 4 pcs (${state.p2.productCode})`,
    "42000",
    state.couriers.jnt!.name,
    "Diterima",
    wib(c.createdAtUnix),
    state.sariName,
    wib(c.acceptedAtUnix!),
    state.ganiName,
  ]);

  // B: two lines, no supplier connected, arrived — not received, so the row ends at who raised it.
  const b = await detail(state.r.B!);
  expect(byResi("B")).toEqual([
    "",
    state.resi.B,
    "Belum terhubung ke supplier",
    state.warehouseName,
    `2 produk · 4 pcs (${state.p1.productCode}, ${state.p2.productCode})`,
    "45000",
    state.couriers.jne!.name,
    "Tiba",
    wib(b.createdAtUnix),
    state.sariName,
  ]);

  // F: no courier — an empty Kurir — to the second warehouse, cancelled. A, E: their words.
  expect(byResi("F")[3]).toBe(state.warehouse2Name);
  expect(byResi("F")[5]).toBe("22000");
  expect(byResi("F")[6]).toBe("");
  expect(byResi("F")[7]).toBe("Dibatalkan");
  expect(byResi("A")[5]).toBe("25000");
  expect(byResi("A")[7]).toBe("Dalam Perjalanan");
  expect(byResi("E")[7]).toBe("Hilang");
  expect(byResi("D")[11]).toBe(state.ganiName);
});

test("Ekspor: a tab and a courier narrow the file exactly as they narrow the list", async ({ page }) => {
  await openList(page, SARI, PASSWORD);

  await page.getByTestId("restock-tab-accepted").click();
  await pickCourier(page, "jne");
  await expect(page.getByTestId(`restock-row-${state.r.D}`)).toBeVisible();
  await expect(page.getByTestId(`restock-row-${state.r.C}`)).toHaveCount(0);

  const exported = page.waitForRequest((r) => r.url().includes("RestockRequestService/RestockRequestExport"));
  const file = await exportFile(page);
  // The request carries the tab's status and the courier, as the list's.
  const body = (await exported).postData() ?? "";
  expect(body).toContain(state.couriers.jne!.id);

  const rows = file.get("Restok")!;
  expect(rows[0]).toEqual(COLUMNS);
  expect(rows.slice(1).map((r) => r[1])).toEqual([state.resi.D]);
  expect(rows[1]![5]).toBe("50000");
  expect(rows[1]![7]).toBe("Diterima");

  // Lost: E alone, under any courier.
  await page.getByTestId("restock-courier-filter").locator('[data-part="clear-trigger"]').click();
  await page.getByTestId("restock-tab-lost").click();
  await expect(page.getByTestId(`restock-row-${state.r.E}`)).toBeVisible();
  const lost = (await exportFile(page)).get("Restok")!;
  expect(lost.slice(1).map((r) => r[1])).toEqual([state.resi.E]);
});

test("Monitor: the admin team reads the list and its statistics, and is offered no Ekspor and no new restock", async ({
  page,
}) => {
  await openList(page, MONA, PASSWORD);
  await expect(page.getByTestId(`restock-row-${state.r.C}`)).toBeVisible();

  await expect(page.getByTestId("restock-export")).toHaveCount(0);
  await expect(page.getByTestId("open-create-restock")).toHaveCount(0);

  // The statistics are a read: they open for the monitor too.
  await page.getByTestId("restock-summary-toggle").click();
  await expect(page.getByTestId("restock-summary-total-value")).toHaveText("12 transactions");
});

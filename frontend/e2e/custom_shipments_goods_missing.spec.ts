import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// CUSTOM SHIPMENTS — *BARANG TIDAK KETEMU* (goods missing, backlog #88 P6) and the reship line's *not found* (P6b), end to
// end on the real server. A regression spec: no acceptance rows exist for custom shipments yet. The rules
// (docs/business/custom_shipments/context_decision.md):
//
//   missing-goods-leave-a-note-on-the-custom-shipment — the warehouse records goods missing (what, which rack) as a row
//     on the trail; the parcel stays Diminta; the owning team sees it on its list and detail and decides (cancel, or
//     wait); the warehouse never cancels;
//   the-goods-missing-prototype-is-accepted (*as drawn*) — the control on the warehouse's pick page only, only while
//     Diminta, for the roles that pick; the dialog one row per rack the sample's take used, prefilled, each its own
//     maximum, a reship's rows name no rack, an optional note ≤ 200; after recording nothing moves (no status, no stock
//     write, nothing posts) and the scan still works; the trail row its own kind, never a cost edit; the team's badge
//     and notice only while Diminta, Batalkan stays, a cancel removes the notice and the trail keeps the row;
//     *(the prototype's default)* the warehouse may record again while Diminta;
//   the-goods-missing-badge-is-on-both-lists — the team's list and the warehouse's queue;
//   missing-reship-units-are-not-offered-again — a cancelled reship's units a note named are not offered again; its other
//     units are free as before;
//   the-reship-line-counts-the-units-not-found — "{left} left · {broken} broken, {sent} on a parcel, {gone} not found"
//     (the *not found* part only when {gone} > 0; with none on a parcel "{left} left · {broken} broken, {gone} not found"
//     — the build's default, each part only when it holds a unit);
//   a-custom-shipment-is-cancelled-only-while-requested — only the owning team, only while Diminta; a cancelled sample's
//     units go back on the racks they left;
//   the-custom-shipments-prototype-is-accepted — the warehouse sees no seller money on any screen nor in the data it
//     receives.
//
// THE GROUND, all this spec's own (root seeds it through the API): a selling team S (GMS…) whose SELLING_OWNER is Ani,
// and a warehouse W (GMW…) whose WAREHOUSE_STAFF is Wawan (a picking role). Product P (the samples): ONE batch of 5 on two
// racks — 2 on X, 3 on Y — so a sample of 4 has to draw from both racks whichever the system picks first. Product Q (the
// reships): a restock of 10 from S's supplier, accepted with 4 broken (6 on rack Z). S's account (unique number GM88-…).
//
// ⚠ NOT PINNED (no rule says): which roles beyond the picking roles may record (the hand-off: the shipping warehouse's
// owner / admin / staff — the build's default, as CustomShipmentPicked); which rack the take draws first (read off the pick
// page); the RPC's refusal codes (the hand-off's: permission_denied for a selling team, failed_precondition once not Diminta).

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-gm88-pass-1";
const ANI = `e2egmsel${SUFFIX}`;
const ANI_NAME = `Ani GM ${SUFFIX}`;
const WAWAN = `e2egmwh${SUFFIX}`;
const WAWAN_NAME = `Wawan GM ${SUFFIX}`;
const SVC = "inventory.v1.CustomShipmentService";
const REPORT = `/warehouse.${SVC}/CustomShipmentMissingReport`;

const ON_X = 2; // P's one batch: 2 units on rack X…
const ON_Y = 3; // …and 3 on rack Y
const SAMPLE = 4; // more than either rack holds — the take draws from both
const ORDERED = 10; // Q's restock
const BROKEN = 4;
const GOOD = ORDERED - BROKEN;
const SUPPLIER = { name: `E2E GM Pemasok ${SUFFIX}`, contact: "0812-8800-4321", address: "Jl. Pemasok Hilang No. 8, Bandung" };
const NOTE1 = "dicari di rak, tidak ada";
const NOTE2 = "dicek lagi, rak sebelah juga kosong";
const NOTE_RESHIP = "sudah dibuang minggu lalu";

const g = {
  seller: "",
  sellerName: `E2E GM Seller ${SUFFIX}`,
  wh: "",
  whName: `E2E GM Warehouse ${SUFFIX}`,
  rackX: "",
  rackY: "",
  rackZ: "",
  p: "",
  pCode: "",
  q: "",
  qCode: "",
  account: "",
  restock: "",
  restockItem: "",
  jne: "",
};

// An RPC as the signed-in person; a refusal fails here, by name and status.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(page: Page, method: string, body: unknown): Promise<any> {
  const res = await call(page, method, body);
  if (res.status !== 200) throw new Error(`${method}: ${res.status} ${JSON.stringify(res.body)}`);

  return res.body;
}

// An RPC that never throws — its status and JSON body (a Connect error's `code` included).
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { status: res.status, body: (await res.json()) as any };
    },
    [method, body, API_URL] as const,
  );
}

// `user` signed in on `page`, working in `team` — the sign-in's own loads settled before the next goto.
async function as(page: Page, user: string, team: string) {
  await signIn(page, user, PASSWORD);
  await page.waitForLoadState("networkidle");
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
}

async function pageAs(browser: Browser, user: string, team: string): Promise<Page> {
  const page = await browser.newPage();
  await as(page, user, team);

  return page;
}

// The seller money a warehouse reader must never receive, wherever it sits in a response — proto3 JSON leaves an unset
// field out, so a key present is a value sent. A *Gudang bayar* parcel's `shippingCost` is the warehouse's own money
// (the-warehouse-sees-the-ongkir-it-paid), so a sample is walked for the other two only.
const SELLER_MONEY = ["total", "shippingCost", "financeAccountId"];
function moneyKeys(value: unknown, keys = SELLER_MONEY, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyKeys(v, keys, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [...(keys.includes(k) ? [`${path}.${k}`] : []), ...moneyKeys(v, keys, `${path}.${k}`)]);
  }

  return [];
}
const SAMPLE_MONEY = ["total", "financeAccountId"];

// What a rack holds of P, read off its own page as the warehouse — an emptied shelf reads its empty state.
async function onRack(wh: Page, rackId: string): Promise<number> {
  await wh.goto(`/inventories/racks/${rackId}`);
  const cell = wh.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${g.p}`);
  const empty = wh.getByTestId("rack-detail-empty");
  await expect(cell.or(empty)).toBeVisible();
  if (await empty.isVisible()) return 0;

  return Number((await cell.innerText()).replace(/[^0-9]/g, ""));
}

async function racks(wh: Page): Promise<Record<string, number>> {
  return { [g.rackX]: await onRack(wh, g.rackX), [g.rackY]: await onRack(wh, g.rackY) };
}

// The racks the pick page names for P — the system's choice, each with its code and count.
async function pickedRacks(wh: Page, id: string): Promise<Record<string, { qty: number; code: string }>> {
  await wh.goto(`/inventories/custom-shipments/${id}`);
  await expect(wh.getByTestId("custom-shipment-pick-page")).toBeVisible();
  const rows = wh.locator(`[data-testid^="custom-shipment-rack-${g.p}-"]`);
  await expect(rows.first()).toBeVisible();

  const out: Record<string, { qty: number; code: string }> = {};
  for (const row of await rows.all()) {
    const rackId = (await row.getAttribute("data-testid"))!.slice(`custom-shipment-rack-${g.p}-`.length);
    const text = await row.innerText();
    out[rackId] = { qty: Number(/×(\d+)/.exec(text)![1]), code: text.split("×")[0]!.trim() };
  }

  return out;
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A sample of `quantity` units of P, Gudang bayar, asked by Ani through the contract (the form is custom_shipments.spec.ts's).
async function sampleByApi(ani: Page, key: string, quantity: number): Promise<string> {
  const res = await api(ani, `${SVC}/CustomShipmentCreate`, {
    teamId: g.seller,
    kind: "CUSTOM_SHIPMENT_KIND_SAMPLE",
    warehouseId: g.wh,
    lines: [{ productId: g.p, quantity: String(quantity) }],
    recipient: { name: `Budi GM ${SUFFIX}`, phone: "081234500088", address: "Jl. Melati 88, Bandung" },
    shipmentChannelId: g.jne,
    payer: "CUSTOM_SHIPMENT_PAYER_WAREHOUSE",
    idempotencyKey: `e2e-gm88-${key}-${SUFFIX}`,
  });

  return String(res.customShipment.id);
}

// A reship of `quantity` of Q's broken units, asked by Ani through the contract — no throw: its status and body.
async function reshipCall(ani: Page, key: string, quantity: number, payer: "team" | "warehouse") {
  return call(ani, `${SVC}/CustomShipmentCreate`, {
    teamId: g.seller,
    kind: "CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP",
    warehouseId: g.wh,
    restockId: g.restock,
    lines: [{ productId: g.q, restockItemId: g.restockItem, quantity: String(quantity) }],
    recipient: { name: SUPPLIER.name, phone: SUPPLIER.contact, address: SUPPLIER.address },
    shipmentChannelId: g.jne,
    ...(payer === "warehouse"
      ? { payer: "CUSTOM_SHIPMENT_PAYER_WAREHOUSE" }
      : { payer: "CUSTOM_SHIPMENT_PAYER_TEAM", financeAccountId: g.account, shippingCost: 10_000 }),
    idempotencyKey: `e2e-gm88-${key}-${SUFFIX}`,
  });
}

// The restock's broken line as the reship choices read it (as Ani) — undefined once the restock is no longer offered.
async function reshipLine(ani: Page): Promise<{ broken: number; alreadySent: number; notFound: number } | undefined> {
  const res = await api(ani, `${SVC}/CustomShipmentReshipOptions`, { teamId: g.seller, page: { page: 1, limit: 50 } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const option = ((res.options ?? []) as any[]).find((o) => String(o.restockId) === g.restock);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line = ((option?.lines ?? []) as any[]).find((l) => String(l.restockItemId) === g.restockItem);
  if (!line) return undefined;

  return { broken: Number(line.broken ?? 0), alreadySent: Number(line.alreadySent ?? 0), notFound: Number(line.notFound ?? 0) };
}

// The reship form as Ani: kind *Kirim balik ke supplier*, the restock list open — its option for Q's restock returned.
async function openReshipForm(page: Page): Promise<Locator> {
  await page.goto("/inventories/custom-shipments/new");
  await expect(page.getByTestId("custom-shipment-form")).toBeVisible();
  await page.getByTestId("custom-shipment-form-kind-reship").click();
  await expect(page.getByTestId("custom-shipment-form-reship")).toBeVisible();
  await expect(page.getByTestId("custom-shipment-form-restock-loading")).toHaveCount(0);
  await page.getByTestId("custom-shipment-form-restock").click();
  const option = page.getByTestId(`custom-shipment-form-restock-option-${g.restock}`);
  await expect(option).toBeVisible();

  return option;
}

// The pick page's *Barang Tidak Ketemu*: opens the dialog, records `counts` (row id → units) with `note`, and returns the
// MissingReport answer (its request too) — the dialog closed, the page re-read.
async function record(wh: Page, counts: Record<string, number>, note: string) {
  await wh.getByTestId("custom-shipment-goods-missing-open").click();
  const dialog = wh.getByTestId("custom-shipment-goods-missing-dialog");
  await expect(dialog).toBeVisible();
  for (const [rowId, n] of Object.entries(counts)) await wh.getByTestId(`custom-shipment-goods-missing-qty-${rowId}`).fill(String(n));
  await wh.getByTestId("custom-shipment-goods-missing-note").fill(note);
  await expect(wh.getByTestId("custom-shipment-goods-missing-confirm")).toBeEnabled();

  const [res] = await Promise.all([
    wh.waitForResponse((r) => r.url().endsWith(REPORT)),
    wh.getByTestId("custom-shipment-goods-missing-confirm").click(),
  ]);
  expect(res.status(), await res.text()).toBe(200);
  await expect(dialog).toHaveCount(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { body: (await res.json()) as any, sent: res.request().postDataJSON() as any };
}

test.describe("custom shipments — goods missing (Barang Tidak Ketemu)", () => {
  test.describe.configure({ timeout: 150_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const root = await browser.newPage();
    await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(root, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    g.seller = await team(g.sellerName, `GMS${SUFFIX}`, "TEAM_TYPE_SELLING");
    g.wh = await team(g.whName, `GMW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

    await api(root, "user.v1.UserService/CreateUser", { teamId: g.seller, username: ANI, password: PASSWORD, name: ANI_NAME, role: "ROLE_SELLING_OWNER" });
    await api(root, "user.v1.UserService/CreateUser", { teamId: g.wh, username: WAWAN, password: PASSWORD, name: WAWAN_NAME, role: "ROLE_WAREHOUSE_STAFF" });

    const rack = async (code: string) => String((await api(root, "inventory.v1.RackService/RackCreate", { teamId: g.wh, code, name: code })).rack.id);
    g.rackX = await rack(`gm-x-${SUFFIX}`);
    g.rackY = await rack(`gm-y-${SUFFIX}`);
    g.rackZ = await rack(`gm-z-${SUFFIX}`);

    const category = (await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E GM Cat ${SUFFIX}` })).category.id;
    const product = async (part: string, name: string) =>
      (await api(root, "product.v1.ProductService/ProductCreate", { teamId: g.seller, productCodePart: part, name, categoryId: category })).product;
    const p = await product(`GMP${SUFFIX}`, `Gelas Hilang ${SUFFIX}`);
    g.p = String(p.id);
    g.pCode = String(p.productCode || `GMP${SUFFIX}`);
    const q = await product(`GMQ${SUFFIX}`, `Vas Hilang ${SUFFIX}`);
    g.q = String(q.id);
    g.qCode = String(q.productCode || `GMQ${SUFFIX}`);

    const supplier = String((await api(root, "supplier.v1.SupplierService/SupplierCreate", { teamId: g.seller, ...SUPPLIER })).supplier.id);

    g.account = String(
      (
        await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: g.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E GM Kas ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `GM88-ACC-${SUFFIX}`,
          openingBalance: 1_000_000,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: g.seller, accountId: g.account, operational: true });

    const channels = await api(root, "shipment.v1.ShipmentChannelService/ShipmentChannelList", {
      dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"],
      page: { page: 1, limit: 100 },
    });
    const map = (channels.items as { channel?: { mapData: Record<string, { code: string }> } }[]).find((i) => i.channel)?.channel?.mapData;
    g.jne = Object.entries(map ?? {}).find(([, c]) => c.code === "jne")?.[0] ?? "";
    expect(g.jne, "the seeded jne courier").toBeTruthy();

    // P: one batch of 5, counted onto two racks — 2 on X, 3 on Y.
    const pRestock = (
      await api(root, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: g.seller,
        warehouseId: g.wh,
        financeAccountId: g.account,
        items: [{ productId: g.p, productCode: g.pCode, name: `Gelas Hilang ${SUFFIX}`, count: ON_X + ON_Y, total: (ON_X + ON_Y) * 10_000 }],
      })
    ).request;
    await api(root, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: g.wh,
      requestId: pRestock.id,
      lines: [
        {
          itemId: pRestock.items[0].id,
          receivedCount: ON_X + ON_Y,
          placements: [
            { placementId: g.rackX, quantity: ON_X },
            { placementId: g.rackY, quantity: ON_Y },
          ],
        },
      ],
    });

    // Q: 10 from the supplier, accepted with 4 broken — the reships draw on those.
    const qRestock = (
      await api(root, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: g.seller,
        warehouseId: g.wh,
        financeAccountId: g.account,
        receipt: `E2E-GM88-${SUFFIX}`,
        items: [{ productId: g.q, productCode: g.qCode, name: `Vas Hilang ${SUFFIX}`, count: ORDERED, total: 0, supplierId: supplier }],
      })
    ).request;
    g.restock = String(qRestock.id);
    g.restockItem = String(qRestock.items[0].id);
    await api(root, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: g.wh,
      requestId: g.restock,
      lines: [{ itemId: g.restockItem, receivedCount: ORDERED, brokenCount: BROKEN, brokenNote: "pecah di jalan", placements: [{ placementId: g.rackZ, quantity: GOOD }] }],
    });
    const tags = ((await api(root, "inventory.v1.RestockRequestService/RestockRequestDetail", { teamId: g.seller, requestId: g.restock })).request.tags ?? []) as {
      appTask?: string;
    }[];
    expect(tags.map((t) => t.appTask), JSON.stringify(tags)).toContain("restock.problem.broken");

    await root.close();
  });

  test("missing-goods-leave-a-note-on-the-custom-shipment — the warehouse notes a sample's goods missing on its pick page; it stays Diminta, no stock moves, both lists carry the badge, the team reads the notice and cancels", async ({
    browser,
    page,
  }) => {
    // Wawan (WAREHOUSE_STAFF, a picking role) on `page`; Ani (the selling team's owner) on a page of her own.
    await as(page, WAWAN, g.wh);
    const ani = await pageAs(browser, ANI, g.seller);
    const before = await racks(page);
    expect(before).toEqual({ [g.rackX]: ON_X, [g.rackY]: ON_Y });

    const id = await sampleByApi(ani, "a", SAMPLE);
    const taken = await pickedRacks(page, id);
    const rackIds = Object.keys(taken);
    expect(rackIds.sort(), "the take drew from both racks").toEqual([g.rackX, g.rackY].sort());
    expect(Object.values(taken).reduce((a, b) => a + b.qty, 0)).toBe(SAMPLE);
    const [r1, r2] = [g.rackX, g.rackY] as [string, string];
    const afterCreate = await racks(page);

    // THE CONTROL AND ITS DIALOG — one row per rack the take used, each prefilled with its rack and its own most.
    await page.goto(`/inventories/custom-shipments/${id}`);
    await expect(page.getByTestId("custom-shipment-pick-page")).toBeVisible();
    await expect(page.getByTestId(`custom-shipment-rack-${g.p}-${r1}`)).toBeVisible();
    await expect(page.getByTestId("custom-shipment-goods-missing-notice")).toHaveCount(0);
    await page.getByTestId("custom-shipment-goods-missing-open").click();
    const dialog = page.getByTestId("custom-shipment-goods-missing-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("custom-shipment-goods-missing-warning")).toContainText(g.sellerName);
    await expect(dialog.getByTestId("custom-shipment-goods-missing-warning")).toContainText("stays Requested");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-where")).toContainText("On another rack?");
    await expect(dialog.locator('[data-testid^="custom-shipment-goods-missing-row-"]')).toHaveCount(2);
    for (const rackId of rackIds) {
      const rowId = `${g.p}-${rackId}`;
      await expect(dialog.getByTestId(`custom-shipment-goods-missing-row-${rowId}`)).toBeVisible();
      await expect(dialog.getByTestId(`custom-shipment-goods-missing-rack-${rowId}`)).toHaveText(new RegExp(`^${reEscape(taken[rackId]!.code)}\\s*×${taken[rackId]!.qty}$`));
      const qty = dialog.getByTestId(`custom-shipment-goods-missing-qty-${rowId}`);
      await expect(qty).toHaveValue("");
      await expect(qty).toHaveAttribute("aria-valuemax", String(taken[rackId]!.qty));
    }
    await expect(dialog.getByTestId("custom-shipment-goods-missing-total")).toHaveText("Type how many are missing");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-confirm")).toBeDisabled();
    // More than the rack's own most is not recorded…
    await dialog.getByTestId(`custom-shipment-goods-missing-qty-${g.p}-${r1}`).fill(String(taken[r1]!.qty + 1));
    await expect(dialog.getByTestId("custom-shipment-goods-missing-confirm")).toBeDisabled();
    // …one is; the note is optional and counted against its 200.
    await dialog.getByTestId(`custom-shipment-goods-missing-qty-${g.p}-${r1}`).fill("1");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-total")).toHaveText("1 unit missing");
    await dialog.getByTestId("custom-shipment-goods-missing-note").fill(NOTE1);
    await expect(dialog.getByTestId("custom-shipment-goods-missing-note-count")).toHaveText(`${NOTE1.length}/200`);
    await expect(dialog).not.toContainText("Rp");
    await dialog.getByTestId("custom-shipment-goods-missing-dismiss").click();
    await expect(dialog).toHaveCount(0);

    // RECORDED — 1 missing on the first rack, with the note.
    const first = await record(page, { [`${g.p}-${r1}`]: 1 }, NOTE1);
    expect(first.sent.lines.map((l: { rackId: string; quantity: string }) => [String(l.rackId), String(l.quantity)])).toEqual([[r1, "1"]]);
    expect(first.sent.note).toBe(NOTE1);
    expect(first.body.customShipment.status).toBe("CUSTOM_SHIPMENT_STATUS_REQUESTED");
    const report1 = String(first.body.customShipment.goodsMissing.logId);
    expect(moneyKeys(first.body, SAMPLE_MONEY), JSON.stringify(first.body)).toEqual([]);

    // Still Diminta, the scan still there, the warehouse's own notice, and its trail row of its own kind.
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(page.getByTestId("pick-scan-input")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-goods-missing-open")).toBeVisible();
    const whNotice = page.getByTestId("custom-shipment-goods-missing-notice");
    await expect(whNotice).toHaveAttribute("data-side", "warehouse");
    await expect(whNotice.getByTestId(`custom-shipment-goods-missing-notice-line-${g.p}-${r1}`)).toContainText(new RegExp(`×1 · rack ${reEscape(taken[r1]!.code)}`, "i"));
    await expect(whNotice.getByTestId("custom-shipment-goods-missing-notice-note")).toContainText(NOTE1);
    await expect(whNotice.getByTestId("custom-shipment-goods-missing-notice-next")).toContainText(g.sellerName);
    const trail = page.getByTestId("custom-shipment-timeline");
    const row1 = page.getByTestId(`custom-shipment-timeline-missing-${report1}`);
    await expect(row1).toHaveAttribute("data-kind", "goods-missing");
    await expect(row1.getByTestId(`custom-shipment-timeline-missing-${report1}-by`)).toContainText(WAWAN_NAME);
    await expect(row1.getByTestId(`custom-shipment-timeline-missing-${report1}-line-${g.p}-${r1}`)).toContainText(new RegExp(`×1 · rack ${reEscape(taken[r1]!.code)}`, "i"));
    await expect(row1.getByTestId(`custom-shipment-timeline-missing-${report1}-note`)).toContainText(NOTE1);
    await expect(row1.getByTestId(`custom-shipment-timeline-missing-${report1}-stays`)).toContainText(`${g.sellerName} decides`);
    await expect(row1.getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(trail.locator('[data-kind="edit"]')).toHaveCount(0);
    await expect(page.getByTestId("custom-shipment-pick-page")).not.toContainText("Rp");

    // No stock write: both racks hold what they held after the take.
    expect(await racks(page)).toEqual(afterCreate);

    // The warehouse queue carries the badge — and the row it was sent carries the open note, no seller money.
    const [listed] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/warehouse.${SVC}/CustomShipmentList`)),
      page.goto("/inventories/custom-shipments"),
    ]);
    await expect(page.getByTestId("custom-shipments-warehouse")).toBeVisible();
    const queueRow = page.getByTestId(`custom-shipment-row-${id}`);
    await expect(queueRow.getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(queueRow.getByTestId(`custom-shipment-goods-missing-${id}`)).toBeVisible();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = (((await listed.json()).customShipments ?? []) as any[]).find((s) => String(s.id) === id);
    expect(String(mine?.goodsMissing?.logId), "the queue's row carries the open note").toBe(report1);
    expect(moneyKeys(mine, SAMPLE_MONEY), JSON.stringify(mine)).toEqual([]);

    // THE TEAM: the badge beside the status on its list, the notice on the detail, the trail row, Batalkan still there.
    await ani.goto("/inventories/custom-shipments");
    const teamRow = ani.getByTestId(`custom-shipment-row-${id}`);
    await expect(teamRow.getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(teamRow.getByTestId(`custom-shipment-goods-missing-${id}`)).toBeVisible();
    await expect(teamRow.getByTestId(`custom-shipment-goods-missing-${id}`)).toHaveAttribute("title", /^1 unit the warehouse cannot find/);
    await ani.goto(`/inventories/custom-shipments/${id}`);
    await expect(ani.getByTestId("custom-shipment-detail-page")).toBeVisible();
    const notice = ani.getByTestId("custom-shipment-goods-missing-notice");
    await expect(notice).toHaveAttribute("data-side", "selling");
    await expect(notice.getByTestId("custom-shipment-goods-missing-notice-title")).toHaveText(`${g.whName} cannot find the goods`);
    await expect(notice.getByTestId(`custom-shipment-goods-missing-notice-line-${g.p}-${r1}`)).toContainText(new RegExp(`×1 · rack ${reEscape(taken[r1]!.code)}`, "i"));
    await expect(notice.getByTestId("custom-shipment-goods-missing-notice-note")).toContainText(NOTE1);
    await expect(notice.getByTestId("custom-shipment-goods-missing-notice-next")).toContainText("Cancel it if it cannot wait");
    await expect(ani.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(ani.getByTestId(`custom-shipment-timeline-missing-${report1}-stays`)).toContainText(`From ${g.whName}`);
    await expect(ani.getByTestId(`custom-shipment-action-cancel-${id}`)).toBeVisible();

    // RECORDED AGAIN while Diminta (the prototype's default) — the latest is the open one.
    await page.goto(`/inventories/custom-shipments/${id}`);
    await expect(page.getByTestId(`custom-shipment-rack-${g.p}-${r2}`)).toBeVisible();
    const second = await record(page, { [`${g.p}-${r2}`]: 1 }, NOTE2);
    const report2 = String(second.body.customShipment.goodsMissing.logId);
    expect(report2).not.toBe(report1);
    await expect(trail.locator('[data-kind="goods-missing"]')).toHaveCount(2);
    await expect(whNotice.getByTestId(`custom-shipment-goods-missing-notice-line-${g.p}-${r2}`)).toBeVisible();
    await expect(whNotice.getByTestId(`custom-shipment-goods-missing-notice-line-${g.p}-${r1}`)).toHaveCount(0);
    await expect(whNotice.getByTestId("custom-shipment-goods-missing-notice-note")).toContainText(NOTE2);
    expect(await racks(page)).toEqual(afterCreate);

    await ani.goto(`/inventories/custom-shipments/${id}`);
    await expect(notice.getByTestId(`custom-shipment-goods-missing-notice-line-${g.p}-${r2}`)).toBeVisible();
    await expect(notice.getByTestId(`custom-shipment-goods-missing-notice-line-${g.p}-${r1}`)).toHaveCount(0);
    await expect(notice.getByTestId("custom-shipment-goods-missing-notice-note")).toContainText(NOTE2);

    // THE TEAM CANCELS (Batalkan): the notice and both badges go, the trail keeps both rows, the take is put back.
    await ani.getByTestId(`custom-shipment-action-cancel-${id}`).click();
    await ani.getByTestId("confirm-action").click();
    await expect(ani.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-cancelled")).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect(ani.getByTestId(`custom-shipment-timeline-missing-${report1}`)).toBeVisible();
    await expect(ani.getByTestId(`custom-shipment-timeline-missing-${report2}`)).toBeVisible();
    await ani.goto("/inventories/custom-shipments");
    await expect(teamRow.getByTestId("custom-shipment-status-cancelled")).toBeVisible();
    await expect(teamRow.getByTestId(`custom-shipment-goods-missing-${id}`)).toHaveCount(0);

    await page.goto("/inventories/custom-shipments");
    await expect(queueRow.getByTestId("custom-shipment-status-cancelled")).toBeVisible();
    await expect(queueRow.getByTestId(`custom-shipment-goods-missing-${id}`)).toHaveCount(0);
    await page.goto(`/inventories/custom-shipments/${id}`);
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-cancelled")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-goods-missing-notice")).toHaveCount(0);
    await expect(page.getByTestId("custom-shipment-goods-missing-open")).toHaveCount(0);
    await expect(trail.locator('[data-kind="goods-missing"]')).toHaveCount(2);
    expect(await racks(page)).toEqual(before);
    await ani.close();
  });

  test("the server refuses a goods-missing note by the selling team, over a rack's most, and once the parcel is picked, handed over or cancelled", async ({
    browser,
    page,
  }) => {
    await as(page, WAWAN, g.wh);
    const ani = await pageAs(browser, ANI, g.seller);
    const b = await sampleByApi(ani, "b", 1);
    const c = await sampleByApi(ani, "c", 1);
    const takeB = await pickedRacks(page, b);
    const takeC = await pickedRacks(page, c);
    const itemOf = async (id: string) => String((await api(ani, `${SVC}/CustomShipmentDetail`, { teamId: g.seller, id })).customShipment.items[0].id);
    const note = (id: string, item: string, rackId: string, quantity = 1) => ({ teamId: g.wh, id, lines: [{ itemId: item, rackId, quantity: String(quantity) }], note: "e2e" });
    const [itemB, itemC] = [await itemOf(b), await itemOf(c)];
    const [rackB, rackC] = [Object.keys(takeB)[0]!, Object.keys(takeC)[0]!];
    const notes = async (id: string) =>
      (((await api(page, `${SVC}/CustomShipmentDetail`, { teamId: g.wh, id })).customShipment.logs ?? []) as { kind?: string }[]).filter(
        (l) => l.kind === "CUSTOM_SHIPMENT_LOG_KIND_GOODS_MISSING",
      );

    // The selling team may not record one, even on its own Diminta parcel (the hand-off: the warehouse's picking roles).
    const bySeller = await call(ani, `${SVC}/CustomShipmentMissingReport`, { ...note(b, itemB, rackB), teamId: g.seller });
    expect(bySeller.status, JSON.stringify(bySeller.body)).not.toBe(200);
    expect(bySeller.body.code).toBe("permission_denied");

    // More than the take drew from that rack is refused (each row its own most).
    const over = await call(page, `${SVC}/CustomShipmentMissingReport`, note(b, itemB, rackB, 2));
    expect(over.body.code, JSON.stringify(over.body)).toBe("invalid_argument");
    expect(await notes(b)).toEqual([]);

    // Picked: refused, and the control is gone.
    await api(page, `${SVC}/CustomShipmentPicked`, { teamId: g.wh, id: b });
    const picked = await call(page, `${SVC}/CustomShipmentMissingReport`, note(b, itemB, rackB));
    expect(picked.body.code, JSON.stringify(picked.body)).toBe("failed_precondition");
    await page.goto(`/inventories/custom-shipments/${b}`);
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-picked")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-goods-missing-open")).toHaveCount(0);

    // Handed over: refused.
    await api(page, `${SVC}/CustomShipmentHandover`, { teamId: g.wh, id: b, shippingCost: 5_000, resi: `GM88-R-${SUFFIX}` });
    const handed = await call(page, `${SVC}/CustomShipmentMissingReport`, note(b, itemB, rackB));
    expect(handed.body.code, JSON.stringify(handed.body)).toBe("failed_precondition");
    expect(await notes(b)).toEqual([]);

    // Cancelled by the team while Diminta: refused, and the control is gone.
    await api(ani, `${SVC}/CustomShipmentCancel`, { teamId: g.seller, id: c });
    const cancelled = await call(page, `${SVC}/CustomShipmentMissingReport`, note(c, itemC, rackC));
    expect(cancelled.body.code, JSON.stringify(cancelled.body)).toBe("failed_precondition");
    await page.goto(`/inventories/custom-shipments/${c}`);
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-cancelled")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-goods-missing-open")).toHaveCount(0);
    expect(await notes(c)).toEqual([]);
    await ani.close();
  });

  test("missing-reship-units-are-not-offered-again — a reship's broken units noted not found stay off the form after its cancel (cap and server), the others are free, and the line reads the-reship-line-counts-the-units-not-found", async ({
    browser,
    page,
  }) => {
    await as(page, WAWAN, g.wh);
    const ani = await pageAs(browser, ANI, g.seller);

    // A reship of 3 of the 4 broken units, Kami bayar — the money the warehouse must never be sent.
    const made = await reshipCall(ani, "r1", 3, "team");
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const id = String(made.body.customShipment.id);

    // THE DIALOG ON A RESHIP — one row naming no rack, its most the line's 3.
    await page.goto(`/inventories/custom-shipments/${id}`);
    await expect(page.getByTestId("custom-shipment-pick-page")).toBeVisible();
    await page.getByTestId("custom-shipment-goods-missing-open").click();
    const dialog = page.getByTestId("custom-shipment-goods-missing-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("custom-shipment-goods-missing-warning")).toContainText("no rack stock moves");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-where")).toContainText(`#${g.restock}`);
    await expect(dialog.locator('[data-testid^="custom-shipment-goods-missing-row-"]')).toHaveCount(1);
    await expect(dialog.getByTestId(`custom-shipment-goods-missing-rack-${g.q}-0`)).toHaveText("×3 broken");
    await expect(dialog.getByTestId(`custom-shipment-goods-missing-qty-${g.q}-0`)).toHaveAttribute("aria-valuemax", "3");
    await expect(dialog).not.toContainText("Rp");
    await dialog.getByTestId("custom-shipment-goods-missing-dismiss").click();

    // 2 of the 3 not found.
    const noted = await record(page, { [`${g.q}-0`]: 2 }, NOTE_RESHIP);
    expect(noted.sent.lines.map((l: { rackId?: string; quantity: string }) => [String(l.rackId ?? "0"), String(l.quantity)])).toEqual([["0", "2"]]);
    expect(moneyKeys(noted.body), JSON.stringify(noted.body)).toEqual([]);
    const report = String(noted.body.customShipment.goodsMissing.logId);
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(page.getByTestId(`custom-shipment-timeline-missing-${report}-line-${g.q}-0`)).toContainText("×2 · broken, never on a rack");
    await expect(page.getByTestId("custom-shipment-goods-missing-notice").getByTestId(`custom-shipment-goods-missing-notice-line-${g.q}-0`)).toContainText("×2");
    await expect(page.getByTestId("custom-shipment-pick-page")).not.toContainText("Rp");

    // What the warehouse reads of it — Detail and its queue's row — carries the note and no seller money.
    const seen = await api(page, `${SVC}/CustomShipmentDetail`, { teamId: g.wh, id });
    expect(moneyKeys(seen), JSON.stringify(seen)).toEqual([]);
    expect(String(seen.customShipment.goodsMissing.logId)).toBe(report);
    const [listed] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/warehouse.${SVC}/CustomShipmentList`)),
      page.goto("/inventories/custom-shipments"),
    ]);
    await expect(page.getByTestId(`custom-shipment-row-${id}`).getByTestId(`custom-shipment-goods-missing-${id}`)).toBeVisible();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (((await listed.json()).customShipments ?? []) as any[]).find((s) => String(s.id) === id);
    expect(String(row?.goodsMissing?.logId)).toBe(report);
    expect(moneyKeys(row), JSON.stringify(row)).toEqual([]);

    // While the reship is live its 3 are on a parcel and nothing is gone yet — the sentence exactly as before.
    expect(await reshipLine(ani)).toEqual({ broken: BROKEN, alreadySent: 3, notFound: 0 });
    let option = await openReshipForm(ani);
    await option.click();
    await expect(ani.getByTestId(`custom-shipment-form-broken-left-${g.q}`)).toHaveText(`1 left · ${BROKEN} broken, 3 already on a parcel`);

    // The team reads the reship's notice and cancels it.
    await ani.goto(`/inventories/custom-shipments/${id}`);
    await expect(ani.getByTestId("custom-shipment-goods-missing-notice").getByTestId("custom-shipment-goods-missing-notice-next")).toContainText("no rack stock moves");
    await ani.getByTestId(`custom-shipment-action-cancel-${id}`).click();
    await ani.getByTestId("confirm-action").click();
    await expect(ani.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-cancelled")).toBeVisible();
    await expect(ani.getByTestId("custom-shipment-goods-missing-notice")).toHaveCount(0);

    // THE NAMED 2 ARE GONE: 4 broken − 2 not found = 2 offered — the third unit of the cancelled reship is free again.
    expect(await reshipLine(ani)).toEqual({ broken: BROKEN, alreadySent: 0, notFound: 2 });
    option = await openReshipForm(ani);
    await expect(option).toContainText("2 broken units");
    await option.click();
    const sentence = ani.getByTestId(`custom-shipment-form-broken-left-${g.q}`);
    await expect(sentence).toHaveText(`2 left · ${BROKEN} broken, 2 not found`);
    const count = ani.getByTestId(`custom-shipment-form-broken-count-${g.q}`);
    await expect(count).toHaveValue("2");
    await expect(count).toHaveAttribute("aria-valuemax", "2");
    await ani.getByTestId("shipment-channel-select").getByRole("combobox").click();
    await ani.getByTestId("shipment-channel-option-jne").click();
    await count.fill("3");
    await expect(ani.getByTestId("custom-shipment-form-missing-overBroken")).toBeVisible();
    await expect(ani.getByTestId("custom-shipment-form-submit")).toBeDisabled();
    await count.fill("2");
    await expect(ani.getByTestId("custom-shipment-form-missing-overBroken")).toHaveCount(0);
    await expect(ani.getByTestId("custom-shipment-form-submit")).toBeEnabled();
    // …and the server refuses 3 on the contract too.
    const over3 = await reshipCall(ani, "over3", 3, "warehouse");
    expect(over3.status, JSON.stringify(over3.body)).not.toBe(200);
    expect(over3.body.code).toBe("failed_precondition");

    // With another live reship holding 1: "1 left · 4 broken, 1 on a parcel, 2 not found"; 2 more refused.
    const live = await reshipCall(ani, "r2", 1, "warehouse");
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    option = await openReshipForm(ani);
    await expect(option).toContainText("1 broken unit");
    await option.click();
    await expect(sentence).toHaveText(`1 left · ${BROKEN} broken, 1 on a parcel, 2 not found`);
    await expect(count).toHaveAttribute("aria-valuemax", "1");
    const over2 = await reshipCall(ani, "over2", 2, "warehouse");
    expect(over2.body.code, JSON.stringify(over2.body)).toBe("failed_precondition");

    // The last free unit goes on a reship of its own — then the restock has nothing left to offer: the 2 stay gone.
    const last = await reshipCall(ani, "r3", 1, "warehouse");
    expect(last.status, JSON.stringify(last.body)).toBe(200);
    expect(await reshipLine(ani)).toBeUndefined();
    const none = await reshipCall(ani, "over1", 1, "warehouse");
    expect(none.body.code, JSON.stringify(none.body)).toBe("failed_precondition");
    await ani.close();
  });
});

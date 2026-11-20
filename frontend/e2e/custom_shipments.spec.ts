import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { pickTeam } from "./pickers";

// CUSTOM SHIPMENTS — THE SAMPLE, END TO END, with the courier paid by the warehouse (*Gudang bayar*). Regression spec:
// no acceptance rows exist for custom shipments yet. Business rules (docs/business/custom_shipments/context_decision.md):
//
//   custom-shipments-sit-in-inventories-after-transfer — the menu line, right after Transfer, on both sides;
//   the-selling-team-asks-the-warehouse-ships — the owning selling team asks on the form, the warehouse picks and hands over;
//   the-custom-shipments-prototype-is-accepted (*as drawn*) — a sample's units leave stock AT CREATE, oldest batch first,
//     from racks the system picks, valued at the batch value the team sees; *Gudang bayar* picked first; the warehouse
//     sees no seller money on any screen nor in the data it receives;
//   a-custom-shipment-is-cancelled-only-while-requested — only while Diminta; a cancelled sample's units go back on the
//     racks they left (a-rollback-only-undoes-a-take 🔄, docs/business/inventory/transaction_decision.md);
//   the-courier-is-paid-by-the-team-or-by-the-warehouse — *Gudang bayar*: the warehouse types the real cost at the
//     handover (required, 0 allowed), and the selling team owes it back on Team Balance, as a restock's courier charge
//     (its own source type, as a-transfer-charge-is-a-transfer-fee asks); the warehouse's daily statement counts it in its
//     one courier column.
//
// The *Kami bayar* money and the reship are custom_shipments_reship.spec.ts's.
//
// Ground (root seeds it through the real contract): a selling team whose OWNER is a person of its own, a warehouse whose
// OWNER is a person of its own, one product of the selling team with TWO batches at the warehouse — the older one 4 units
// at Rp 10.000 on rack X, the newer one 8 units at Rp 20.000 on rack Y — so a sample's value says which batch it took.
// Each person also owns a second team of the same type (OTHER, W2), which reads the parcel as another team would.
//
// ⚠ NOT PINNED (no rule says): WHICH rack the system picks (the build takes the rack holding the fewest first) — the spec
// reads the racks the pick page names and proves each lost exactly what it says; which roles beyond the owners may
// create / pick (the build's default); what the warehouse scans (the order pick page's item scans, reused).

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-css-pass-1";
const OWNER = `e2ecssown${SUFFIX}`;
const KEEPER = `e2ecsswh${SUFFIX}`;
const SVC = "inventory.v1.CustomShipmentService";

const OLD_UNITS = 4; // the older batch, Rp 10.000 a unit, on rack X
const NEW_UNITS = 8; // the newer batch, Rp 20.000 a unit, on rack Y
const SENT = 2; // the first sample
const COURIER = 15_000; // what the warehouse paid the courier at the handover

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const jakartaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const g = {
  seller: "",
  sellerCode: `CSSS${SUFFIX}`,
  sellerName: `E2E CSS Seller ${SUFFIX}`,
  other: "",
  wh: "",
  whCode: `CSSW${SUFFIX}`,
  wh2: "",
  rackX: "",
  rackY: "",
  product: "",
  productCode: "",
  first: "", // the sample handed over
  second: "", // the sample cancelled while Diminta
  resi: `CSSR${SUFFIX}`,
};

// The real contract under the signed-in token; a refusal fails here, by name and status.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(page: Page, method: string, body: unknown): Promise<any> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
  );
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function asTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// A person signed in on `page`, working in `teamId` — the sign-in's own loads settled before the next goto.
async function as(page: Page, username: string, teamId: string) {
  await signIn(page, username, PASSWORD);
  await page.waitForLoadState("networkidle");
  await asTeam(page, teamId);
}

// The warehouse's keeper on a page of its own, in the shipping warehouse.
async function keeper(browser: Browser): Promise<Page> {
  const wh = await browser.newPage();
  await as(wh, KEEPER, g.wh);
  return wh;
}

// What a rack holds of the product, read off its own page as the warehouse.
async function onRack(wh: Page, rackId: string): Promise<number> {
  await wh.goto(`/inventories/racks/${rackId}`);
  const cell = wh.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${g.product}`);
  await expect(cell).toBeVisible();
  return Number((await cell.innerText()).replace(/[^0-9]/g, ""));
}

async function racks(wh: Page): Promise<Record<string, number>> {
  return { [g.rackX]: await onRack(wh, g.rackX), [g.rackY]: await onRack(wh, g.rackY) };
}

// The racks the warehouse's pick page names for the product — the system's choice, each with its count.
async function pickedRacks(wh: Page, id: string): Promise<Record<string, number>> {
  await wh.goto(`/inventories/custom-shipments/${id}`);
  await expect(wh.getByTestId("custom-shipment-pick-page")).toBeVisible();
  const rows = wh.locator(`[data-testid^="custom-shipment-rack-${g.product}-"]`);
  await expect(rows.first()).toBeVisible();

  const out: Record<string, number> = {};
  for (const row of await rows.all()) {
    const rackId = (await row.getAttribute("data-testid"))!.slice(`custom-shipment-rack-${g.product}-`.length);
    out[rackId] = Number(/×(\d+)/.exec(await row.innerText())![1]);
  }
  return out;
}

// The statement table's cell under `header` on `bucket`'s row — found by its header, never a fixed index.
async function statementCell(page: Page, bucket: string, header: string): Promise<number> {
  const headers = page.getByTestId("statement-table").locator("thead th");
  const names = (await headers.allInnerTexts()).map((h) => h.trim());
  const index = names.indexOf(header);
  if (index < 0) throw new Error(`no "${header}" column on the statement table: ${names.join(" | ")}`);
  const text = await page.getByTestId(`statement-row-${bucket}`).locator("td").nth(index).innerText();
  return Number(text.replace(/[^0-9]/g, ""));
}

test.describe("custom shipments — a sample, Gudang bayar", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const root = await browser.newPage();
    await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string, ownerUserId = ROOT_USER_ID) =>
      String((await api(root, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId })).team.id);
    const person = async (teamId: string, username: string, role: string) =>
      String((await api(root, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name: username, role })).user.id);

    g.seller = await team(g.sellerName, g.sellerCode, "TEAM_TYPE_SELLING");
    const owner = await person(g.seller, OWNER, "ROLE_SELLING_OWNER");
    g.other = await team(`E2E CSS Other Seller ${SUFFIX}`, `CSSO${SUFFIX}`, "TEAM_TYPE_SELLING", owner);

    g.wh = await team(`E2E CSS Warehouse ${SUFFIX}`, g.whCode, "TEAM_TYPE_WAREHOUSE");
    const keeperId = await person(g.wh, KEEPER, "ROLE_WAREHOUSE_OWNER");
    g.wh2 = await team(`E2E CSS Warehouse Two ${SUFFIX}`, `CSSV${SUFFIX}`, "TEAM_TYPE_WAREHOUSE", keeperId);

    const rack = async (code: string) =>
      String((await api(root, "inventory.v1.RackService/RackCreate", { teamId: g.wh, code, name: code })).rack.id);
    g.rackX = await rack(`css-x-${SUFFIX}`);
    g.rackY = await rack(`css-y-${SUFFIX}`);

    const category = await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E CSS Cat ${SUFFIX}` });
    const created = (
      await api(root, "product.v1.ProductService/ProductCreate", {
        teamId: g.seller,
        productCodePart: `CSSP${SUFFIX}`,
        name: `Gelas Sampel ${SUFFIX}`,
        categoryId: category.category.id,
      })
    ).product;
    g.product = String(created.id);
    g.productCode = String(created.productCode || `CSSP${SUFFIX}`);

    const account = String(
      (
        await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: g.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E CSS Kas ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `CSS-ACC-${SUFFIX}`,
          openingBalance: 1_000_000,
          openingOn: jakartaToday(),
        })
      ).account.id,
    );
    await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: g.seller,
      accountId: account,
      operational: true,
    });

    // Two batches, the older first: a restock counted in whole onto one rack each.
    const stock = async (count: number, total: number, rackId: string) => {
      const raised = (
        await api(root, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: g.seller,
          warehouseId: g.wh,
          financeAccountId: account,
          items: [{ productId: g.product, productCode: g.productCode, name: `Gelas Sampel ${SUFFIX}`, count, total }],
        })
      ).request;
      await api(root, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: g.wh,
        requestId: raised.id,
        lines: [{ itemId: raised.items[0].id, receivedCount: count, placements: [{ placementId: rackId, quantity: count }] }],
      });
    };
    await stock(OLD_UNITS, OLD_UNITS * 10_000, g.rackX);
    await stock(NEW_UNITS, NEW_UNITS * 20_000, g.rackY);

    await root.close();
  });

  test("custom-shipments-sit-in-inventories-after-transfer — the menu line follows Transfer on the selling side and on the warehouse side", async ({
    browser,
    page,
  }) => {
    const sits = async (p: Page, side: "selling" | "warehouse") => {
      await p.goto("/");
      const group = p.getByTestId("nav-group-nav.inventories");
      const link = group.locator('a[href="/inventories/custom-shipments"]');
      await expect(link).toHaveCount(1);
      await expect(link).toHaveText("Custom Shipments");
      // RIGHT AFTER Transfer: the line before it in the group is the transfer's.
      expect(await link.evaluate((el) => el.previousElementSibling?.getAttribute("href"))).toBe("/inventories/transfer");

      if (!(await link.isVisible())) await p.getByTestId("nav-group-toggle-nav.inventories").click();
      await link.click();
      await expect(p).toHaveURL(/\/inventories\/custom-shipments$/);
      await expect(p.getByTestId(`custom-shipments-${side}`)).toBeVisible();
    };

    await as(page, OWNER, g.seller);
    await sits(page, "selling");

    const wh = await keeper(browser);
    await sits(wh, "warehouse");
    await wh.close();
  });

  test("the-selling-team-asks-the-warehouse-ships — the owner asks for a sample on the form, Gudang bayar first, and it lands on the list as Diminta", async ({
    page,
  }) => {
    await as(page, OWNER, g.seller);
    await page.goto("/inventories/custom-shipments");
    await page.getByTestId("open-create-custom-shipment").click();
    await expect(page).toHaveURL(/\/inventories\/custom-shipments\/new$/);
    await expect(page.getByTestId("custom-shipment-form")).toBeVisible();

    // A sample is the kind the form starts on; Gudang bayar is the first way to pay, and picked — no account asked.
    await expect(page.getByTestId("custom-shipment-form-kind-sample").locator("input")).toBeChecked();
    const payers = page.getByTestId("custom-shipment-form-payer").locator('[data-testid^="custom-shipment-form-payer-"]');
    await expect(payers.first()).toHaveAttribute("data-testid", "custom-shipment-form-payer-warehouse");
    await expect(page.getByTestId("custom-shipment-form-payer-warehouse").locator("input")).toBeChecked();
    await expect(page.getByTestId("custom-shipment-form-team-pays")).toHaveCount(0);

    await pickTeam(page, page.getByTestId("custom-shipment-form-warehouse"), g.whCode);
    await page.getByTestId("custom-shipment-form-pick").click();
    const option = page.getByTestId(`product-picker-option-${g.product}`);
    await option.locator('[data-part="control"]').click();
    await expect(option.locator('input[type="checkbox"]')).toBeChecked();
    await page.getByTestId("product-picker-confirm").click();

    // The team's stock at that warehouse, both batches.
    await expect(page.getByTestId(`custom-shipment-form-available-${g.product}`)).toHaveText(`${OLD_UNITS + NEW_UNITS} on hand`);
    await page.getByTestId(`custom-shipment-form-count-${g.product}`).fill(String(SENT));

    await page.getByTestId("custom-shipment-form-name").fill(`Budi Sampel ${SUFFIX}`);
    await page.getByTestId("custom-shipment-form-phone").fill("081234567890");
    await page.getByTestId("custom-shipment-form-address").fill("Jl. Melati 7, Bandung");
    await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
    await page.getByTestId("shipment-channel-option-jne").click();

    await expect(page.getByTestId("custom-shipment-form-submit")).toBeEnabled();
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/warehouse.${SVC}/CustomShipmentCreate`)),
      page.getByTestId("custom-shipment-form-submit").click(),
    ]);
    expect(created.status()).toBe(200);
    // Gudang bayar sends no account and no cost — the warehouse types the cost at the handover.
    const sent = created.request().postDataJSON() as Record<string, unknown>;
    expect(sent.payer).toBe("CUSTOM_SHIPMENT_PAYER_WAREHOUSE");
    expect(Number(sent.financeAccountId ?? 0)).toBe(0);
    expect(Number(sent.shippingCost ?? 0)).toBe(0);

    await expect(page).toHaveURL(/\/inventories\/custom-shipments\/\d+$/);
    g.first = /\/inventories\/custom-shipments\/(\d+)$/.exec(page.url())![1]!;
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-requested")).toBeVisible();

    await page.goto("/inventories/custom-shipments");
    const row = page.getByTestId(`custom-shipment-row-${g.first}`);
    await expect(row.getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(row.getByTestId("custom-shipment-kind-sample")).toBeVisible();
    await expect(page.getByTestId(`custom-shipment-pay-${g.first}`)).toBeVisible();
  });

  test("the-custom-shipments-prototype-is-accepted — a sample's units leave stock at create, oldest batch first, from racks the system picks, at the batch value the team sees", async ({
    browser,
    page,
  }) => {
    // Still Diminta — nobody has picked it — and the units are already off the racks the system chose.
    const wh = await keeper(browser);
    const taken = await pickedRacks(wh, g.first);
    await expect(wh.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-requested")).toBeVisible();
    expect(Object.values(taken).reduce((a, b) => a + b, 0)).toBe(SENT);

    const before: Record<string, number> = { [g.rackX]: OLD_UNITS, [g.rackY]: NEW_UNITS };
    const now = await racks(wh);
    for (const [rackId, qty] of Object.entries(taken)) {
      expect(rackId in before, `the take names a rack of this ground (${rackId})`).toBe(true);
      expect(now[rackId]).toBe(before[rackId]! - qty);
    }
    expect(now[g.rackX]! + now[g.rackY]!).toBe(OLD_UNITS + NEW_UNITS - SENT);
    await wh.close();

    // The team reads the value at the OLDER batch's price — 2 × Rp 10.000, never the newer batch's Rp 20.000.
    await as(page, OWNER, g.seller);
    await page.goto(`/inventories/custom-shipments/${g.first}`);
    await expect(page.getByTestId("custom-shipment-detail-page")).toBeVisible();
    await expect(page.getByTestId(`custom-shipment-qty-${g.product}`)).toHaveText(String(SENT));
    await expect(page.getByTestId(`custom-shipment-value-${g.product}`)).toHaveText(rp(SENT * 10_000));
    await expect(page.getByTestId("custom-shipment-total")).toHaveText(rp(SENT * 10_000));
    await page.goto("/inventories/custom-shipments");
    await expect(page.getByTestId(`custom-shipment-value-${g.first}`)).toHaveText(rp(SENT * 10_000));

    // …and its own form reads the stock that is left at that warehouse.
    await page.goto("/inventories/custom-shipments/new");
    await pickTeam(page, page.getByTestId("custom-shipment-form-warehouse"), g.whCode);
    await page.getByTestId("custom-shipment-form-pick").click();
    await page.getByTestId(`product-picker-option-${g.product}`).locator('[data-part="control"]').click();
    await page.getByTestId("product-picker-confirm").click();
    await expect(page.getByTestId(`custom-shipment-form-available-${g.product}`)).toHaveText(`${OLD_UNITS + NEW_UNITS - SENT} on hand`);
  });

  test("a-warehouse-sees-no-seller-money — the queue lists the parcel with no value, the pick page shows no value and no ongkir figure, and none is sent", async ({
    browser,
  }) => {
    const wh = await keeper(browser);

    // The queue: the parcel is there, with no value column and no value in the rows it received.
    const [listed] = await Promise.all([
      wh.waitForResponse((r) => r.url().endsWith(`/warehouse.${SVC}/CustomShipmentList`)),
      wh.goto("/inventories/custom-shipments"),
    ]);
    await expect(wh.getByTestId("custom-shipments-warehouse")).toBeVisible();
    await expect(wh.getByTestId(`custom-shipment-row-${g.first}`).getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(wh.locator('[data-testid^="custom-shipment-value-"]')).toHaveCount(0);
    expect((await wh.getByTestId("custom-shipments-table").locator("thead th").allInnerTexts()).map((h) => h.trim())).not.toContain("Value");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = ((await listed.json()).customShipments ?? []) as any[];
    const mine = rows.find((s) => String(s.id) === g.first);
    expect(mine, "the queue's answer carries the parcel").toBeTruthy();
    expect(mine.total).toBeUndefined();
    expect((mine.items ?? []).map((i: { total?: number }) => i.total)).toEqual((mine.items ?? []).map(() => undefined));

    // The pick page: the lines and their racks, no value, no total, the ongkir only as words.
    const [detail] = await Promise.all([
      wh.waitForResponse((r) => r.url().endsWith(`/warehouse.${SVC}/CustomShipmentDetail`)),
      wh.goto(`/inventories/custom-shipments/${g.first}`),
    ]);
    await expect(wh.getByTestId("custom-shipment-pick-page")).toBeVisible();
    await expect(wh.getByTestId(`custom-shipment-qty-${g.product}`)).toHaveText(String(SENT));
    await expect(wh.locator('[data-testid^="custom-shipment-value-"]')).toHaveCount(0);
    await expect(wh.getByTestId("custom-shipment-total")).toHaveCount(0);
    await expect(wh.getByTestId("custom-shipment-lines-total")).not.toContainText("Rp");
    await expect(wh.getByTestId("custom-shipment-detail-ongkir")).toBeVisible();
    await expect(wh.getByTestId("custom-shipment-detail-ongkir")).not.toContainText(/Rp|\d/);
    const read = (await detail.json()).customShipment;
    expect(read.total).toBeUndefined();
    expect((read.items ?? []).every((i: { total?: number }) => i.total === undefined)).toBe(true);

    await wh.close();
  });

  test("another team's parcel reads not found — another selling team of the same owner, another warehouse of the same keeper", async ({
    browser,
    page,
  }) => {
    await as(page, OWNER, g.other);
    await page.goto(`/inventories/custom-shipments/${g.first}`);
    await expect(page.getByTestId("custom-shipment-not-found")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-detail-page")).toHaveCount(0);
    await expect(api(page, `${SVC}/CustomShipmentDetail`, { teamId: g.other, id: g.first })).rejects.toThrow(/: 404 /);

    const wh = await browser.newPage();
    await as(wh, KEEPER, g.wh2);
    await wh.goto(`/inventories/custom-shipments/${g.first}`);
    await expect(wh.getByTestId("custom-shipment-not-found")).toBeVisible();
    await expect(wh.getByTestId("custom-shipment-pick-page")).toHaveCount(0);
    await expect(api(wh, `${SVC}/CustomShipmentDetail`, { teamId: g.wh2, id: g.first })).rejects.toThrow(/: 404 /);
    await wh.close();
  });

  test("a-custom-shipment-is-cancelled-only-while-requested — the warehouse scans and marks it picked; then the team has no cancel", async ({
    browser,
    page,
  }) => {
    // While Diminta the team's cancel is on the list's ⋯ and on the detail's header.
    await as(page, OWNER, g.seller);
    await page.goto("/inventories/custom-shipments");
    await page.getByTestId(`custom-shipment-actions-${g.first}`).click();
    await expect(page.getByTestId(`custom-shipment-action-cancel-${g.first}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(`/inventories/custom-shipments/${g.first}`);
    await expect(page.getByTestId(`custom-shipment-action-cancel-${g.first}`)).toBeVisible();

    // The warehouse scans every unit by its product code, then marks it picked.
    const wh = await keeper(browser);
    await wh.goto(`/inventories/custom-shipments/${g.first}`);
    const scan = wh.getByTestId("pick-scan-input");
    await expect(scan).toBeVisible();
    await expect(wh.getByTestId("pick-order-set-picked")).toBeDisabled();
    for (let n = 0; n < SENT; n += 1) {
      await scan.fill(g.productCode);
      await scan.press("Enter");
    }
    await expect(wh.locator("[data-testid^='pick-scan-line-']").first()).toHaveAttribute("data-exact", "true");
    await wh.getByTestId("pick-order-set-picked").click();
    await expect(wh.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-picked")).toBeVisible();
    await expect(wh.getByTestId("pick-scan-input")).toHaveCount(0);
    await expect(wh.getByTestId("custom-shipment-handover-open")).toBeVisible();
    await wh.close();

    // Picked: no cancel on the list — the ⋯ has nothing to offer a Gudang bayar parcel — nor on the detail.
    await page.goto("/inventories/custom-shipments");
    await expect(page.getByTestId(`custom-shipment-row-${g.first}`).getByTestId("custom-shipment-status-picked")).toBeVisible();
    await expect(page.getByTestId(`custom-shipment-actions-${g.first}`)).toHaveCount(0);
    await expect(page.getByTestId(`custom-shipment-action-cancel-${g.first}`)).toHaveCount(0);
    await page.goto(`/inventories/custom-shipments/${g.first}`);
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-picked")).toBeVisible();
    await expect(page.getByTestId(`custom-shipment-action-cancel-${g.first}`)).toHaveCount(0);

    // …and the server refuses it too: the parcel stays picked.
    await expect(api(page, `${SVC}/CustomShipmentCancel`, { teamId: g.seller, id: g.first })).rejects.toThrow(/: 4\d\d /);
    const after = (await api(page, `${SVC}/CustomShipmentDetail`, { teamId: g.seller, id: g.first })).customShipment;
    expect(after.status).toBe("CUSTOM_SHIPMENT_STATUS_PICKED");
  });

  test("the-courier-is-paid-by-the-team-or-by-the-warehouse — Gudang bayar's handover asks the cost (empty refused) and hands over with Rp 15.000 and a resi", async ({
    browser,
    page,
  }) => {
    const wh = await keeper(browser);
    await wh.goto(`/inventories/custom-shipments/${g.first}`);
    await wh.getByTestId("custom-shipment-handover-open").click();
    const dialog = wh.getByTestId("custom-shipment-handover");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("custom-shipment-handover-team-pays")).toHaveCount(0);

    // An empty cost is a cost not typed — the dialog will not hand over on it…
    await expect(dialog.getByTestId("custom-shipment-handover-cost")).toHaveValue("");
    await dialog.getByTestId("custom-shipment-handover-resi").fill(g.resi);
    await expect(wh.getByTestId("confirm-action")).toBeDisabled();
    // …and nor will the server: a Gudang bayar handover with no cost is refused, the parcel still picked.
    await expect(api(wh, `${SVC}/CustomShipmentHandover`, { teamId: g.wh, id: g.first, resi: g.resi })).rejects.toThrow(/: 4\d\d /);

    await dialog.getByTestId("custom-shipment-handover-cost").fill(String(COURIER));
    await expect(wh.getByTestId("confirm-action")).toBeEnabled();
    await wh.getByTestId("confirm-action").click();
    await expect(wh.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-handed_over")).toBeVisible();
    await expect(wh.getByTestId("custom-shipment-detail-resi")).toContainText(g.resi);
    await expect(wh.getByTestId("custom-shipment-handover-open")).toHaveCount(0);
    await wh.close();

    // The team reads it handed over; the trail holds the create and both steps, the handover's row the cost and the resi.
    await as(page, OWNER, g.seller);
    await page.goto(`/inventories/custom-shipments/${g.first}`);
    await expect(page.getByTestId("custom-shipment-detail-status").getByTestId("custom-shipment-status-handed_over")).toBeVisible();
    await expect(page.getByTestId("custom-shipment-detail-ongkir")).toContainText(rp(COURIER));
    const trail = page.getByTestId("custom-shipment-timeline");
    await expect(trail.locator('[data-testid^="custom-shipment-timeline-"][data-kind="created"]')).toHaveCount(1);
    const steps = trail.locator('[data-testid^="custom-shipment-timeline-"][data-kind="status"]');
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0).locator('[data-testid$="-move"]').getByTestId("custom-shipment-status-picked")).toBeVisible();
    const handedOver = steps.nth(1);
    await expect(handedOver.locator('[data-testid$="-move"]').getByTestId("custom-shipment-status-handed_over")).toBeVisible();
    await expect(handedOver.locator('[data-testid$="-fact"]')).toHaveText([new RegExp(rp(COURIER).replace(".", "\\.")), new RegExp(g.resi)]);
    await expect(page.getByTestId("custom-shipment-timeline-awaiting")).toHaveCount(0);
  });

  test("Gudang bayar's money — the handover's cost is the team's debt to the warehouse on Team Balance, and the warehouse's daily statement counts it in its courier column", async ({
    browser,
    page,
  }) => {
    // The selling team owes the warehouse what it paid the courier — posted by liability from the handover's event.
    await as(page, OWNER, g.seller);
    await expect(async () => {
      await page.goto(`/liability/${g.wh}`);
      await expect(page.getByTestId("liability-detail-page")).toBeVisible();
      await expect(page.getByTestId("liability-detail-all")).toBeVisible();
      await expect(page.getByTestId("liability-detail-tab-loading")).toHaveCount(0);
      const entries = page
        .getByTestId("liability-detail-all")
        .locator('[data-testid^="liability-detail-entry-"]')
        .filter({ hasText: new RegExp(`parcel #${g.first}(?!\\d)`) });
      await expect(entries).toHaveCount(1, { timeout: 3_000 });
      await expect(entries).toContainText(`Courier on a custom shipment · parcel #${g.first}`);
      await expect(entries).toContainText(rp(COURIER));
    }).toPass({ timeout: 45_000 });

    // The warehouse's daily statement: today's courier column is that cost (a fresh warehouse — nothing else paid).
    const wh = await keeper(browser);
    const today = jakartaToday();
    await expect(async () => {
      await wh.goto("/statement");
      await expect(wh.getByTestId("statement-table")).toBeVisible({ timeout: 5_000 });
      await expect(wh.getByTestId(`statement-row-${today}`)).toBeVisible();
      expect(await statementCell(wh, today, "Courier COD")).toBe(COURIER);
    }).toPass({ timeout: 45_000 });
    await expect(wh.getByTestId("statement-cod-notice")).toContainText(rp(COURIER));
    await wh.close();
  });

  test("a-custom-shipment-is-cancelled-only-while-requested — a sample cancelled from the list while Diminta puts its units back on the rack they left", async ({
    browser,
    page,
  }) => {
    const wh = await keeper(browser);
    const before = await racks(wh);

    // A second sample of one unit, Gudang bayar, asked by the owner through the contract (the form is proven above).
    await as(page, OWNER, g.seller);
    const first = (await api(page, `${SVC}/CustomShipmentDetail`, { teamId: g.seller, id: g.first })).customShipment;
    const created = (
      await api(page, `${SVC}/CustomShipmentCreate`, {
        teamId: g.seller,
        kind: "CUSTOM_SHIPMENT_KIND_SAMPLE",
        warehouseId: g.wh,
        lines: [{ productId: g.product, quantity: "1" }],
        recipient: { name: `Sari Batal ${SUFFIX}`, phone: "081298765432", address: "Jl. Kenanga 3, Bandung" },
        shipmentChannelId: first.shipmentChannelId,
        payer: "CUSTOM_SHIPMENT_PAYER_WAREHOUSE",
        idempotencyKey: `css-cancel-${SUFFIX}`,
      })
    ).customShipment;
    g.second = String(created.id);

    // The unit left at create, from the rack the system picked.
    const taken = await pickedRacks(wh, g.second);
    expect(Object.values(taken).reduce((a, b) => a + b, 0)).toBe(1);
    const during = await racks(wh);
    for (const rackId of [g.rackX, g.rackY]) expect(during[rackId]).toBe(before[rackId]! - (taken[rackId] ?? 0));

    // Cancelled from the list's ⋯, confirmed.
    await page.goto("/inventories/custom-shipments");
    await expect(page.getByTestId(`custom-shipment-row-${g.second}`).getByTestId("custom-shipment-status-requested")).toBeVisible();
    await page.getByTestId(`custom-shipment-actions-${g.second}`).click();
    await page.getByTestId(`custom-shipment-action-cancel-${g.second}`).click();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId(`custom-shipment-row-${g.second}`).getByTestId("custom-shipment-status-cancelled")).toBeVisible();
    await expect(page.getByTestId(`custom-shipment-actions-${g.second}`)).toHaveCount(0);

    // Its unit is back on the rack it left — every rack as it was before the create.
    expect(await racks(wh)).toEqual(before);
    await wh.close();
  });
});

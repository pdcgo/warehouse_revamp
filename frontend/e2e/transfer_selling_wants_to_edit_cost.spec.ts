import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { asRoot, login, rupiah, signInAs, today } from "./metric_ground";

// selling:all wants to record the shipping cost — the checks behind docs/acceptances/inventory/warehouse_transfer.md,
// section *create*, givens 5–8 (when *edit transfer cost*). One test per role the givens name — selling:owner,
// selling:admin, selling:cs — each signed in as a person of that role in ONE selling team, editing the cost as a person
// does: the transfer's page › Edit Cost › the shipping cost and the account that pays it › Save.
// transfer_selling_wants_to_create.spec.ts is the acceptance of the transfer's first act; transfers.spec.ts its
// end-to-end regression.
//
// Business rules (docs/business/inventory/warehouse_transfer_decision.md):
// - the-shipping-expense-reaches-the-account-by-event — the team types the cost (and its account) at create or later,
//   until `accepted`; every change sends only the DIFFERENCE, and a move to another account puts the whole amount back
//   into the old one and takes it out of the new one. financial_account's listener posts each as an `expense` row
//   naming the transfer — *Warehouse transfer #N shipping edited* / *… moved to another account* / *… moved from
//   another account* — so every money then is POLLED.
// - a-transfers-shipping-is-paid-from-any-active-account — Edit Cost lists every active account of the team.
// - the selling team's actions by status (SellingTransferActions): Edit Cost while created, process, shipped, arrived
//   or lost; accepted and cancelled offer nothing.
//
// GROUND (beforeAll, as root, through the API from the test runner): a selling team S with a person per role and an
// operational account paying the restock; warehouses A and B (a rack each); one product of S's with 30 on A's rack.
// Per role, accounts of its own opened today (so each balance is that role's alone) and five transfers of 1 unit A → B,
// each processed by A (status process):
//   5   no shipping cost. The role types Rp 20.000, paid from its BCA (Rp 1.000.000).
//       then: shipping cost shown on the transfer — the page's Shipping cost Rp 20.000, Paid from that BCA; the role's
//             own WarehouseTransferDetail.
//       then: BCA decreases by shipping cost — the account page: Rp 1.000.000 → Rp 980.000.
//       then: recorded in BCA's history — its row *Warehouse transfer #N shipping edited*, type Expense, −Rp 20.000.
//       then: recorded in finance analytic metric — Analytic › Account changes by account: that BCA's Expense
//             −Rp 20.000.
//   6   Rp 20.000 from its BCA at create (read landed: Rp 980.000). The role changes it to Rp 25.000, same BCA.
//       then: BCA decreases by the difference — Rp 980.000 → Rp 975.000, one *… shipping edited* row of −Rp 5.000.
//   7   Rp 20.000 from its BCA at create (read landed). The role keeps the cost and changes the account to its
//       ShopeePay (Rp 500.000).
//       then: shipping cost back into BCA — BCA Rp 980.000 → Rp 1.000.000, one *… moved to another account* row of
//             +Rp 20.000.
//       then: shipping cost out of ShopeePay — ShopeePay Rp 500.000 → Rp 480.000, one *… moved from another account*
//             row of −Rp 20.000; the page's Paid from names the ShopeePay.
//   8   no shipping cost, then shipped, arrived and accepted by B onto its rack (status accepted). Beside it a sixth
//       transfer, still process, is the positive control: its page and its list row DO offer Edit Cost.
//       then: edit cost not offered — the accepted transfer's page shows no Edit Cost (no action at all), its row on
//             Transfers has no actions menu, and the same edit sent anyway under the role's token is refused, the cost
//             unchanged.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-transfer-edit-cost-1";

const GIVEN = "selling:all wants to record the shipping cost";
const WHEN = "edit transfer cost";
const C5 = "status: process · no shipping cost yet · shipping cost typed · paid from BCA";
const C6 = "status: process · shipping cost changed from Rp 20.000 to Rp 25.000 · same account BCA";
const C7 = "status: process · shipping cost paid from BCA · account changed to ShopeePay";
const C8 = "status: accepted";

const SELLING = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "o" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "a" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "c" },
] as const;
type Role = (typeof SELLING)[number];

const SHIPPING = 20_000;
const CHANGED = 25_000;
const BCA_OPENING = 1_000_000;
const SPAY_OPENING = 500_000;
const STOCK = { count: 30, total: 300_000 };

const WH = {
  a: { name: `E2E Transfer Cost A ${SUFFIX}`, code: `XEWA${SUFFIX}` },
  b: { name: `E2E Transfer Cost B ${SUFFIX}`, code: `XEWB${SUFFIX}` },
};
const RACK_A = `xe-a-${SUFFIX}`;
const RACK_B = `xe-b-${SUFFIX}`;
const username = (r: Role) => `xte${r.key}${SUFFIX}`;
const accountName = (g: string, r: Role) => `E2E ${g} transfer cost ${r.key} ${SUFFIX}`;

interface Product {
  id: string;
  code: string;
  name: string;
}

interface RoleGround {
  bca5: string;
  bca6: string;
  bca7: string;
  spay7: string;
  t5: string;
  t6: string;
  t7: string;
  t8: string;
  control: string;
}

const ground = {
  seller: "",
  whA: "",
  whB: "",
  rackA: "",
  rackB: "",
  restockAccount: "",
  category: "",
  product: { id: "", code: "", name: "" } as Product,
  r: {} as Record<string, RoleGround>,
};

// A call that may be refused — its status and JSON, never a throw.
async function send(token: string, method: string, body: unknown) {
  const res = await fetch(`${API_URL}/warehouse.${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function team(name: string, code: string, type: string): Promise<string> {
  return String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: ROOT_USER_ID })).team.id);
}

async function account(name: string, number: string, opening: number, wallet = false): Promise<string> {
  return String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: wallet ? "FINANCIAL_ACCOUNT_TYPE_WALLET" : "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: wallet ? "FINANCIAL_ACCOUNT_PROVIDER_SHOPEEPAY" : "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name,
        holderName: "E2E",
        accountNumber: number,
        openingBalance: opening,
        openingOn: today(),
      })
    ).account.id,
  );
}

const T = "inventory.v1.WarehouseTransferService/";

// One transfer of 1 unit A → B opened by the team, then confirmed by A (status process). Its id and its one item's id.
async function processed(cost = 0, accountId = ""): Promise<{ id: string; item: string }> {
  const made = await asRoot(`${T}WarehouseTransferCreate`, {
    teamId: ground.seller,
    fromWarehouseId: ground.whA,
    toWarehouseId: ground.whB,
    lines: [{ productId: ground.product.id, count: "1" }],
    ...(cost > 0 ? { shipmentCost: cost, financeAccountId: accountId } : {}),
  });
  const id = String(made.transfer.id);
  await asRoot(`${T}WarehouseTransferProcess`, { teamId: ground.whA, transferId: id });

  return { id, item: String(made.transfer.items[0].id) };
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(240_000);

  ground.seller = await team(`E2E Transfer Cost Seller ${SUFFIX}`, `XESL${SUFFIX}`, "TEAM_TYPE_SELLING");
  for (const r of SELLING) {
    await asRoot("user.v1.UserService/CreateUser", {
      teamId: ground.seller,
      username: username(r),
      password: PASSWORD,
      name: `Transfer Cost ${r.key} ${SUFFIX}`,
      role: r.role,
    });
  }
  ground.whA = await team(WH.a.name, WH.a.code, "TEAM_TYPE_WAREHOUSE");
  ground.whB = await team(WH.b.name, WH.b.code, "TEAM_TYPE_WAREHOUSE");
  ground.rackA = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: ground.whA, code: RACK_A, name: RACK_A })).rack.id);
  ground.rackB = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: ground.whB, code: RACK_B, name: RACK_B })).rack.id);
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Transfer Cost ${SUFFIX}` })).category.id);

  // The account that pays the restock — operational (a restock is paid only from one), never one a then reads.
  ground.restockAccount = await account(`E2E transfer cost restock ${SUFFIX}`, `E2E-XTE-R-${SUFFIX}`, 10_000_000);
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: ground.restockAccount,
    operational: true,
  });

  // The one product, 30 on A's rack — every transfer here takes 1.
  const name = `Kaos Ongkir ${SUFFIX}`;
  const made = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `E${SUFFIX}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  ground.product = { id: String(made.id), code: made.productCode, name };
  const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.seller,
    warehouseId: ground.whA,
    financeAccountId: ground.restockAccount,
    items: [{ productId: ground.product.id, productCode: ground.product.code, name, count: STOCK.count, total: STOCK.total }],
  });
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.whA,
    requestId: restock.request.id,
    lines: (restock.request.items as { id: string; count: string }[]).map((i) => ({
      itemId: i.id,
      receivedCount: i.count,
      placements: [{ placementId: ground.rackA, quantity: i.count }],
    })),
  });

  for (const r of SELLING) {
    // Any ACTIVE account pays a transfer's shipping (a-transfers-shipping-is-paid-from-any-active-account).
    const bca5 = await account(accountName("BCA5", r), `E2E-XTE-5${r.key}-${SUFFIX}`, BCA_OPENING);
    const bca6 = await account(accountName("BCA6", r), `E2E-XTE-6${r.key}-${SUFFIX}`, BCA_OPENING);
    const bca7 = await account(accountName("BCA7", r), `E2E-XTE-7${r.key}-${SUFFIX}`, BCA_OPENING);
    const spay7 = await account(accountName("ShopeePay7", r), `E2E-XTE-7${r.key}W-${SUFFIX}`, SPAY_OPENING, true);

    const t5 = await processed();
    const t6 = await processed(SHIPPING, bca6);
    const t7 = await processed(SHIPPING, bca7);
    const t8 = await processed();
    const control = await processed();

    // Given 8: shipped by A, the box set arrived and counted in whole by B onto its rack.
    await asRoot(`${T}WarehouseTransferShip`, { teamId: ground.whA, transferId: t8.id });
    await asRoot(`${T}WarehouseTransferArrive`, { teamId: ground.whB, transferId: t8.id });
    await asRoot(`${T}WarehouseTransferAccept`, {
      teamId: ground.whB,
      transferId: t8.id,
      lines: [{ itemId: t8.item, arrivedCount: "1", placements: [{ placementId: ground.rackB, quantity: "1" }] }],
    });

    ground.r[r.key] = { bca5, bca6, bca7, spay7, t5: t5.id, t6: t6.id, t7: t7.id, t8: t8.id, control: control.id };
  }
});

// ── the screens ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function openTransfer(page: Page, transfer: string, status: string) {
  await page.goto(`/inventories/transfer/${transfer}`);
  await expect(page.getByTestId("transfer-detail-page")).toBeVisible();
  await expect(page.getByTestId("transfer-detail-title")).toContainText(`#${transfer}`);
  await expect(page.getByTestId("transfer-detail-status")).toHaveText(status);
}

// Edit Cost on the transfer's page — the cost typed (when given), the paying account picked (when given), Save. It
// must save.
async function editCost(page: Page, transfer: string, change: { cost?: number; account?: string }) {
  await page.getByTestId(`transfer-action-edit-cost-${transfer}`).click();
  const dialog = page.getByRole("alertdialog", { name: `Shipping Cost for Transfer #${transfer}` });
  await expect(dialog).toBeVisible();
  if (change.cost !== undefined) await dialog.getByTestId("transfer-cost-amount").fill(String(change.cost));
  if (change.account !== undefined) {
    await dialog.getByTestId("transfer-cost-account").click();
    await page.getByTestId(`transfer-cost-account-option-${change.account}`).click();
    await expect(dialog.getByTestId("transfer-cost-account")).toContainText("transfer cost");
  }
  const save = dialog.getByTestId("confirm-action");
  await expect(save).toBeEnabled();
  const answer = page.waitForResponse((res) => res.url().includes(`${T}WarehouseTransferUpdate`));
  await save.click();
  const res = await answer;
  expect(res.ok(), `WarehouseTransferUpdate: ${res.status()}`).toBe(true);
  await expect(dialog).toBeHidden();
}

// An account's balance on its page, re-read until the listener's rows land.
async function balance(page: Page, accountId: string, want: number) {
  await expect(async () => {
    await page.goto(`/financial-accounts/${accountId}`);
    await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(want), { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

// The account page's row naming the transfer's shipping with exactly these words (the page must be open on the
// account) — exact, since the descriptions are prefixes of each other (*… shipping*, *… shipping edited*).
async function shippingRow(page: Page, transfer: string, words: string, change: RegExp) {
  const description = page.getByText(`Warehouse transfer #${transfer} shipping${words}`, { exact: true });
  const row = page.locator('[data-testid^="account-log-row-"]').filter({ has: description });
  await expect(row).toHaveCount(1);
  const cells = row.locator("td");
  await expect(cells.nth(1)).toHaveText("Expense");
  await expect(cells.nth(3)).toHaveText(change);
}

const minus = (n: number) => new RegExp(`^[−-]\\s?${rupiah(n).replace(/\./g, "\\.").replace(" ", "\\s?")}$`);
const plus = (n: number) => new RegExp(`^\\+\\s?${rupiah(n).replace(/\./g, "\\.").replace(" ", "\\s?")}$`);

// An Analytic cell, re-read until it lands (the listener answers after the write).
async function lands(page: Page, url: string, testId: string, want: string) {
  await expect(async () => {
    await page.goto(url);
    await expect(page.getByTestId(testId)).toHaveText(want, { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

async function detail(r: Role, transfer: string) {
  const res = await send(await login(username(r), PASSWORD), `${T}WarehouseTransferDetail`, { teamId: ground.seller, transferId: transfer });
  expect(res.status, JSON.stringify(res.json)).toBe(200);

  return res.json.transfer as Record<string, any>;
}

// ── 5 · no shipping cost yet, typed and paid from BCA ───────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${C5})`, () => {
  for (const r of SELLING) {
    test(`${r.given} ${WHEN} (${C5})`, async ({ page }) => {
      const g = ground.r[r.key]!;
      await signInAs(page, username(r), PASSWORD, ground.seller);

      // The given: the BCA at its opening; the transfer in process with no cost and no account.
      await balance(page, g.bca5, BCA_OPENING);
      await openTransfer(page, g.t5, "Process");
      await expect(page.getByTestId("transfer-detail-shipping-cost")).toContainText("Not yet entered");
      await expect(page.getByTestId("transfer-detail-account")).toHaveCount(0);

      // THE WHEN — Rp 20.000, paid from the BCA.
      await editCost(page, g.t5, { cost: SHIPPING, account: g.bca5 });

      await test.step("then: shipping cost shown on the transfer", async () => {
        await expect(page.getByTestId("transfer-detail-shipping-cost")).toContainText(rupiah(SHIPPING));
        await expect(page.getByTestId("transfer-detail-account")).toContainText(accountName("BCA5", r));
        await expect(page.getByTestId("transfer-detail-status")).toHaveText("Process");
        const t = await detail(r, g.t5);
        expect(Number(t.shipmentCost)).toBe(SHIPPING);
        expect(String(t.financeAccountId)).toBe(g.bca5);
      });

      await test.step("then: BCA decreases by shipping cost", async () => {
        await balance(page, g.bca5, BCA_OPENING - SHIPPING);
      });

      await test.step("then: recorded in BCA's history", async () => {
        // The cost was 0 until this edit, so the difference is the whole cost (an-edit-sends-the-difference).
        await shippingRow(page, g.t5, " edited", minus(SHIPPING));
      });

      await test.step("then: recorded in finance analytic metric", async () => {
        await lands(page, "/analytic?g=account&m=metrics/financial_accounts&r=7d", `analytic-cell-${g.bca5}-expense`, `−${rupiah(SHIPPING)}`);
      });
    });
  }
});

// ── 6 · Rp 20.000 changed to Rp 25.000, same BCA ────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${C6})`, () => {
  for (const r of SELLING) {
    test(`${r.given} ${WHEN} (${C6})`, async ({ page }) => {
      const g = ground.r[r.key]!;
      await signInAs(page, username(r), PASSWORD, ground.seller);

      // The given: the Rp 20.000 of the create has left the BCA; the transfer in process says so.
      await balance(page, g.bca6, BCA_OPENING - SHIPPING);
      await openTransfer(page, g.t6, "Process");
      await expect(page.getByTestId("transfer-detail-shipping-cost")).toContainText(rupiah(SHIPPING));
      await expect(page.getByTestId("transfer-detail-account")).toContainText(accountName("BCA6", r));

      // THE WHEN — the cost corrected to Rp 25.000, the account left as it is.
      await editCost(page, g.t6, { cost: CHANGED });
      await expect(page.getByTestId("transfer-detail-shipping-cost")).toContainText(rupiah(CHANGED));
      await expect(page.getByTestId("transfer-detail-account")).toContainText(accountName("BCA6", r));

      await test.step("then: BCA decreases by the difference", async () => {
        // Only the Rp 5.000 more leaves — never the whole Rp 25.000 again.
        await balance(page, g.bca6, BCA_OPENING - CHANGED);
        await shippingRow(page, g.t6, " edited", minus(CHANGED - SHIPPING));
        await shippingRow(page, g.t6, "", minus(SHIPPING)); // the create's own row, exactly once — "shipping" alone
      });
    });
  }
});

// ── 7 · paid from BCA, moved to ShopeePay ───────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${C7})`, () => {
  for (const r of SELLING) {
    test(`${r.given} ${WHEN} (${C7})`, async ({ page }) => {
      const g = ground.r[r.key]!;
      await signInAs(page, username(r), PASSWORD, ground.seller);

      // The given: Rp 20.000 paid from the BCA; the ShopeePay untouched.
      await balance(page, g.bca7, BCA_OPENING - SHIPPING);
      await balance(page, g.spay7, SPAY_OPENING);
      await openTransfer(page, g.t7, "Process");
      await expect(page.getByTestId("transfer-detail-account")).toContainText(accountName("BCA7", r));

      // THE WHEN — the same cost, now paid from the ShopeePay.
      await editCost(page, g.t7, { account: g.spay7 });
      await expect(page.getByTestId("transfer-detail-account")).toContainText(accountName("ShopeePay7", r));
      await expect(page.getByTestId("transfer-detail-shipping-cost")).toContainText(rupiah(SHIPPING));

      await test.step("then: shipping cost back into BCA", async () => {
        await balance(page, g.bca7, BCA_OPENING);
        await shippingRow(page, g.t7, " moved to another account", plus(SHIPPING));
      });

      await test.step("then: shipping cost out of ShopeePay", async () => {
        await balance(page, g.spay7, SPAY_OPENING - SHIPPING);
        await shippingRow(page, g.t7, " moved from another account", minus(SHIPPING));
        const t = await detail(r, g.t7);
        expect(Number(t.shipmentCost)).toBe(SHIPPING);
        expect(String(t.financeAccountId)).toBe(g.spay7);
      });
    });
  }
});

// ── 8 · accepted ────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe(`${GIVEN} (${C8})`, () => {
  for (const r of SELLING) {
    test(`${r.given} ${WHEN} (${C8})`, async ({ page }) => {
      const g = ground.r[r.key]!;
      await signInAs(page, username(r), PASSWORD, ground.seller);

      // Positive control: a transfer still in process offers Edit Cost to this role.
      await openTransfer(page, g.control, "Process");
      await expect(page.getByTestId(`transfer-action-edit-cost-${g.control}`)).toBeVisible();

      // THE WHEN — the role opens the accepted transfer to edit its cost.
      await openTransfer(page, g.t8, "Accepted");

      await test.step("then: edit cost not offered", async () => {
        await expect(page.getByTestId(`transfer-action-edit-cost-${g.t8}`)).toHaveCount(0);
        await expect(page.locator('[data-testid^="transfer-action-"]')).toHaveCount(0);

        // The list: the accepted row carries no actions menu, the process row does.
        await page.goto("/inventories/transfer");
        await expect(page.getByTestId(`transfer-row-${g.t8}`)).toBeVisible();
        await expect(page.getByTestId(`transfer-actions-${g.control}`)).toBeVisible();
        await expect(page.getByTestId(`transfer-actions-${g.t8}`)).toHaveCount(0);

        // The same edit sent anyway, as the role: refused, and the transfer keeps no cost.
        const res = await send(await login(username(r), PASSWORD), `${T}WarehouseTransferUpdate`, {
          teamId: ground.seller,
          transferId: g.t8,
          shipmentCost: 5_000,
          financeAccountId: ground.restockAccount,
          note: "",
        });
        expect(res.status, JSON.stringify(res.json)).not.toBe(200);
        const t = await detail(r, g.t8);
        expect(t.status).toBe("WAREHOUSE_TRANSFER_STATUS_ACCEPTED");
        expect(Number(t.shipmentCost ?? 0)).toBe(0);
      });
    });
  }
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// KOREKSI JUMLAH TERIMA, END TO END (docs/business/inventory/adjustment_decision.md —
// the-warehouse-corrects-a-wrong-stock-in-alone, a-stock-in-correction-keeps-the-batch-price,
// a-wrong-stock-in-is-a-received-count-correction, the-received-count-prototype-is-accepted,
// a-received-count-correction-counts-on-its-own-day) — against the real server and Postgres:
//
//   · a SELLING TEAM owned by Dewi restocks 12 Kaos Terima at Rp 10.000 into warehouse A (Wati's); A accepts all 12;
//   · Dewi's Analytic Restock today reads 12 accepted, 0 missing;
//   · Sari, A's Staff, has no Correct Received Count on the restock;
//   · WATI, A's Owner, corrects 12 → 10 with a reason: the restock page reads *corrected from 12* and Kurang
//     *2 (correction)*, the history *Received count corrected · 12 → 10* with the reason and who;
//   · DEWI reads the same restock with the money: *Missing (correction) +2*, *worth Rp 20.000 · borne by the selling
//     team*, in the line's detail and the history row;
//   · the BATCH holds 2 fewer (10 ready, 2 lost) and its history says the correction;
//   · Dewi's Analytic Restock today reads 10 accepted, 2 missing — the −2 / +2 landed on the correction's day;
//   · a TRANSFER of 4 from A to B, B typed 3 — Wati (B's Owner too) corrects 3 → 4: the unit goes into B's batch, on
//     the rack she picked;
//   · a STALE FORM is refused: a correction lands while Wati's form is open, and hers shows the server's words.
//
// Its own teams (the shape of the_owner_corrects_a_batch_price.spec.ts), no order placed, root's own team never touched;
// it sorts after orders.spec.ts and statement.spec.ts.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-terima-pass-1";
// A username is lowercase letters and digits only.
const DEWI = `e2eterimadewi${SUFFIX}`;
const WATI = `e2eterimawati${SUFFIX}`;
const WATI_NAME = `Wati Terima ${SUFFIX}`;
const SARI = `e2eterimasari${SUFFIX}`;
const PRODUCT = "Kaos Terima";
const REASON = "Dihitung ulang di rak — isi kotak 10, terketik 12";

const RESTOCK = "metrics/inventory/restock";

const state = {
  seller: "",
  whA: "",
  whB: "",
  rackA: "",
  rackB1: "",
  rackB2: "",
  codeB2: `trm-b2-${SUFFIX}`,
  product: "",
  restock: "",
  item: "",
  batch: "",
  transfer: "",
  transferItem: "",
};

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
}

// An RPC as the signed-in person — the status and the JSON body.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body] as const,
  );
}

// A seed call that must succeed — its JSON body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

/** Save Correction, then the confirm — it is never rolled back, so it asks. */
async function saveAndConfirm(page: Page) {
  await page.getByTestId("rc-save").click();
  await page.getByRole("alertdialog").getByTestId("confirm-action").click();
}

test.describe.configure({ mode: "serial" });

test("Setup: Dewi restocks 12 Kaos Terima into Wati's warehouse A, accepted whole; Sari is A's Staff", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // TeamCreate names an EXISTING person as the Owner, so Dewi and Wati are made first in a scratch team of root's.
  const scratch = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Terima Scratch ${SUFFIX}`,
      teamCode: `TX${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  const [dewi, wati] = await Promise.all(
    [
      [DEWI, `Dewi Terima ${SUFFIX}`],
      [WATI, WATI_NAME],
    ].map(
      async ([username, name]) =>
        (
          await ok(page, "user.v1.UserService/CreateUser", {
            teamId: scratch,
            username,
            password: PASSWORD,
            name,
            role: "ROLE_SELLING_ADMIN",
          })
        ).user.id as string,
    ),
  );
  const team = async (name: string, code: string, type: string, owner: string) =>
    (await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: owner })).team.id as string;
  state.whA = await team(`E2E Terima Gudang A ${SUFFIX}`, `TA${SUFFIX}`, "TEAM_TYPE_WAREHOUSE", wati);
  state.whB = await team(`E2E Terima Gudang B ${SUFFIX}`, `TB${SUFFIX}`, "TEAM_TYPE_WAREHOUSE", wati);
  state.seller = await team(`E2E Terima Seller ${SUFFIX}`, `TS${SUFFIX}`, "TEAM_TYPE_SELLING", dewi);
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.whA,
    username: SARI,
    password: PASSWORD,
    name: `Sari Terima ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  state.rackA = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.whA, code: `trm-a-${SUFFIX}` })).rack.id;
  state.rackB1 = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.whB, code: `trm-b1-${SUFFIX}` })).rack.id;
  state.rackB2 = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.whB, code: state.codeB2 })).rack.id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Terima ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `TR${SUFFIX}`,
      name: PRODUCT,
      categoryId: category,
    })
  ).product;
  state.product = product.id;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E terima restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-TRM-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account,
    operational: true,
  });

  // 12 ordered at Rp 120.000 — Rp 10.000 a unit, no freight; A's door typed all 12 good, onto its rack.
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: state.seller,
    warehouseId: state.whA,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count: 12, total: 120000 }],
  });
  state.restock = restock.request.id;
  state.item = restock.request.items[0].id;
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.whA,
    requestId: state.restock,
    lines: [{ itemId: state.item, receivedCount: 12, placements: [{ placementId: state.rackA, quantity: 12 }] }],
  });

  const batches = await ok<{ ids: string[] }>(page, "inventory.v1.InventoryService/BatchList", {
    teamId: state.whA,
    filter: { productId: product.id },
    dataRequest: ["BATCH_LIST_DATA_TYPE_BATCH"],
    page: { page: 1, limit: 10 },
  });
  expect(batches.ids).toHaveLength(1);
  state.batch = batches.ids[0]!;
});

test("Dewi's Analytic Restock today, before: 12 accepted, nothing missing", async ({ page }) => {
  await login(page, DEWI, PASSWORD);
  await useTeam(page, state.seller);

  await page.goto(`/analytic?g=product&m=${RESTOCK}&r=7d`);
  await expect(page.getByTestId("analytic-table")).toBeVisible();
  await expect(page.getByTestId(`analytic-cell-${state.product}-accepted_count`)).toHaveText("12");
  await expect(page.getByTestId(`analytic-cell-${state.product}-missing_count`)).toHaveText("0");
});

test("Sari, A's Staff, has no Correct Received Count — Print stays", async ({ page }) => {
  await login(page, SARI, PASSWORD);
  await useTeam(page, state.whA);
  await page.goto(`/inventories/restock/${state.restock}`);

  await expect(page.getByTestId(`restock-action-labels-${state.restock}`)).toBeVisible();
  await expect(page.getByTestId(`restock-action-correct-count-${state.restock}`)).toHaveCount(0);
});

test("Wati corrects 12 → 10 with a reason: corrected from 12, Kurang 2 (correction), the history row", async ({ page }) => {
  await login(page, WATI, PASSWORD);
  await useTeam(page, state.whA);
  await page.goto(`/inventories/restock/${state.restock}`);

  await page.getByTestId(`restock-action-correct-count-${state.restock}`).click();
  const form = page.getByTestId("rc-dialog");
  await expect(form).toBeVisible();
  await expect(form.getByTestId(`rc-line-${state.item}-facts`)).toHaveText("Ordered 12 · Received 12");
  await expect(form.getByTestId(`rc-line-${state.item}-batch`)).toHaveText(`Batch #${state.batch} · 12 still in this warehouse`);
  // Units only — the batch's price is the selling team's (a-warehouse-sees-no-seller-money).
  await expect(form).not.toContainText("Rp");

  await form.getByTestId(`rc-line-${state.item}-real`).fill("10");
  await expect(form.getByTestId(`rc-line-${state.item}-effect`)).toHaveText(`2 Missing (correction) — out of batch #${state.batch}`);
  // The rack the units come off — the one holding the product.
  await expect(form.getByTestId(`rc-line-${state.item}-from`)).toContainText(`trm-a-${SUFFIX}`);
  await form.getByTestId("rc-reason").fill(REASON);
  await saveAndConfirm(page);
  await expect(form).toBeHidden();

  await expect(page.getByTestId(`restock-detail-received-${state.product}`)).toContainText("10");
  await expect(page.getByTestId(`restock-detail-received-${state.product}-was`)).toHaveText("corrected from 12");
  await expect(page.getByTestId(`restock-detail-missing-${state.product}-count`)).toHaveText("2 (correction)");
  // Their worth is the selling team's — the warehouse's cell carries no Rp (a-warehouse-sees-no-seller-money).
  await expect(page.getByTestId(`restock-detail-missing-${state.product}-value`)).toHaveCount(0);

  const row = page.locator('[data-kind="correction"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Received count corrected · 12 → 10");
  await expect(row).toContainText(`${PRODUCT} · 2 Missing (correction)`);
  await expect(row).toContainText(REASON);
  await expect(row).toContainText(WATI_NAME);
  await expect(row).not.toContainText("Rp");
  await expect(row.getByTestId("root-team-badge")).toHaveCount(0);
});

test("Dewi reads the correction with the money she bears: Rp 20.000, in the line's detail and the history", async ({
  page,
}) => {
  await login(page, DEWI, PASSWORD);
  await useTeam(page, state.seller);
  await page.goto(`/inventories/restock/${state.restock}`);

  await expect(page.getByTestId(`restock-detail-correction-badge-${state.product}`)).toHaveText("Missing (correction) +2");
  await page.getByTestId(`restock-detail-adjustment-${state.product}`).click();
  const detail = page.getByTestId(`restock-detail-adjustment-${state.product}-dialog`);
  await expect(detail.getByTestId(`restock-detail-received-${state.product}`)).toContainText("10 (corrected from 12)");
  await expect(detail.getByTestId(`restock-detail-correction-${state.product}-value`)).toHaveText(
    "worth Rp 20.000 · borne by the selling team",
  );
  await expect(detail.getByTestId(`restock-detail-correction-${state.product}-why`)).toContainText(WATI_NAME);
  await page.keyboard.press("Escape");

  const row = page.locator('[data-kind="correction"]');
  await expect(row).toContainText("Received count corrected · 12 → 10");
  await expect(row).toContainText("worth Rp 20.000 · borne by the selling team");
  await expect(row).toContainText(REASON);
});

test("The batch holds 2 fewer — 10 ready, 2 lost — and its history says the correction", async ({ page }) => {
  await login(page, WATI, PASSWORD);
  await useTeam(page, state.whA);
  await page.goto(`/inventories/batches/${state.batch}`);

  await expect(page.getByTestId("batch-detail-page")).toBeVisible();
  await expect(page.getByTestId("batch-detail-arrived")).toHaveText("12");
  await expect(page.getByTestId("batch-detail-ready")).toHaveText("10");
  await expect(page.getByTestId("batch-detail-lost")).toHaveText("2");

  const history = page.getByTestId("batch-history-panel");
  await expect(history).toContainText("Received count corrected · 12 → 10");
  await expect(history.locator('[data-testid^="batch-detail-history-row-"][data-testid$="-count"]')).toHaveText("12 → 10");
  await expect(history.locator('[data-testid^="batch-detail-history-row-"][data-testid$="-reason"]')).toContainText(REASON);
});

test("Dewi's Analytic Restock today, after: 10 accepted, 2 missing — the correction's own day", async ({ page }) => {
  await login(page, DEWI, PASSWORD);
  await useTeam(page, state.seller);

  await page.goto(`/analytic?g=product&m=${RESTOCK}&r=7d`);
  await expect(page.getByTestId("analytic-table")).toBeVisible();
  await expect(page.getByTestId(`analytic-cell-${state.product}-accepted_count`)).toHaveText("10");
  await expect(page.getByTestId(`analytic-cell-${state.product}-missing_count`)).toHaveText("2");
  await expect(page.getByTestId(`analytic-cell-${state.product}-accepted_value`)).toHaveText("Rp 100.000");

  // By day: today alone carries both — the accept's 12 and the correction's −2.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  await page.goto(`/analytic?g=daily&m=${RESTOCK}&r=7d`);
  await expect(page.getByTestId(`analytic-cell-${today}-accepted_count`)).toHaveText("10");
  await expect(page.getByTestId(`analytic-cell-${today}-missing_count`)).toHaveText("2");
});

test("A transfer typed one short at B: Wati corrects 3 → 4 — the unit goes into B's batch, on the rack she picked", async ({
  page,
}) => {
  // The transfer: 4 from A to B — opened by the seller, processed and shipped by A, B typed 3 (1 missing) onto B1.
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  const created = await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferCreate", {
    teamId: state.seller,
    fromWarehouseId: state.whA,
    toWarehouseId: state.whB,
    lines: [{ productId: state.product, count: "4" }],
  });
  state.transfer = created.transfer.id;
  state.transferItem = created.transfer.items[0].id;
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferProcess", { teamId: state.whA, transferId: state.transfer });
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferShip", {
    teamId: state.whA,
    transferId: state.transfer,
    receipt: `JTR${SUFFIX}`,
  });
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferAccept", {
    teamId: state.whB,
    transferId: state.transfer,
    lines: [{ itemId: state.transferItem, arrivedCount: "3", placements: [{ placementId: state.rackB1, quantity: "3" }] }],
  });

  await login(page, WATI, PASSWORD);
  await useTeam(page, state.whB);
  await page.goto(`/inventories/transfer/${state.transfer}`);

  await page.getByTestId(`transfer-action-correct-count-${state.transfer}`).click();
  const form = page.getByTestId("rc-dialog");
  await expect(form.getByTestId(`rc-line-${state.transferItem}-facts`)).toHaveText("Sent 4 · Received 3");
  // Never above what was sent.
  await form.getByTestId(`rc-line-${state.transferItem}-real`).fill("5");
  await expect(form.getByTestId(`rc-line-${state.transferItem}-error`)).toHaveText("More than sent (4)");
  await form.getByTestId(`rc-line-${state.transferItem}-real`).fill("4");
  await expect(form.getByTestId(`rc-line-${state.transferItem}-effect`)).toContainText("1 into");
  await form.getByTestId(`rc-line-${state.transferItem}-to`).click();
  await page.getByTestId(`rack-select-option-${state.rackB2}`).click();
  await form.getByTestId("rc-reason").fill("Satu kaos terselip di dasar kardus");
  await saveAndConfirm(page);
  await expect(form).toBeHidden();

  await expect(page.getByTestId(`transfer-line-${state.transferItem}-arrived`)).toContainText("4");
  await expect(page.getByTestId(`transfer-line-${state.transferItem}-arrived-was`)).toHaveText("corrected from 3");
  await expect(page.getByTestId(`transfer-line-${state.transferItem}-missing`)).toHaveText("1 − 1 (correction)");
  await expect(page.locator('[data-kind="correction"]')).toContainText("Received count corrected · 3 → 4");

  // The unit is in B's batch of the line — its history says the correction, +1 — and on B2, the rack she picked.
  const detail = await ok<{ transfer: { items: { correctionFacts?: { batchId: string } }[] } }>(
    page,
    "inventory.v1.WarehouseTransferService/WarehouseTransferDetail",
    { teamId: state.whB, transferId: state.transfer },
  );
  const batchB = detail.transfer.items[0]!.correctionFacts!.batchId;
  await page.goto(`/inventories/batches/${batchB}`);
  await expect(page.getByTestId("batch-detail-ready")).toHaveText("4");
  const history = page.getByTestId("batch-history-panel");
  await expect(history).toContainText("Received count corrected · 3 → 4");
  await expect(history).toContainText("+1");

  await page.goto(`/inventories/racks/${state.rackB2}`);
  await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${state.product}`)).toHaveText("1");
});

test("A stale form is refused: a correction lands while Wati's form is open, and hers shows the server's words", async ({
  page,
}) => {
  await login(page, WATI, PASSWORD);
  await useTeam(page, state.whA);
  await page.goto(`/inventories/restock/${state.restock}`);

  await page.getByTestId(`restock-action-correct-count-${state.restock}`).click();
  const form = page.getByTestId("rc-dialog");
  await expect(form.getByTestId(`rc-line-${state.item}-facts`)).toHaveText("Ordered 12 · Received 10");
  await form.getByTestId(`rc-line-${state.item}-real`).fill("9");
  await form.getByTestId("rc-reason").fill("Dihitung ulang sekali lagi");

  // Meanwhile one unit is found and put back — from the count the form also showed.
  await ok(page, "inventory.v1.RestockRequestService/RestockReceivedCountCorrect", {
    teamId: state.whA,
    requestId: state.restock,
    reason: "Ditemukan satu di bawah rak",
    lines: [{ itemId: state.item, expectedReceivedCount: "10", receivedCount: "11", placementId: state.rackA }],
  });

  await saveAndConfirm(page);
  await expect(form.getByTestId("rc-error")).toContainText("someone corrected it first");
  // The form keeps what was typed; nothing was overwritten.
  await expect(form).toBeVisible();
  await expect(form.getByTestId(`rc-line-${state.item}-real`)).toHaveValue("9");

  await page.getByTestId("rc-cancel").click();
  await expect(page.getByTestId(`restock-detail-received-${state.product}`)).toContainText("11");
  await expect(page.locator('[data-kind="correction"]')).toHaveCount(2);
});

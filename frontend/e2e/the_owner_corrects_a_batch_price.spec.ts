import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// KOREKSI HARGA, END TO END (docs/business/inventory/context_decision.md — the-owning-team-revalues-with-a-reason,
// the-correct-price-prototype-is-accepted, a-corrected-price-is-above-zero) — against the real server and Postgres.
//
//   · a SELLING TEAM owned by Dewi holds 10 Kaos Koreksi at Rp 10.000 in a warehouse of its own (a restock, accepted);
//   · Dewi opens her product's page, corrects the batch to Rp 12.500 with a reason, confirms — the Batch row reads the new
//     price and value, and Stock history the *Price corrected* row: from → to, the value change, the reason, who;
//   · a STALE FORM: Dewi opens the form again, a correction lands meanwhile, her save is refused in the form, naming the
//     price now — nothing is overwritten;
//   · the WAREHOUSE (Wati, its Owner) reads the corrections in the batch's Riwayat, sees *corrected from Rp …* under the
//     unit price, and has no Correct Price button;
//   · ROOT, holding no role in either team, has the button on the warehouse's batch page; its correction is the owning
//     team's, stamped *by Root team* (an-override-is-stamped-in-every-service).
//
// Its own teams, no order placed, root's own team never touched; it sorts after orders.spec.ts and statement.spec.ts.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-koreksi-pass-1";
// A username is lowercase letters and digits only.
const DEWI = `e2ekoreksidewi${SUFFIX}`;
const DEWI_NAME = `Dewi Koreksi ${SUFFIX}`;
const WATI = `e2ekoreksiwati${SUFFIX}`;
const REASON = "Di nota Rp 12.500 — salah ketik saat diterima";

const state = { seller: "", warehouse: "", product: "", batch: "" };

async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);
}

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

/** Opens Correct Price on the batch's row of the product page's Batch section; the form. */
async function openForm(page: Page) {
  await page.getByTestId(`pd-batch-correct-${state.batch}`).click();
  const form = page.getByTestId("correct-price-dialog");
  await expect(form).toBeVisible();

  return form;
}

test.describe.configure({ mode: "serial" });

test("Setup: Dewi's selling team holds 10 Kaos Koreksi at Rp 10.000 in Wati's warehouse; root is in neither", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // TeamCreate names an EXISTING person as the Owner, so Dewi and Wati are made first in a scratch team of root's — the
  // seller is then Dewi's, the warehouse Wati's, and root holds no role in either.
  const scratch = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Koreksi Scratch ${SUFFIX}`,
      teamCode: `KX${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  const [dewi, wati] = await Promise.all(
    [
      [DEWI, DEWI_NAME],
      [WATI, `Wati Koreksi ${SUFFIX}`],
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
  state.warehouse = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Koreksi WH ${SUFFIX}`,
      teamCode: `KW${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: wati,
    })
  ).team.id;
  state.seller = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Koreksi Seller ${SUFFIX}`,
      teamCode: `KS${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: dewi,
    })
  ).team.id;

  // The goods: a product of Dewi's, a restock of 10 for Rp 100.000 paid from an operational account of her team,
  // accepted onto the warehouse's rack — one batch at Rp 10.000.
  const rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: `kor-${SUFFIX}` })).rack.id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Koreksi ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `KO${SUFFIX}`,
      name: "Kaos Koreksi",
      categoryId: category,
    })
  ).product;
  state.product = product.id;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E koreksi restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-KOR-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account,
    operational: true,
  });
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: state.seller,
    warehouseId: state.warehouse,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Koreksi", count: 10, total: 100000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 10, placements: [{ placementId: rack, quantity: 10 }] }],
  });

  const batches = await ok<{ ids: string[] }>(page, "inventory.v1.InventoryService/BatchList", {
    teamId: state.warehouse,
    filter: { productId: product.id },
    dataRequest: ["BATCH_LIST_DATA_TYPE_BATCH"],
    page: { page: 1, limit: 10 },
  });
  expect(batches.ids).toHaveLength(1);
  state.batch = batches.ids[0]!;
});

test("Dewi corrects the batch's price with a reason: the Batch row and Stock history read it", async ({ page }) => {
  await login(page, DEWI, PASSWORD);
  await useTeam(page, state.seller);
  await page.goto(`/products/${state.product}`);

  const row = page.getByTestId(`pd-batch-row-${state.batch}`);
  await expect(row).toContainText("Rp 10.000");

  const form = await openForm(page);
  await expect(form.getByTestId("correct-price-current")).toHaveText("Rp 10.000");
  await form.getByTestId("correct-price-new").pressSequentially("12500");
  await form.getByTestId("correct-price-reason").fill(REASON);
  // What changes, before anything posts: the 10 left go from Rp 100.000 to Rp 125.000.
  await expect(form.getByTestId("correct-price-effect-delta")).toHaveText("+Rp 25.000");

  await page.getByTestId("correct-price-save").click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Rp 10.000 → Rp 12.500 for the 10 pcs left");
  await confirm.getByTestId("confirm-action").click();
  await expect(form).toBeHidden();

  // The batch row reads the new price and its units left's value.
  await expect(row).toContainText("Rp 12.500");
  await expect(row).toContainText("Rp 125.000");

  // Stock history: the correction, no unit moved — from → to, the value change, why and who; no Root badge.
  await page.getByTestId("pd-tab-history").click();
  const panel = page.getByTestId("pd-panel-history");
  await expect(panel.locator('[data-testid$="-price"]')).toHaveText("Rp 10.000 → Rp 12.500");
  await expect(panel.locator('[data-testid$="-value"]')).toHaveText("+Rp 25.000");
  await expect(panel.locator('[data-testid$="-reason"]')).toContainText(REASON);
  await expect(panel.locator('[data-testid$="-actor"]')).toContainText(DEWI_NAME);
  await expect(panel.getByText("Price corrected")).toBeVisible();
  await expect(panel.getByTestId("root-team-badge")).toHaveCount(0);
});

test("A stale form is refused: a correction lands while Dewi's form is open, and hers says the price now", async ({ page }) => {
  await login(page, DEWI, PASSWORD);
  await useTeam(page, state.seller);
  await page.goto(`/products/${state.product}`);

  const form = await openForm(page);
  await expect(form.getByTestId("correct-price-current")).toHaveText("Rp 12.500");
  await form.getByTestId("correct-price-new").pressSequentially("11000");
  await form.getByTestId("correct-price-reason").fill("harga promo pemasok");

  // Meanwhile the batch is corrected to Rp 13.000 — from the price the form also showed.
  await ok(page, "inventory.v1.InventoryService/BatchRevalue", {
    teamId: state.seller,
    batchId: state.batch,
    expectedPriceUnit: 12500,
    newPriceUnit: 13000,
    reason: "dikoreksi dari tab lain",
  });

  await page.getByTestId("correct-price-save").click();
  await page.getByRole("alertdialog").getByTestId("confirm-action").click();

  await expect(form.getByTestId("correct-price-error")).toContainText(
    `batch #${state.batch}'s price changed to Rp 13.000 since the form opened`,
  );
  // The form keeps what was typed; nothing was overwritten.
  await expect(form.getByTestId("correct-price-new")).toHaveValue("11.000");

  const listed = await ok<{ items: { batch?: { mapData: Record<string, { unitCost: number }> } }[] }>(
    page,
    "inventory.v1.InventoryService/OwnerBatchList",
    {
      teamId: state.seller,
      filter: { productId: state.product },
      dataRequest: ["OWNER_BATCH_LIST_DATA_TYPE_BATCH"],
      page: { page: 1, limit: 10 },
    },
  );
  const rows = listed.items.find((item) => item.batch)?.batch?.mapData ?? {};
  expect(rows[state.batch]?.unitCost).toBe(13000);
});

test("The warehouse reads the corrections in the batch's Riwayat and has no Correct Price", async ({ page }) => {
  await login(page, WATI, PASSWORD);
  await useTeam(page, state.warehouse);
  await page.goto(`/inventories/batches/${state.batch}`);

  await expect(page.getByTestId("batch-detail-page")).toBeVisible();
  await expect(page.getByTestId("batch-detail-adjust")).toBeVisible();
  await expect(page.getByTestId("batch-detail-correct-price")).toHaveCount(0);

  // Info: the unit price now, and what it was corrected from. Tiba keeps the accepted Rp 100.000.
  await expect(page.getByTestId("batch-detail-unit-cost")).toHaveText("Rp 13.000");
  await expect(page.getByTestId("batch-detail-unit-cost-corrected")).toHaveText("corrected from Rp 12.500");
  await expect(page.getByTestId("batch-detail-arrived-card")).toContainText("Rp 100.000");
  await expect(page.getByTestId("batch-detail-ready-card")).toContainText("Rp 130.000");

  // Riwayat: both corrections, newest first, each from → to with its reason and who.
  const history = page.getByTestId("batch-history-panel");
  await expect(history.locator('[data-testid$="-price"]')).toHaveText(["Rp 12.500 → Rp 13.000", "Rp 10.000 → Rp 12.500"]);
  await expect(history.locator('[data-testid$="-reason"]').last()).toContainText(REASON);
  await expect(history.locator('[data-testid$="-actor"]').first()).toContainText(DEWI_NAME);
});

test("Root, in neither team, corrects from the warehouse's batch page — stamped by Root team", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.warehouse);
  await page.goto(`/inventories/batches/${state.batch}`);

  await page.getByTestId("batch-detail-correct-price").click();
  const form = page.getByTestId("correct-price-dialog");
  await expect(form.getByTestId("correct-price-current")).toHaveText("Rp 13.000");
  await form.getByTestId("correct-price-new").pressSequentially("12000");
  await form.getByTestId("correct-price-reason").fill("Diminta pemilik — kemasan penyok");
  await page.getByTestId("correct-price-save").click();
  await page.getByRole("alertdialog").getByTestId("confirm-action").click();
  await expect(form).toBeHidden();

  await expect(page.getByTestId("batch-detail-unit-cost")).toHaveText("Rp 12.000");
  const newest = page.getByTestId("batch-history-panel").locator('[data-testid$="-why"]').first();
  await expect(newest).toContainText("Diminta pemilik");
  await expect(newest.getByTestId("root-team-badge")).toBeVisible();
});

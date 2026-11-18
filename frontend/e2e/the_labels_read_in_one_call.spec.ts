import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// CETAK LABEL READS EVERY RESTOCK ON THE PRINT IN ONE CALL
// (docs/technical/frontend/restock_decision.md#the-labels-mark-their-one-by-one-read, built 2026-11-16): the page asks
// RestockRequestByIds once for all of them — each restock under Detail's rule, an accepted one's labels under Labels'
// rule — where it used to ask RestockRequestDetail and RestockRequestLabels per restock. An id outside the warehouse's
// scope is left out of the answer, and its row on the Restocks card says so; the interim mark is gone. At most fifty
// restocks a print (at-most-fifty-restocks-a-print): the read refuses a fifty-first.
//
//   R1  → W   accepted: P 3 on rack A, Q 2 on rack B     2 labels, 5 to print (one per piece)
//   R2  → W   arrived: P 4                               1 label from its line, 4 to print (labels-print-from-arrived)
//   R3  → W   ongoing                                    "no labels yet"
//   R4  → W2  another warehouse's                        "Those labels are not available."
//
// Teams of their own, owned by root, paid from the seller's own account. The file sorts after statement.spec.ts.

const SUFFIX = Date.now().toString().slice(-6);
const RACK_A = `lb${SUFFIX}-a`;
const RACK_B = `lb${SUFFIX}-b`;

const state = { w: "", r: {} as Record<string, string> };

async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const r = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: r.status, body: await r.json() };
    },
    [method, body, API_URL] as const,
  );
}

async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

test.describe.configure({ mode: "serial" });

test("Setup: one restock accepted, one arrived, one ongoing — and one sent to another warehouse", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  state.w = await team(`E2E Label Gudang ${SUFFIX}`, `LW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const w2 = await team(`E2E Label Gudang Dua ${SUFFIX}`, `LV${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const seller = await team(`E2E Label Seller ${SUFFIX}`, `LS${SUFFIX}`, "TEAM_TYPE_SELLING");

  const rackA = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.w, code: RACK_A })).rack.id);
  const rackB = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.w, code: RACK_B })).rack.id);

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Label ${SUFFIX}` })).category
    .id as string;
  const product = async (code: string, name: string) =>
    (await ok(page, "product.v1.ProductService/ProductCreate", { teamId: seller, productCodePart: code, name, categoryId: category }))
      .product as { id: string; productCode: string };
  const p = await product(`LBP${SUFFIX}`, "Kaos Label");
  const q = await product(`LBQ${SUFFIX}`, "Topi Label");

  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E labels restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-LBL-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id as string;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: seller,
    accountId: account,
    operational: true,
  });

  const line = (pr: { id: string; productCode: string }, name: string, count: number) => ({
    productId: pr.id,
    productCode: pr.productCode,
    name,
    count,
    total: count * 10_000,
  });
  const raise = async (warehouse: string, items: ReturnType<typeof line>[]) =>
    (
      await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: seller,
        warehouseId: warehouse,
        financeAccountId: account,
        items,
      })
    ).request as { id: string; items: { id: string; productId: string }[] };

  const r1 = await raise(state.w, [line(p, "Kaos Label", 3), line(q, "Topi Label", 2)]);
  const itemOf = (productId: string) => r1.items.find((it) => it.productId === productId)!.id;
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.w,
    requestId: r1.id,
    lines: [
      { itemId: itemOf(p.id), receivedCount: 3, placements: [{ placementId: rackA, quantity: 3 }] },
      { itemId: itemOf(q.id), receivedCount: 2, placements: [{ placementId: rackB, quantity: 2 }] },
    ],
  });

  const r2 = await raise(state.w, [line(p, "Kaos Label", 4)]);
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestArrive", { teamId: state.w, requestId: r2.id });

  const r3 = await raise(state.w, [line(q, "Topi Label", 1)]);
  const r4 = await raise(w2, [line(p, "Kaos Label", 1)]);

  state.r = { r1: r1.id, r2: r2.id, r3: r3.id, r4: r4.id };
});

test("RestockRequestByIds: the warehouse's restocks in one answer, another warehouse's left out; fifty a print", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  const { r1, r2, r3, r4 } = state.r as Record<string, string>;

  type Item = { restockRequest?: { id: string; status: string }; labels?: { labels: { placementCode: string; quantity: string }[] } };
  const res = await ok<{ items?: Record<string, { items: Item[] }> }>(page, "inventory.v1.RestockRequestService/RestockRequestByIds", {
    teamId: state.w,
    filter: { ids: [r1, r2, r3, r4] },
    dataRequest: ["RESTOCK_REQUEST_BY_IDS_DATA_TYPE_RESTOCK_REQUEST", "RESTOCK_REQUEST_BY_IDS_DATA_TYPE_LABELS"],
  });
  const items = res.items ?? {};

  // R1–R3 go to W; R4 went to W2 — absent, never confirmed.
  expect(Object.keys(items).sort()).toEqual([r1, r2, r3].sort());
  for (const id of [r1, r2, r3]) {
    expect(items[id]!.items.find((it) => it.restockRequest)?.restockRequest?.id).toBe(id);
  }

  // The accepted R1 carries its labels in the same answer: one per placement.
  const labels = items[r1]!.items.find((it) => it.labels)?.labels?.labels ?? [];
  expect(labels.map((l) => `${l.placementCode}×${Number(l.quantity)}`).sort()).toEqual([`${RACK_A}×3`, `${RACK_B}×2`]);

  // At most fifty restocks a print — a fifty-first is refused.
  const fiftyOne = Array.from({ length: 51 }, (_, i) => String(1_000_000_000 + i));
  const tooMany = await call(page, "inventory.v1.RestockRequestService/RestockRequestByIds", {
    teamId: state.w,
    filter: { ids: fiftyOne },
    dataRequest: ["RESTOCK_REQUEST_BY_IDS_DATA_TYPE_RESTOCK_REQUEST"],
  });
  expect(tooMany.status).toBe(400);
});

test("Cetak Label: four restocks read in one call — two print, one has no labels yet, one is not available", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.w);
  const { r1, r2, r3, r4 } = state.r as Record<string, string>;

  // Every restock read the page makes, by method.
  const reads: string[] = [];
  page.on("request", (req) => {
    const m = req.url().match(/RestockRequestService\/(\w+)$/);
    if (m) reads.push(m[1]!);
  });

  await page.goto(`/inventories/restock/labels?ids=${r1},${r2},${r3},${r4}`);
  await expect(page.getByTestId("labels-page")).toBeVisible();

  // Each row of the Restocks card says what its restock gives.
  await expect(page.getByTestId(`labels-restock-${r1}-count`)).toHaveText("5 labels");
  await expect(page.getByTestId(`labels-restock-${r2}-count`)).toHaveText("4 labels");
  await expect(page.getByTestId(`labels-restock-${r3}-count`)).toHaveText("no labels yet");
  await expect(page.getByTestId(`labels-restock-${r4}-count`)).toHaveText("Those labels are not available.");

  // The labels: R1's two shelves and R2's one line — 3 stickers, 9 to print in Piece mode.
  await expect(page.getByTestId(`labels-group-${r1}`)).toBeVisible();
  await expect(page.getByTestId(`labels-group-${r2}`)).toBeVisible();
  await expect(page.getByTestId("labels-sheet").locator(".label-sticker")).toHaveCount(3);
  await expect(page.getByTestId("labels-print-root").locator(".print-label")).toHaveCount(9);

  // ONE read for all of them — never a Detail or a Labels call per restock — and no interim mark left on the page.
  expect(reads.filter((m) => m === "RestockRequestByIds").length).toBeGreaterThanOrEqual(1);
  expect(reads.filter((m) => m === "RestockRequestDetail" || m === "RestockRequestLabels")).toEqual([]);
  await expect(page.getByTestId("not-implemented-byIds")).toHaveCount(0);
  await expect(page.getByTestId("not-implemented-summary")).toHaveCount(0);
});

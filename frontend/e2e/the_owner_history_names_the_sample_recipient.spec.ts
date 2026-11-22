import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE OWNING TEAM'S OWN HISTORY NAMES WHO RECEIVED A SAMPLE — end to end, on the real server and Postgres (backlog #111):
//
//   a-sample-keeps-its-recipient (docs/business/inventory/transaction_decision.md) — "the owning team checks its samples
//     by who got them": the recipient is its own fact, set by a sample and empty on every other row, the staff's note
//     staying in the description. Its picture is *Melati's history — 2 Kaos Hitam to Budi*: the OWNER's history.
//     #108 put it on the rack's history (rack_warehouse_wants_to_see_and_sample.spec.ts); #111 puts it on the owning
//     team's own ledger — OwnerStockHistory's OwnerMovement.recipient, the product page's Riwayat Stok saying *given to
//     Pak Budi* on the row's own line (pd-history-row-<id>-recipient), on a phone too, and the discover detail of the
//     team's OWN product (same section). Another team reading the product's history (DiscoverStockHistory) gets no
//     recipient — stock-history-is-everyones names no person.
//
// No acceptance then covers it (the hand-off: placement.md given 17 is the rack page) — every step is a regression.
//
// The ground, all the spec's own: an OWNER selling team (root's) with a person per selling role, a VIEWER selling team
// (root's), one warehouse. One product of the owner: 6 received onto rack A, 2 moved to rack B, then 1 given to Pak Budi
// from rack A with a note — so the history holds a receive, a move and a sample, and only the sample names a person.

const S = Date.now().toString().slice(-6);
const PASSWORD = "e2e-ohrecip-pass-1";
const RECIPIENT = "Pak Budi";
const NOTE = `for a review video ${S}`;
const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
] as const;
type Key = (typeof ROLES)[number]["key"];
// A username is lowercase letters and digits only.
const username = (key: Key) => `e2eohr${key}${S}`;

const ground = { owner: "", viewer: "", warehouse: "", product: "", code: "" };

type Movement = { id: string; kind?: string; delta?: string; reason?: string; recipient?: string };

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

// A ledger answer's rows in its own order — `ids`, each looked up in the MOVEMENT slice.
function rowsOf(res: { ids?: string[]; items?: { movement?: { mapData?: Record<string, object> } }[] }): Movement[] {
  const map = res.items?.find((item) => item.movement)?.movement?.mapData ?? {};

  return (res.ids ?? []).map((id) => ({ id, ...(map[id] ?? {}) }) as Movement);
}

const ownerHistory = async (page: Page) =>
  rowsOf(
    await ok(page, "inventory.v1.InventoryService/OwnerStockHistory", {
      teamId: ground.owner,
      filter: { productId: ground.product, warehouseId: "0" },
      dataRequest: ["OWNER_STOCK_HISTORY_DATA_TYPE_MOVEMENT"],
      page: { page: 1, limit: 50 },
    }),
  );

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const isSample = (m: Movement) => m.kind === "MOVEMENT_KIND_SAMPLE";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.owner = await team(`E2E OHR Owner ${S}`, `SRO${S}`, "TEAM_TYPE_SELLING");
  ground.viewer = await team(`E2E OHR Viewer ${S}`, `SRV${S}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E OHR Gudang ${S}`, `SRW${S}`, "TEAM_TYPE_WAREHOUSE");

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E OHR ${S}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.owner,
      productCodePart: `SRP${S}`,
      name: `E2E OHR Kaos ${S}`,
      categoryId: category,
      crossMarkupBps: 1000,
    })
  ).product;
  ground.product = String(product.id);
  ground.code = String(product.productCode);

  const account = String(
    (
      await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.owner,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E OHR restock ${S}`,
        holderName: "E2E",
        accountNumber: `E2E-OHR-${S}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  // A restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account).
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.owner,
    accountId: account,
    operational: true,
  });

  const rack = async (code: string) =>
    String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code })).rack.id);
  const rackA = await rack(`ohr-a-${S}`);
  const rackB = await rack(`ohr-b-${S}`);

  // 6 received onto rack A.
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.owner,
    warehouseId: ground.warehouse,
    financeAccountId: account,
    items: [{ productId: ground.product, productCode: ground.code, name: `E2E OHR Kaos ${S}`, count: 6, total: 60_000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 6, placements: [{ placementId: rackA, quantity: 6 }] }],
  });
  // 2 moved to rack B — a row that names nobody.
  await ok(page, "inventory.v1.RackService/RackMove", {
    teamId: ground.warehouse,
    fromRackId: rackA,
    lines: [{ productId: ground.product, quantity: 2, toRackId: rackB }],
  });
  // 1 given to Pak Budi from rack A, with the staff's note.
  await ok(page, "inventory.v1.RackService/RackSample", {
    teamId: ground.warehouse,
    rackId: rackA,
    lines: [{ productId: ground.product, quantity: 1 }],
    recipient: RECIPIENT,
    description: NOTE,
  });

  for (const r of ROLES) {
    await ok(page, "user.v1.UserService/CreateUser", {
      teamId: ground.owner,
      username: username(r.key),
      password: PASSWORD,
      name: `OHR ${r.given} ${S}`,
      role: r.role,
    });
  }

  await page.close();
});

test.describe("the owning team's own history names who received a sample (a-sample-keeps-its-recipient)", () => {
  for (const r of ROLES) {
    test(`${r.given} reads the sample's recipient on its product's history`, async ({ page }) => {
      await signIn(page, username(r.key), PASSWORD);
      await useTeam(page, ground.owner);

      let sampleId = "";
      await test.step("regression: OwnerStockHistory names Pak Budi on the sample row only, the note kept apart", async () => {
        const rows = await ownerHistory(page);
        const samples = rows.filter(isSample);
        expect(samples, JSON.stringify(rows)).toHaveLength(1);
        sampleId = samples[0]!.id;
        expect(samples[0]!.recipient).toBe(RECIPIENT);
        expect(Number(samples[0]!.delta)).toBe(-1);
        expect(samples[0]!.reason).toBe(NOTE);
        // The receive (and whatever the move left on the owner's ledger) names nobody.
        const others = rows.filter((m) => !isSample(m));
        expect(others.some((m) => m.kind === "MOVEMENT_KIND_RECEIVE"), JSON.stringify(rows)).toBe(true);
        for (const m of others) expect(m.recipient ?? "", `${m.kind} row ${m.id}`).toBe("");
      });

      await test.step("regression: the product page's Riwayat Stok says given to Pak Budi on the sample row's own line", async () => {
        await page.goto(`/products/${ground.product}`);
        await page.getByTestId("pd-tab-history").click();
        const panel = page.getByTestId("pd-panel-history");
        await expect(panel.getByTestId(`pd-history-row-${sampleId}`)).toBeVisible();
        await expect(panel.getByTestId(`pd-history-row-${sampleId}-recipient`)).toHaveText(`given to ${RECIPIENT}`);
        // Only the sample's row names a person.
        await expect(panel.locator('[data-testid^="pd-history-row-"][data-testid$="-recipient"]')).toHaveCount(1);
      });

      await test.step("regression: on a phone the sample's block says given to Pak Budi too", async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload();
        await page.getByTestId("pd-tab-history").click();
        const panel = page.getByTestId("pd-panel-history");
        await expect(panel.getByTestId(`pd-history-row-${sampleId}-recipient`)).toHaveText(`given to ${RECIPIENT}`);
        await expect(panel.locator('[data-testid^="pd-history-row-"][data-testid$="-recipient"]')).toHaveCount(1);
      });
    });
  }

  test("regression: the discover detail of the team's OWN product names the recipient too", async ({ page }) => {
    await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
    await useTeam(page, ground.owner);
    const sample = (await ownerHistory(page)).find(isSample)!;

    await page.goto(`/products/discover/${ground.product}`);
    await expect(page.getByTestId("discover-detail-page")).toBeVisible();
    const asked = page.waitForRequest((q) => q.url().includes("InventoryService/OwnerStockHistory"));
    await page.getByTestId("dd-tab-history").click();
    await asked;
    const panel = page.getByTestId("dd-panel-history");
    await expect(panel.getByTestId(`pd-history-row-${sample.id}-recipient`)).toHaveText(`given to ${RECIPIENT}`);
  });

  test("regression: another team reading the product's history gets no recipient (DiscoverStockHistory)", async ({ page }) => {
    await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
    await useTeam(page, ground.viewer);

    const res = await ok(page, "inventory.v1.InventoryService/DiscoverStockHistory", {
      teamId: ground.viewer,
      filter: { productId: ground.product, warehouseId: "0" },
      dataRequest: ["DISCOVER_STOCK_HISTORY_DATA_TYPE_MOVEMENT"],
      page: { page: 1, limit: 50 },
    });
    const rows = rowsOf(res);
    // The sample IS on another team's view (units move) — so the missing name is not an empty answer.
    expect(rows.some((m) => Number(m.delta) === -1), JSON.stringify(rows)).toBe(true);
    expect(JSON.stringify(res)).not.toContain(RECIPIENT);
    for (const m of rows) expect(m.recipient, `row ${m.id}`).toBeUndefined();

    await page.goto(`/products/discover/${ground.product}`);
    await expect(page.getByTestId("discover-detail-page")).toBeVisible();
    const asked = page.waitForResponse((q) => q.url().includes("InventoryService/DiscoverStockHistory"));
    await page.getByTestId("dd-tab-history").click();
    await asked;
    const panel = page.getByTestId("dd-panel-history");
    await expect(panel.locator('[data-testid^="pd-history-row-"]').first()).toBeVisible();
    await expect(panel.locator('[data-testid$="-recipient"]')).toHaveCount(0);
    await expect(panel).not.toContainText(RECIPIENT);
  });
});

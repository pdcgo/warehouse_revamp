import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { asRoot, call, login, signInAs, today } from "./metric_ground";

// PRODUK TURUNAN IS THE RETURN MAP, READ BOTH WAYS ACROSS TEAMS — end to end, on the real server and Postgres (#140):
//
//   produk-turunan-is-the-return-map (docs/business/product/context_decision.md) — when team A sells team B's product
//     and maps it for returns, A's map names the own product it lands on; a product's derived products are read from
//     those maps in BOTH directions, ACROSS teams:
//       Turunan dari   the product(s) this product was mapped FROM — its owner team's maps onto it, one line each
//                      (a team may land several borrowed products on one own product: the-map-is-unique-on-its-source);
//       Turunannya     every team's own product mapped from this one — that team, the SKU and its READY stock in pcs;
//                      the card holds the count, the first three and "See All (N)" (the-warehouse-zone-is-tabs);
//     shown on the product's own page AND on the Discover detail (the-discover-detail-shows-no-markup); a warehouse role
//     is refused, as Discover refuses it; the order form's read (ProductReturnMapByIds) stays the team's own.
//
// The ground, all the spec's own (root seeds from the test runner; each reader signs in with its own token):
//   OWNER team O — product P (no stock) and product E (no map either way);
//   four BORROWER teams B1..B4 — each maps P onto its own Qi (B2, B3, B4, then B1: B1's is the newest);
//     Q1 holds 4 units ready in the warehouse, the others none;
//   two SOURCE teams S1, S2 — O maps S2's X2, then S1's X1, onto P (two lines of Turunan dari); X1 holds 3 ready;
//   a VIEWER team V (no map at all) — its selling:cs reads the Discover detail;
//   a WAREHOUSE W — receives the stock; its staff is the refused warehouse role.
// O's selling:admin reads the product page. No order is placed; root's own team is never touched.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-turunan-pass-1";
// A username is lowercase letters and digits only.
const ADMIN = `e2eptadm${SUFFIX}`;
const CS = `e2eptcs${SUFFIX}`;
const STAFF = `e2eptwh${SUFFIX}`;

const NAME = {
  owner: `E2E PT Owner ${SUFFIX}`,
  viewer: `E2E PT Viewer ${SUFFIX}`,
  warehouse: `E2E PT Gudang ${SUFFIX}`,
  borrower: (i: number) => `E2E PT Borrower ${i} ${SUFFIX}`,
  source: (i: number) => `E2E PT Source ${i} ${SUFFIX}`,
};

interface Made {
  id: string;
  code: string;
  name: string;
}

const g = {
  owner: "",
  viewer: "",
  warehouse: "",
  borrowers: [] as string[], // B1..B4
  sources: [] as string[], // S1, S2
  p: { id: "", code: "", name: "" } as Made,
  e: { id: "", code: "", name: "" } as Made,
  q: [] as Made[], // Q1..Q4, each its borrower's
  x: [] as Made[], // X1, X2, each its source's
};

// An RPC as `token` that does not throw — its status and JSON body (a refusal is the answer under test).
async function send(token: string, method: string, body: unknown) {
  const res = await fetch(`${API_URL}/warehouse.${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const team = async (name: string, teamCode: string, type: string) =>
  String(
    (await asRoot<{ team: { id: string } }>("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID }))
      .team.id,
  );

let category = "";
const product = async (teamId: string, part: string, name: string): Promise<Made> => {
  const made = (
    await asRoot<{ product: { id: string; productCode: string } }>("product.v1.ProductService/ProductCreate", {
      teamId,
      productCodePart: part,
      name,
      categoryId: category,
      crossMarkupBps: 1000,
    })
  ).product;

  return { id: String(made.id), code: String(made.productCode), name };
};

let rack = "";
// `count` of the product received into the warehouse, on its rack — ready stock the owner's batches hold.
async function receive(teamId: string, tag: string, p: Made, count: number) {
  const account = String(
    (
      await asRoot<{ account: { id: string } }>("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E PT restock ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-PT-${tag}-${SUFFIX}`,
        openingBalance: 0,
        openingOn: today(),
      })
    ).account.id,
  );
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId,
    accountId: account,
    operational: true,
  });

  const created = await asRoot<{ request: { id: string; items: { id: string }[] } }>(
    "inventory.v1.RestockRequestService/RestockRequestCreate",
    {
      teamId,
      warehouseId: g.warehouse,
      financeAccountId: account,
      items: [{ productId: p.id, productCode: p.code, name: p.name, count, total: count * 10_000 }],
    },
  );
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: g.warehouse,
    requestId: created.request.id,
    lines: [{ itemId: created.request.items[0].id, receivedCount: count, placements: [{ placementId: rack, quantity: count }] }],
  });
}

// The team maps another team's `shared` product onto its own `own` one — as order create's confirmed pick writes it.
async function map(teamId: string, shared: Made, own: Made) {
  const res = await asRoot<{ created?: boolean; map?: { ownProductId?: string } }>(
    "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate",
    { teamId, sharedProductId: shared.id, ownProductId: own.id },
  );
  expect(res.created, `map ${shared.code} → ${own.code}`).toBe(true);
}

const readyOf = async (teamId: string, ids: string[]) =>
  (
    await asRoot<{ items: { productId: string; readyQty?: string }[] }>("inventory.v1.InventoryService/DiscoverStockByIds", {
      teamId,
      productIds: ids,
      warehouseId: "0",
    })
  ).items.map((i) => Number(i.readyQty ?? 0));

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(120_000);

  g.owner = await team(NAME.owner, `PDO${SUFFIX}`, "TEAM_TYPE_SELLING");
  g.viewer = await team(NAME.viewer, `PDV${SUFFIX}`, "TEAM_TYPE_SELLING");
  g.warehouse = await team(NAME.warehouse, `PDW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  for (const i of [1, 2, 3, 4]) g.borrowers.push(await team(NAME.borrower(i), `PD${i}${SUFFIX}`, "TEAM_TYPE_SELLING"));
  for (const i of [1, 2]) g.sources.push(await team(NAME.source(i), `PDS${i}${SUFFIX}`, "TEAM_TYPE_SELLING"));

  await asRoot("user.v1.UserService/CreateUser", {
    teamId: g.owner,
    username: ADMIN,
    password: PASSWORD,
    name: `PT Admin ${SUFFIX}`,
    role: "ROLE_SELLING_ADMIN",
  });
  await asRoot("user.v1.UserService/CreateUser", {
    teamId: g.viewer,
    username: CS,
    password: PASSWORD,
    name: `PT CS ${SUFFIX}`,
    role: "ROLE_SELLING_CS",
  });
  await asRoot("user.v1.UserService/CreateUser", {
    teamId: g.warehouse,
    username: STAFF,
    password: PASSWORD,
    name: `PT Staff ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  category = String(
    (await asRoot<{ category: { id: string } }>("category.v1.CategoryService/CategoryCreate", { name: `E2E PT ${SUFFIX}` })).category
      .id,
  );
  g.p = await product(g.owner, `PTP${SUFFIX}`, `E2E PT Kaos ${SUFFIX}`);
  g.e = await product(g.owner, `PTE${SUFFIX}`, `E2E PT Topi ${SUFFIX}`);
  for (const i of [1, 2, 3, 4]) g.q.push(await product(g.borrowers[i - 1], `PTQ${i}${SUFFIX}`, `E2E PT Kaos B${i} ${SUFFIX}`));
  for (const i of [1, 2]) g.x.push(await product(g.sources[i - 1], `PTX${i}${SUFFIX}`, `E2E PT Celana S${i} ${SUFFIX}`));

  rack = String(
    (await asRoot<{ rack: { id: string } }>("inventory.v1.RackService/RackCreate", { teamId: g.warehouse, code: `pt-${SUFFIX}` })).rack.id,
  );
  await receive(g.borrowers[0], "B1", g.q[0], 4);
  await receive(g.sources[0], "S1", g.x[0], 3);
  await expect.poll(() => readyOf(g.viewer, [g.q[0].id, g.x[0].id]), { timeout: 30_000 }).toEqual([4, 3]);

  // Turunannya of P — B2, B3, B4, then B1: the newest map first is B1's (Q1, the stocked one).
  for (const i of [2, 3, 4, 1]) await map(g.borrowers[i - 1], g.p, g.q[i - 1]);
  // Turunan dari of P — O lands S2's X2, then S1's X1, both on P.
  await map(g.owner, g.x[1], g.p);
  await map(g.owner, g.x[0], g.p);
});

// A derived line: its team's badge, the product's SKU and its ready stock — "N pcs", "N pcs ready" said by its label.
async function expectLine(page: Page, testId: string, teamName: string, p: Made, ready: number) {
  const line = page.getByTestId(testId);
  await expect(line).toBeVisible();
  await expect(line).toContainText(teamName);
  await expect(line).toContainText(p.code);
  await expect(page.getByTestId(`${testId}-pcs`)).toHaveText(`${ready} pcs`);
  await expect(page.getByTestId(`${testId}-pcs`)).toHaveAttribute("aria-label", `${ready} pcs ready`);
}

// P's section, as both pages draw it: Turunan dari two lines (X1 newest, then X2); Turunannya 4, the first three
// newest first, and every one of them in See All.
async function expectP(page: Page, section: string) {
  const s = page.getByTestId(section);
  await expect(s.getByTestId("pd-derived-from")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("pd-derived-loading")).toHaveCount(0);
  await expect(page.getByTestId("pd-derived-error")).toHaveCount(0);

  await test.step("Turunan dari: one line per product mapped onto it — its owner team, its SKU, its ready pcs", async () => {
    await expectLine(page, "pd-derived-from-item", NAME.source(1), g.x[0], 3);
    await expectLine(page, "pd-derived-from-item-1", NAME.source(2), g.x[1], 0);
    await expect(page.getByTestId("pd-derived-from-item-2")).toHaveCount(0);
  });

  await test.step("Turunannya: the count, the first three newest first — team, SKU, ready pcs", async () => {
    await expect(page.getByTestId("pd-derived-count")).toHaveText("4");
    await expectLine(page, "pd-derived-to-0", NAME.borrower(1), g.q[0], 4);
    await expectLine(page, "pd-derived-to-1", NAME.borrower(4), g.q[3], 0);
    await expectLine(page, "pd-derived-to-2", NAME.borrower(3), g.q[2], 0);
    await expect(page.getByTestId("pd-derived-to-3")).toHaveCount(0);
  });

  await test.step("See All (4) opens every derived product — its name and SKU, its team, its ready pcs", async () => {
    const all = page.getByTestId("pd-derived-see-all");
    await expect(all).toHaveText("See All (4)");
    await all.click();
    const dialog = page.getByTestId("pd-derived-dialog");
    await expect(dialog).toBeVisible();
    const rows = [
      { i: 0, team: NAME.borrower(1), p: g.q[0], ready: 4 },
      { i: 1, team: NAME.borrower(4), p: g.q[3], ready: 0 },
      { i: 2, team: NAME.borrower(3), p: g.q[2], ready: 0 },
      { i: 3, team: NAME.borrower(2), p: g.q[1], ready: 0 },
    ];
    for (const r of rows) {
      const cells = dialog.getByTestId(`pd-derived-row-${r.i}`).locator("td");
      await expect(cells.nth(0)).toContainText(r.p.name);
      await expect(cells.nth(0)).toContainText(r.p.code);
      await expect(cells.nth(1)).toHaveText(r.team);
      await expect(cells.nth(2)).toHaveText(`${r.ready} pcs`);
    }
    await expect(dialog.getByTestId("pd-derived-row-4")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}

test("selling:admin on the product page: Produk Turunan both ways — from the other teams' products, to every team's", async ({
  page,
}) => {
  await signInAs(page, ADMIN, PASSWORD, g.owner);
  await page.goto(`/products/${g.p.id}`);
  await expect(page.getByTestId("product-detail-page")).toBeVisible();
  await expect(page.getByTestId("pd-section-derived")).toBeVisible();

  await expectP(page, "pd-section-derived");
});

test("selling:admin on the product page: a product no map names reads none either way", async ({ page }) => {
  await signInAs(page, ADMIN, PASSWORD, g.owner);
  await page.goto(`/products/${g.e.id}`);
  await expect(page.getByTestId("product-detail-page")).toBeVisible();

  const from = page.getByTestId("pd-derived-from");
  await expect(from).toBeVisible({ timeout: 15_000 });
  await expect(from).toContainText("This product is not derived from another team’s.");
  await expect(page.getByTestId("pd-derived-from-item")).toHaveCount(0);
  await expect(page.getByTestId("pd-derived-count")).toHaveText("0");
  await expect(page.getByTestId("pd-derived-to")).toContainText("No other team has made a product of this one.");
  await expect(page.getByTestId("pd-derived-to-0")).toHaveCount(0);
  await expect(page.getByTestId("pd-derived-see-all")).toHaveCount(0);
});

test("selling:cs of a team with no map, on the Discover detail: the other teams' maps of P, both ways", async ({ page }) => {
  await signInAs(page, CS, PASSWORD, g.viewer);
  await page.goto(`/products/discover/${g.p.id}`);
  await expect(page.getByTestId("discover-detail-page")).toBeVisible();
  await expect(page.getByTestId("dd-section-derived")).toBeVisible();

  await expectP(page, "dd-section-derived");
});

test("selling:cs on the Discover detail of a borrower's product: Turunan dari names P and its owner team", async ({ page }) => {
  await signInAs(page, CS, PASSWORD, g.viewer);
  await page.goto(`/products/discover/${g.q[0].id}`);
  await expect(page.getByTestId("discover-detail-page")).toBeVisible();

  await expect(page.getByTestId("pd-derived-from")).toBeVisible({ timeout: 15_000 });
  await expectLine(page, "pd-derived-from-item", NAME.owner, g.p, 0);
  await expect(page.getByTestId("pd-derived-from-item-1")).toHaveCount(0);
  await expect(page.getByTestId("pd-derived-count")).toHaveText("0");
  await expect(page.getByTestId("pd-derived-to")).toContainText("No other team has made a product of this one.");
});

test("warehouse:staff is refused ProductDerivedList; a selling role of any team is answered every team's maps", async () => {
  const staff = await login(STAFF, PASSWORD);
  const refused = await send(staff, "selling.v1.TeamReturnConfigurationService/ProductDerivedList", {
    teamId: g.warehouse,
    filter: { productId: g.p.id },
  });
  expect(refused.status).toBe(403);
  expect(refused.json.code).toBe("permission_denied");

  const cs = await login(CS, PASSWORD);
  const answered = await call<{
    derivedFrom?: { teamId: string; sharedProductId: string; ownProductId: string }[];
    derivedTo?: { teamId: string; sharedProductId: string; ownProductId: string }[];
    derivedFromTotal?: string;
    derivedToTotal?: string;
  }>(cs, "selling.v1.TeamReturnConfigurationService/ProductDerivedList", { teamId: g.viewer, filter: { productId: g.p.id } });
  expect(answered.derivedToTotal).toBe("4");
  expect(answered.derivedFromTotal).toBe("2");
  expect((answered.derivedTo ?? []).map((m) => m.ownProductId)).toEqual([g.q[0].id, g.q[3].id, g.q[2].id, g.q[1].id]);
  expect((answered.derivedTo ?? []).map((m) => m.teamId)).toEqual([g.borrowers[0], g.borrowers[3], g.borrowers[2], g.borrowers[1]]);
  expect((answered.derivedFrom ?? []).map((m) => m.sharedProductId)).toEqual([g.x[0].id, g.x[1].id]);
  expect((answered.derivedFrom ?? []).every((m) => m.teamId === g.owner && m.ownProductId === g.p.id)).toBe(true);

  await test.step("regression: the order form's read (ProductReturnMapByIds) stays the team's own", async () => {
    const pairs = (teamId: string) =>
      asRoot<Record<string, unknown>>("selling.v1.TeamReturnConfigurationService/ProductReturnMapByIds", {
        teamId,
        filter: { ids: [g.p.id] },
        dataRequest: ["PRODUCT_RETURN_MAP_BY_IDS_DATA_TYPE_PAIR"],
      });
    const viewer = JSON.stringify(await pairs(g.viewer));
    for (const q of g.q) expect(viewer).not.toContain(`"ownProductId":"${q.id}"`);
    const b1 = JSON.stringify(await pairs(g.borrowers[0]));
    expect(b1).toContain(`"ownProductId":"${g.q[0].id}"`);
    for (const q of g.q.slice(1)) expect(b1).not.toContain(`"ownProductId":"${q.id}"`);
  });
});

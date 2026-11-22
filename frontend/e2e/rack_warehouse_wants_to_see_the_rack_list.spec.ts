import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { API_URL } from "./env";

// warehouse:all wants to see the racks, and selling:all may not — the checks behind docs/acceptances/inventory/placement.md,
// section *racks*, when *open racks* (givens 8 and 10) and *filter racks* (given 9). One test per role the given names,
// each signed in as a person of that role.
//
//   8 (warehouse:owner · admin · staff — 3 racks · 1 empty · 12 units on 2) → open racks, from the menu (Inventories › Racks)
//      then: racks 3 · holding stock 2 · empty 1 · 12 pcs — the four cards over the list (the-rack-list-leads-with-its-
//            figures): Racks 3, Holding stock 2, Empty 1, Stock on racks 12 pcs; RackStat under the role's own token
//            answers the same; the list holds the three racks;
//      then: only the empty rack marked "empty" — b-08-3 carries the Empty badge (an-empty-rack-says-so); b-08-1 (7 pcs)
//            and b-08-2 (5 pcs) do not; one badge on the whole list.
//   9 (warehouse:owner · admin · staff — search "a-01") → filter racks: "a-01" typed into the list's search
//      then: only matching racks listed — of a-01-1, a-01-2, a-02-1 and b-01-1 (all four listed before the search), the
//            list holds a-01-1 and a-01-2 and nothing else; the search is in the address (a-lists-filters-live-in-the-
//            url); RackList under the role's own token, searched "a-01", names exactly those two. A match is the search
//            found in the code (rackListScope: code or name — no rack here has a name, so only the code can match).
//  10 (selling:owner · admin · cs — a selling team with goods in the warehouse) → open racks, by its address (a selling
//      team's menu has no Racks: the-racks-page-is-the-placement-list)
//      then: cannot see racks — no Racks entry in the seller's menu (its Restock entry is there); the page shows the
//            refusal and no rack (RackList answers permission_denied); under the seller's own token RackList, RackStat
//            and RackDetail for the warehouse holding its goods are refused, and that rack's own page by its address
//            shows an error, never the rack.
//
// The ground (root, once): a selling team of the spec's own with an operational account (a-restock-names-its-paying-
// account). Given 8: per warehouse role a warehouse of its own and a person of that role in it, racks B-08-1, B-08-2,
// B-08-3, and 12 units of the seller's product accepted onto the first two (7 + 5) — so no other test's rack can stand in
// for these figures. Given 9: per warehouse role another warehouse of its own and a person of that role, racks A-01-1,
// A-01-2, A-02-1 and B-01-1 (two match "a-01", two do not). Given 10: one warehouse holding 4 units of the seller's
// goods on B-10-1, and the seller's owner, admin and cs.

const PASSWORD = "e2e-rack-see-pass-1";
const WAREHOUSE = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
] as const;
const SELLING = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "scs" },
] as const;
type Key = string;

// Each given's case text, verbatim from placement.md — the marking script finds the tests by it.
const C8 = "3 racks · 1 empty · 12 units on 2";
const C9 = 'search "a-01"';
const C10 = "selling team with goods in the warehouse";

// A username is lowercase letters and digits only.
const username = (key: Key) => `e2erksee${key}${SUFFIX}`;

const ground = {
  seller: "",
  // Given 8's warehouse per role; given 10's one warehouse, and its rack holding the seller's goods.
  warehouses: {} as Record<Key, string>,
  // Given 9's warehouse per role (keyed by the role's key).
  searched: {} as Record<Key, string>,
  sellerWarehouse: "",
  sellerRack: "",
};

// A call that may be refused — the status and the answer, never a throw.
async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

// Signed in as the role's person, working in `teamId`: the active team is per tab, in sessionStorage (TeamContext).
async function asRole(page: Page, key: Key, teamId: string) {
  await login(page, username(key), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const racksLink = (page: Page) => page.getByTestId("sidebar").locator('a[href="/inventories/racks"]');
const restockLink = (page: Page) => page.getByTestId("sidebar").locator('a[href="/inventories/restock"]');

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // The goods' owner: a selling team, a category, and the operational account its restocks are paid from.
  ground.seller = String(
    (
      await api(page, "team.v1.TeamService/TeamCreate", {
        name: `E2E Rak Lihat Seller ${SUFFIX}`,
        teamCode: `RLVP${SUFFIX}`,
        type: "TEAM_TYPE_SELLING",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Rak Lihat ${SUFFIX}` });
  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E rak lihat restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-RKSEE-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: account,
    operational: true,
  });

  const warehouse = async (code: string, label: string) =>
    String(
      (
        await api(page, "team.v1.TeamService/TeamCreate", {
          name: `E2E Rak Lihat ${label} ${SUFFIX}`,
          teamCode: `${code}${SUFFIX}`,
          type: "TEAM_TYPE_WAREHOUSE",
          ownerUserId: ROOT_USER_ID,
        })
      ).team.id,
    );
  const person = async (teamId: string, r: { given: string; role: string; key: Key }) =>
    api(page, "user.v1.UserService/CreateUser", {
      teamId,
      username: username(r.key),
      password: PASSWORD,
      name: `Rak Lihat ${r.given} ${SUFFIX}`,
      role: r.role,
    });
  const rack = async (teamId: string, code: string) =>
    String((await api(page, "inventory.v1.RackService/RackCreate", { teamId, code })).rack.id);
  // A product of the seller's own, restocked into the warehouse and accepted onto the racks as given.
  const putOn = async (teamId: string, tag: string, placements: { placementId: string; quantity: number }[]) => {
    const count = placements.reduce((sum, p) => sum + p.quantity, 0);
    const created = await api(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `RLV${tag}${SUFFIX}`,
      name: `Barang Rak Lihat ${tag} ${SUFFIX}`,
      categoryId: category.category.id,
    });
    const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: teamId,
      financeAccountId: account,
      items: [
        {
          productId: created.product.id,
          productCode: created.product.productCode,
          name: `Barang Rak Lihat ${tag} ${SUFFIX}`,
          count,
          total: count * 10_000,
        },
      ],
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId,
      requestId: restock.request.id,
      lines: [{ itemId: (restock.request.items as { id: string }[])[0]!.id, receivedCount: count, placements }],
    });
  };

  // GIVEN 8 — 3 racks, 12 units on two of them (7 + 5), the third empty.
  for (const r of WAREHOUSE) {
    ground.warehouses[r.key] = await warehouse(`RLV${r.key[0]!.toUpperCase()}`, r.key);
    await person(ground.warehouses[r.key], r);
    const one = await rack(ground.warehouses[r.key], "B-08-1");
    const two = await rack(ground.warehouses[r.key], "B-08-2");
    await rack(ground.warehouses[r.key], "B-08-3");
    await putOn(ground.warehouses[r.key], r.key[0]!.toUpperCase(), [
      { placementId: one, quantity: 7 },
      { placementId: two, quantity: 5 },
    ]);
  }

  // GIVEN 9 — four racks, two whose code holds "a-01" and two whose code does not. Typed in capitals: a code is
  // stored trimmed and lowercased (rack-codes-are-saved-lowercase), so these read a-01-1 … b-01-1.
  for (const r of WAREHOUSE) {
    ground.searched[r.key] = await warehouse(`RLF${r.key[0]!.toUpperCase()}`, `cari ${r.key}`);
    await person(ground.searched[r.key], { ...r, key: `f${r.key}` });
    for (const code of ["A-01-1", "A-01-2", "A-02-1", "B-01-1"]) {
      await rack(ground.searched[r.key], code);
    }
  }

  // GIVEN 10 — the selling team's goods on a warehouse's rack, and its people.
  ground.sellerWarehouse = await warehouse("RLVX", "Gudang Seller");
  ground.sellerRack = await rack(ground.sellerWarehouse, "B-10-1");
  await putOn(ground.sellerWarehouse, "X", [{ placementId: ground.sellerRack, quantity: 4 }]);
  for (const r of SELLING) {
    await person(ground.seller, r);
  }

  // The goods ARE in that warehouse, on that rack — so a refusal below is a refusal, not an empty warehouse.
  const held = await api(page, "inventory.v1.RackService/RackStat", { teamId: ground.sellerWarehouse, filter: { q: "" } });
  expect(Number(held.preview?.stockCount ?? 0)).toBe(4);

  await page.close();
});

test.describe(`warehouse:all wants to see the racks (${C8})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open racks (${C8})`, async ({ page }) => {
      await asRole(page, r.key, ground.warehouses[r.key]!);

      // WHEN — open racks: the menu's Inventories › Racks.
      await page.goto("/");
      await expect(racksLink(page)).toHaveCount(1);
      if (!(await racksLink(page).isVisible())) await page.getByTestId("nav-group-toggle-nav.inventories").click();
      await racksLink(page).click();
      await expect(page).toHaveURL(/\/inventories\/racks$/);
      const table = page.getByTestId("racks-table");
      await expect(table).toBeVisible();

      await test.step("then: racks 3 · holding stock 2 · empty 1 · 12 pcs", async () => {
        const card = (id: string) => page.getByTestId(`racks-stat-${id}`);
        await expect.soft(card("racks")).toContainText("Racks");
        await expect.soft(page.getByTestId("racks-stat-racks-value")).toHaveText("3");
        await expect.soft(card("filled")).toContainText("Holding stock");
        await expect.soft(page.getByTestId("racks-stat-filled-value")).toHaveText("2");
        await expect.soft(card("empty")).toContainText("Empty");
        await expect.soft(page.getByTestId("racks-stat-empty-value")).toHaveText("1");
        await expect.soft(card("stock")).toContainText("Stock on racks");
        await expect.soft(page.getByTestId("racks-stat-stock-value")).toHaveText("12 pcs");

        // The list holds the three racks, and their pieces add up to the card's.
        await expect.soft(table.locator('[data-testid^="rack-row-"]')).toHaveCount(3);
        await expect.soft(page.getByTestId("rack-stock-b-08-1")).toHaveText("7");
        await expect.soft(page.getByTestId("rack-stock-b-08-2")).toHaveText("5");
        await expect.soft(page.getByTestId("rack-stock-b-08-3")).toHaveText("0");

        // The contract, under the role's own token: racks · holding stock · empty · pieces.
        const stat = await send(page, "inventory.v1.RackService/RackStat", {
          teamId: ground.warehouses[r.key],
          filter: { q: "" },
        });
        expect.soft(stat.status).toBe(200);
        const p = (stat.json.preview ?? {}) as Record<string, string>;
        expect.soft([p.rackCount, p.filledCount, p.emptyCount, p.stockCount].map((v) => Number(v ?? 0))).toEqual([3, 2, 1, 12]);
      });

      await test.step('then: only the empty rack marked "empty"', async () => {
        await expect.soft(page.getByTestId("rack-empty-b-08-3")).toBeVisible();
        await expect.soft(page.getByTestId("rack-empty-b-08-3")).toHaveText(/^empty$/i);
        await expect.soft(page.getByTestId("rack-empty-b-08-1")).toHaveCount(0);
        await expect.soft(page.getByTestId("rack-empty-b-08-2")).toHaveCount(0);
        await expect.soft(table.locator('[data-testid^="rack-empty-"]')).toHaveCount(1);
        // The badge sits on the empty rack's own row.
        await expect.soft(page.getByTestId("rack-row-b-08-3").getByTestId("rack-empty-b-08-3")).toHaveCount(1);
      });
    });
  }
});

test.describe(`warehouse:all wants to see the racks (${C9})`, () => {
  const ALL = ["a-01-1", "a-01-2", "a-02-1", "b-01-1"];
  const MATCHING = ["a-01-1", "a-01-2"];

  for (const r of WAREHOUSE) {
    test(`${r.given} filter racks (${C9})`, async ({ page }) => {
      await asRole(page, `f${r.key}`, ground.searched[r.key]!);

      // The list before the search holds all four — so a rack missing below was searched away, not never there.
      await page.goto("/inventories/racks");
      const table = page.getByTestId("racks-table");
      const rows = table.locator('[data-testid^="rack-row-"]');
      await expect(rows).toHaveCount(ALL.length);
      for (const code of ALL) await expect(page.getByTestId(`rack-row-${code}`)).toBeVisible();

      // WHEN — filter racks: "a-01" typed into the list's search.
      const searched = page.waitForResponse(
        (res) =>
          res.url().includes("/warehouse.inventory.v1.RackService/RackList") &&
          (res.request().postData() ?? "").includes('"a-01"'),
      );
      await page.getByTestId("rack-search").fill("a-01");
      await searched;

      await test.step("then: only matching racks listed", async () => {
        await expect.soft(rows).toHaveCount(MATCHING.length);
        for (const code of MATCHING) await expect.soft(page.getByTestId(`rack-row-${code}`)).toBeVisible();
        for (const code of ALL.filter((c) => !MATCHING.includes(c))) {
          await expect.soft(page.getByTestId(`rack-row-${code}`)).toHaveCount(0);
        }
        // Every listed row's code holds the search.
        const listed = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")!.slice("rack-row-".length)));
        expect.soft(listed.sort()).toEqual(MATCHING);
        // The search lives in the address (a-lists-filters-live-in-the-url).
        await expect.soft(page).toHaveURL(/[?&]q=a-01(&|$)/);

        // The contract, under the role's own token: the same search names exactly the two.
        const res = await send(page, "inventory.v1.RackService/RackList", {
          teamId: ground.searched[r.key],
          filter: { q: "a-01" },
          page: { page: 1, limit: 20 },
        });
        expect.soft(res.status).toBe(200);
        // The answer is the list's map shape: `ids` in order, the racks in `items[].rack.mapData`.
        expect.soft(((res.json.ids ?? []) as unknown[]).length).toBe(MATCHING.length);
        const racks = ((res.json.items ?? []) as { rack?: { mapData?: Record<string, { code?: string }> } }[]).flatMap(
          (i) => Object.values(i.rack?.mapData ?? {}),
        );
        const codes = racks.map((k) => k.code ?? "").sort();
        expect.soft(codes).toEqual(MATCHING);
      });

      await test.step("regression: the figures describe the searched list, and clearing the search lists every rack", async () => {
        // A search narrows the figures too (the-rack-list-leads-with-its-figures).
        await expect.soft(page.getByTestId("racks-stat-racks-value")).toHaveText("2");
        await page.getByTestId("rack-search").fill("");
        await expect.soft(rows).toHaveCount(ALL.length);
        await expect.soft(page.getByTestId("racks-stat-racks-value")).toHaveText("4");
      });
    });
  }
});

test.describe(`selling:all wants to see the racks (${C10})`, () => {
  for (const r of SELLING) {
    test(`${r.given} open racks (${C10})`, async ({ page }) => {
      await asRole(page, r.key, ground.seller);

      // WHEN — open racks: a selling team's menu offers none, so by the page's address.
      const listed = page.waitForResponse((res) => res.url().includes("/warehouse.inventory.v1.RackService/RackList"));
      await page.goto("/inventories/racks");
      const answer = await listed;

      await test.step("then: cannot see racks", async () => {
        // No Racks in the seller's menu — its Restock entry is there, so the menu has loaded.
        await expect.soft(restockLink(page)).toHaveCount(1);
        await expect.soft(racksLink(page)).toHaveCount(0);

        // The page: the refusal, and no rack.
        expect.soft(answer.status()).not.toBe(200);
        const refused = (await answer.json().catch(() => ({}))) as { code?: string };
        expect.soft(refused.code).toBe("permission_denied");
        await expect.soft(page.getByTestId("racks-error")).toBeVisible();
        // Under the refusal the list's frame may still draw — with no rack in it, and no figure of the warehouse's.
        await expect.soft(page.locator('[data-testid^="rack-row-"]')).toHaveCount(0);
        await expect.soft(page.getByTestId("racks-stat-stock-value")).not.toContainText(/\d/);
        await expect.soft(page.getByTestId("rack-row-b-10-1")).toHaveCount(0);

        // The contract, under the seller's own token, for the warehouse that holds its goods — refused, every read.
        for (const [method, body] of [
          ["RackList", { teamId: ground.sellerWarehouse, filter: { q: "" }, page: { page: 1, limit: 20 } }],
          ["RackStat", { teamId: ground.sellerWarehouse, filter: { q: "" } }],
          ["RackDetail", { teamId: ground.sellerWarehouse, rackId: ground.sellerRack }],
        ] as const) {
          const res = await send(page, `inventory.v1.RackService/${method}`, body);
          expect.soft(res.status, `${method} as ${r.given}`).not.toBe(200);
          expect.soft(res.json.code, `${method} as ${r.given}`).toBe("permission_denied");
          expect.soft(JSON.stringify(res.json), `${method} as ${r.given}`).not.toContain("b-10-1");
        }

        // That rack's own page, by its address: an error, never the rack.
        await page.goto(`/inventories/racks/${ground.sellerRack}`);
        await expect.soft(page.getByTestId("rack-detail-error")).toBeVisible();
        await expect.soft(page.getByTestId("rack-detail-page")).toHaveCount(0);
        await expect.soft(page.getByText("b-10-1")).toHaveCount(0);
      });
    });
  }
});

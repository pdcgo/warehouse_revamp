import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { pickTeam } from "./pickers";
import { API_URL } from "./env";

// warehouse:all wants to find a batch — the checks behind docs/acceptances/inventory/batch.md, section *batches*, when
// *open batches* (givens 1–4). One test per role the given names (warehouse owner · admin · staff), each signed in as a
// person of that role, opening Inventories › Batches from the menu.
//
//   1 (restock accepted today: 10 units at Rp 10.000 · expires 27 Nov)
//      then: batch listed with the restock it came from — the batch's row, and under its number *Restock #<id>*, a way to
//            that restock's page (a-batch-opens-where-it-came-from); BatchList under the role's own token names the
//            restock as the batch's delivery;
//      then: ready 10 · Rp 10.000 a pc · ready value Rp 100.000 — the row's Ready, Cost/pc and Ready value cells;
//      then: expires 27 Nov, with the days left — the Expiring cell's day and *N days left* under it
//            (an-expiry-says-how-long-is-left). The expiry is TODAY + 4 days in Jakarta: on the day the row was written
//            for (23 Nov) that is 27 Nov, and on any other run day the same distance, so the check does not rot.
//   2 (a batch with nothing left) — 3 units accepted, then all 3 adjusted away as lost (Stock Adjust on that batch)
//      then: "depleted" on its row — the row keeps its place with Ready 0 and the Depleted badge; given 1's batch, still
//            holding 10, carries none.
//   3 (2 batches expire within 30 days) — a warehouse of its own holding four batches: expiring in 10 and 25 days, in 60
//      days, and with no expiry
//      then: 2 batches counted as expiring within 30 days — the *Expiring ≤ 30 days* card reads 2 over a list of 4, and
//            BatchList under the role's token answers expiringSoonCount 2.
//   4 (its product on rack A and rack B) — 10 units accepted as 6 onto RAK-A and 4 onto RAK-B
//      then: both racks on its row — the Racks cell names rak-a and rak-b (codes are saved lowercase,
//            rack-codes-are-saved-lowercase); given 1's batch, on RAK-A alone, names only rak-a.
//
// When *filter batches* (givens 5–7), on the same list's filter strip:
//   5 (batches of 2 teams · team Melati) — warehouse M holds Melati's two batches and Kenanga's one
//      then: only Melati's batches — Melati picked in the team filter: her two rows, Kenanga's gone, the count and the
//            ready value narrowed with them, `?team=` in the address; BatchList with owner_team_id under the role's
//            token answers exactly her two (the-batch-list-filters-by-team).
//   6 (expiring soon) — warehouse X, given 3's four batches (10, 25, 60 days, none)
//      then: only batches expiring within 30 days — *Expiring soon* picked: the 10- and 25-day rows alone, count 2;
//            BatchList with expiry EXPIRING_SOON answers exactly those two.
//   7 (arrived 1–7 Nov) — warehouse M's three batches. A batch's arrival is stamped when its restock is accepted and no
//      call back-dates it, so the week is the run day's: the week ENDING today (picked on the calendar, Arrived) lists
//      all three, and the week before it lists none — the two edges of a week window. One window holding some batches
//      and not others is proven on the contract instead: Kenanga's restock is accepted 2.5 s after Melati's, and a
//      BatchList ARRIVED window ending at Melati's second + 1 answers her two and not Kenanga's.
//      then: only batches arrived that week.
//
// The ground (root, once): a selling team with an operational account; warehouse W (givens 1, 2, 4), warehouse X
// (givens 3, 6) and warehouse M (givens 5, 7, with selling teams Melati and Kenanga), each with a person of every
// warehouse role — so no other test's batch can stand in for these figures.

const PASSWORD = "e2e-batch-find-pass-1";
const WAREHOUSE = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
] as const;

// Each given's case text, verbatim from batch.md — the marking script finds the tests by it.
const C1 = "restock accepted today: 10 units at Rp 10.000 · expires 27 Nov";
const C2 = "a batch with nothing left";
const C3 = "2 batches expire within 30 days";
const C4 = "its product on rack A and rack B";
const C5 = "batches of 2 teams · team Melati";
const C6 = "expiring soon";
const C7 = "arrived 1–7 Nov";

// A username is lowercase letters and digits only.
const username = (key: string) => `e2ebfind${key}${SUFFIX}`;

// A Jakarta calendar day `days` from today, as the accept form sends it (yyyy-mm-dd).
const jakartaDay = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// How the list writes that day (formatUnixDateShort, English): "27 Nov", the year only when it is not this year's.
function shortDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${d} ${month}${String(y) === jakartaDay(0).slice(0, 4) ? "" : ` ${y}`}`;
}
// Days from today (Jakarta) to that day — what *N days left* counts.
const daysTo = (iso: string) => {
  const at = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return at(iso) - at(jakartaDay(0));
};

const G1_EXPIRES = jakartaDay(4);

type Batch = {
  id?: string;
  deliveryId?: string;
  ready?: string;
  unitCost?: number;
  readyValue?: number;
  expiresOnUnix?: string;
  createdAtUnix?: string;
  rackCodes?: string[];
};

const ground = {
  w: "",
  x: "",
  rackA: "",
  rackB: "",
  // Given 1: the restock and its batch; given 2's and given 4's batches; given 3's four.
  g1Restock: "",
  g1: "",
  g2: "",
  g4: "",
  g3: { soon10: "", soon25: "", later60: "", none: "" },
  // Givens 5 and 7: warehouse M, Melati's two batches and Kenanga's one, and the seconds they arrived.
  m: "",
  melati: { id: "", name: "", code: "", batches: [] as string[] },
  kenanga: { id: "", name: "", code: "", batches: [] as string[] },
  melatiArrivedFrom: 0,
  melatiArrivedTo: 0,
};

// A call that may be refused — the status and the answer, never a throw.
async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

// A BatchList answer's batches, in `ids` order (the list's map shape).
function batchesOf(json: Record<string, unknown>): Batch[] {
  const byId: Record<string, Batch> = {};
  for (const item of (json.items ?? []) as { batch?: { mapData?: Record<string, Batch> } }[]) {
    Object.assign(byId, item.batch?.mapData ?? {});
  }
  return ((json.ids ?? []) as string[]).map((id) => byId[String(id)] ?? { id: String(id) });
}

// Signed in as the role's person, working in `teamId`: the active team is per tab, in sessionStorage (TeamContext).
async function asRole(page: Page, key: string, teamId: string) {
  await login(page, username(key), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// WHEN — open batches: the menu's Inventories › Batches.
async function openBatches(page: Page) {
  await page.goto("/");
  const link = page.getByTestId("sidebar").locator('a[href="/inventories/batches"]');
  await expect(link).toHaveCount(1);
  if (!(await link.isVisible())) await page.getByTestId("nav-group-toggle-nav.inventories").click();
  await link.click();
  await expect(page).toHaveURL(/\/inventories\/batches$/);
  await expect(page.getByTestId("batches-table")).toBeVisible();
}

const row = (page: Page, id: string) => page.getByTestId(`batches-row-${id}`);
// The desktop row's cells: Batch · Product · Team · Arrived · Ready · Cost/pc · Ready value · Expiring · Racks.
const cell = (page: Page, id: string, n: number) => row(page, id).locator("td").nth(n);

// The BatchList the screen sends once a filter is set, waited for by the pieces its JSON body must carry — so a narrowed
// list is the server's answer to THAT filter, not the previous rows kept on screen while it refetches.
function listAsked(page: Page, pieces: string[]) {
  return page.waitForResponse(
    (r) =>
      r.url().endsWith("/warehouse.inventory.v1.InventoryService/BatchList") &&
      pieces.every((p) => (r.request().postData() ?? "").includes(p)),
  );
}

// A Jakarta day's first and last second (00:00:00 and 23:59:59 WIB) — the window the range picker sends for it.
const dayStartUnix = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 1000 - 7 * 3600;
};
const dayEndUnix = (iso: string) => dayStartUnix(iso) + 86_400 - 1;

// A window picked on the list's calendar (Arrived is the date it opens on): both days clicked, paging the month while a
// day is not drawn, then Apply.
async function pickRange(page: Page, from: string, to: string) {
  await page.getByTestId("batches-date-range").click();
  await expect(page.getByTestId("batches-date-range-panel")).toBeVisible();
  for (const day of [to, from]) {
    const cell = page.getByTestId(`batches-date-range-day-${day}`);
    for (const [step, times] of [
      ["prev", 2],
      ["next", 4],
    ] as const) {
      for (let i = 0; i < times && (await cell.count()) === 0; i++) {
        await page.getByTestId(`batches-date-range-${step}`).click();
      }
    }
    await cell.click();
  }
  await page.getByTestId("batches-date-range-apply").click();
}

// A BatchList answer's ids, sorted — to compare a filtered answer with the batches it must hold.
const idsOf = (json: Record<string, unknown>) => ((json.ids ?? []) as string[]).map(String).sort();

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  // The goods' owner: a selling team, a category, and the operational account its restocks are paid from.
  const seller = await team(`E2E Batch Cari Seller ${SUFFIX}`, `BFS${SUFFIX}`, "TEAM_TYPE_SELLING");
  const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Batch Cari ${SUFFIX}` })).category.id;
  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E batch cari restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-BFIND-${SUFFIX}`,
        openingBalance: 0,
        openingOn: jakartaDay(0),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: seller,
    accountId: account,
    operational: true,
  });

  ground.w = await team(`E2E Batch Cari Gudang W ${SUFFIX}`, `BFW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  ground.x = await team(`E2E Batch Cari Gudang X ${SUFFIX}`, `BFX${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  ground.m = await team(`E2E Batch Cari Gudang M ${SUFFIX}`, `BFM${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  for (const r of WAREHOUSE) {
    for (const [teamId, key] of [
      [ground.w, r.key],
      [ground.x, `x${r.key}`],
      [ground.m, `m${r.key}`],
    ] as const) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId,
        username: username(key),
        password: PASSWORD,
        name: `Batch Cari ${r.given} ${key} ${SUFFIX}`,
        role: r.role,
      });
    }
  }
  const rack = async (teamId: string, code: string) =>
    String((await api(page, "inventory.v1.RackService/RackCreate", { teamId, code })).rack.id);
  ground.rackA = await rack(ground.w, "RAK-A");
  ground.rackB = await rack(ground.w, "RAK-B");
  const rackX = await rack(ground.x, "RAK-X");

  // One restock of the seller's (or of `by`, another selling team) into `warehouseId`, one product per line, accepted in
  // full onto the given placements with the line's expiry. Returns the restock's id and each line's batch id.
  async function restock(
    warehouseId: string,
    lines: { tag: string; count: number; total: number; expiresOn: string; placements: { placementId: string; quantity: number }[] }[],
    by: { team: string; account: string } = { team: seller, account },
  ) {
    const items = [];
    for (const l of lines) {
      const p = (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: by.team,
          productCodePart: `BF${l.tag}${SUFFIX}`,
          name: `Barang Batch Cari ${l.tag} ${SUFFIX}`,
          categoryId: category,
        })
      ).product;
      items.push({ productId: String(p.id), productCode: String(p.productCode), name: `Barang Batch Cari ${l.tag} ${SUFFIX}`, count: l.count, total: l.total });
    }
    const raised = (
      await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: by.team,
        warehouseId,
        financeAccountId: by.account,
        items,
      })
    ).request;
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouseId,
      requestId: raised.id,
      lines: (raised.items as { id: string }[]).map((item, i) => ({
        itemId: item.id,
        receivedCount: lines[i]!.count,
        placements: lines[i]!.placements,
        expiresOn: lines[i]!.expiresOn,
      })),
    });
    const batches: string[] = [];
    for (const item of items) {
      const listed = await api(page, "inventory.v1.InventoryService/BatchList", {
        teamId: warehouseId,
        filter: { productId: item.productId },
        page: { page: 1, limit: 5 },
      });
      expect(listed.ids, `one batch of ${item.productCode}`).toHaveLength(1);
      batches.push(String(listed.ids[0]));
    }
    return { restockId: String(raised.id), batches, products: items.map((i) => i.productId) };
  }

  // GIVEN 1 — 10 units at Rp 10.000 (Rp 100.000), expiring in 4 days, onto RAK-A.
  const g1 = await restock(ground.w, [
    { tag: "1", count: 10, total: 100_000, expiresOn: G1_EXPIRES, placements: [{ placementId: ground.rackA, quantity: 10 }] },
  ]);
  ground.g1Restock = g1.restockId;
  ground.g1 = g1.batches[0]!;

  // GIVEN 2 — 3 units onto RAK-A, then all 3 adjusted away as lost from that batch: nothing left.
  const g2 = await restock(ground.w, [
    { tag: "2", count: 3, total: 30_000, expiresOn: "", placements: [{ placementId: ground.rackA, quantity: 3 }] },
  ]);
  ground.g2 = g2.batches[0]!;
  await api(page, "inventory.v1.InventoryService/StockAdjust", {
    warehouseId: ground.w,
    productId: g2.products[0],
    reasonType: "STOCK_ADJUST_REASON_LOST",
    batchId: ground.g2,
    quantity: 3,
    rackId: ground.rackA,
    reason: `habis untuk batch cari ${SUFFIX}`,
  });

  // GIVEN 4 — 10 units put away as 6 onto RAK-A and 4 onto RAK-B.
  const g4 = await restock(ground.w, [
    {
      tag: "4",
      count: 10,
      total: 50_000,
      expiresOn: "",
      placements: [
        { placementId: ground.rackA, quantity: 6 },
        { placementId: ground.rackB, quantity: 4 },
      ],
    },
  ]);
  ground.g4 = g4.batches[0]!;

  // GIVEN 3 — at X: two batches expiring within 30 days (10 and 25), one in 60 days, one with no expiry.
  const g3 = await restock(ground.x, [
    { tag: "3a", count: 2, total: 20_000, expiresOn: jakartaDay(10), placements: [{ placementId: rackX, quantity: 2 }] },
    { tag: "3b", count: 2, total: 20_000, expiresOn: jakartaDay(25), placements: [{ placementId: rackX, quantity: 2 }] },
    { tag: "3c", count: 2, total: 20_000, expiresOn: jakartaDay(60), placements: [{ placementId: rackX, quantity: 2 }] },
    { tag: "3d", count: 2, total: 20_000, expiresOn: "", placements: [{ placementId: rackX, quantity: 2 }] },
  ]);
  [ground.g3.soon10, ground.g3.soon25, ground.g3.later60, ground.g3.none] = g3.batches as [string, string, string, string];

  // GIVENS 5 and 7 — at M: two selling teams' goods. Melati's restock (2 units Rp 20.000 + 3 units Rp 30.000), then,
  // 2.5 s later so it arrives in a later second, Kenanga's (1 unit Rp 15.000).
  const accountOf = async (teamId: string, tag: string) => {
    const id = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E batch cari restock ${tag} ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-BFIND-${tag}-${SUFFIX}`,
          openingBalance: 0,
          openingOn: jakartaDay(0),
        })
      ).account.id,
    );
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId, accountId: id, operational: true });
    return id;
  };
  for (const [s, label, code] of [
    [ground.melati, "Melati", `BFL${SUFFIX}`],
    [ground.kenanga, "Kenanga", `BFK${SUFFIX}`],
  ] as const) {
    s.name = `E2E Batch Cari ${label} ${SUFFIX}`;
    s.code = code;
    s.id = await team(s.name, code, "TEAM_TYPE_SELLING");
  }
  const rackM = await rack(ground.m, "RAK-M");
  ground.melati.batches = (
    await restock(
      ground.m,
      [
        { tag: "5a", count: 2, total: 20_000, expiresOn: "", placements: [{ placementId: rackM, quantity: 2 }] },
        { tag: "5b", count: 3, total: 30_000, expiresOn: "", placements: [{ placementId: rackM, quantity: 3 }] },
      ],
      { team: ground.melati.id, account: await accountOf(ground.melati.id, "L") },
    )
  ).batches;
  const kenangaAccount = await accountOf(ground.kenanga.id, "K");
  await new Promise((r) => setTimeout(r, 2_500));
  ground.kenanga.batches = (
    await restock(
      ground.m,
      [{ tag: "5c", count: 1, total: 15_000, expiresOn: "", placements: [{ placementId: rackM, quantity: 1 }] }],
      { team: ground.kenanga.id, account: kenangaAccount },
    )
  ).batches;

  // The seconds M's batches arrived: Melati's two, then Kenanga's at least two seconds later — so a window ending at
  // Melati's last second + 1 (the server compares `<= to` on whole seconds) holds hers and not Kenanga's.
  const m = batchesOf(await api(page, "inventory.v1.InventoryService/BatchList", { teamId: ground.m, page: { page: 1, limit: 20 } }));
  const arrived = (id: string) => Number(m.find((b) => String(b.id) === id)?.createdAtUnix ?? 0);
  const melatiAt = ground.melati.batches.map(arrived);
  ground.melatiArrivedFrom = Math.min(...melatiAt);
  ground.melatiArrivedTo = Math.max(...melatiAt) + 1;
  expect(m, "M holds the three batches").toHaveLength(3);
  expect(Math.min(...melatiAt), "Melati's batches carry their arrival").toBeGreaterThan(0);
  expect(arrived(ground.kenanga.batches[0]!), "Kenanga's batch arrives after Melati's window").toBeGreaterThan(ground.melatiArrivedTo);

  // The ground holds: given 2's batch is empty, the others are not — so a badge below is the list's, not the seed's.
  const w = batchesOf(await api(page, "inventory.v1.InventoryService/BatchList", { teamId: ground.w, page: { page: 1, limit: 20 } }));
  const ready = (id: string) => String(w.find((b) => String(b.id) === id)?.ready ?? "0");
  expect([ready(ground.g1), ready(ground.g2), ready(ground.g4)]).toEqual(["10", "0", "10"]);

  await page.close();
});

test.describe(`warehouse:all wants to find a batch (${C1})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open batches (${C1})`, async ({ page }) => {
      await asRole(page, r.key, ground.w);
      await openBatches(page);
      const id = ground.g1;

      await test.step("then: batch listed with the restock it came from", async () => {
        await expect(row(page, id)).toBeVisible();
        await expect.soft(page.getByTestId(`batches-number-${id}`)).toHaveText(`#${id}`);
        const source = row(page, id).getByTestId(`batches-source-${id}`);
        await expect.soft(source).toHaveText(`Restock #${ground.g1Restock}`);

        // The contract, under the role's own token: the batch's delivery IS that restock.
        const res = await send(page, "inventory.v1.InventoryService/BatchList", {
          teamId: ground.w,
          filter: { search: "" },
          page: { page: 1, limit: 20 },
        });
        expect.soft(res.status).toBe(200);
        const b = batchesOf(res.json).find((x) => String(x.id) === id);
        expect.soft(String(b?.deliveryId ?? "")).toBe(ground.g1Restock);

        // It is a way there: the link opens that restock's page (and its click does not open the batch).
        await source.click();
        await expect.soft(page).toHaveURL(new RegExp(`/inventories/restock/${ground.g1Restock}$`));
        await page.goBack();
        await expect(row(page, id)).toBeVisible();
      });

      await test.step("then: ready 10 · Rp 10.000 a pc · ready value Rp 100.000", async () => {
        await expect.soft(page.getByTestId(`batches-ready-${id}`)).toHaveText("10");
        await expect.soft(cell(page, id, 5)).toHaveText("Rp 10.000");
        await expect.soft(cell(page, id, 6)).toHaveText("Rp 100.000");
        // The same figures under the role's own token.
        const res = await send(page, "inventory.v1.InventoryService/BatchList", {
          teamId: ground.w,
          filter: { search: "" },
          page: { page: 1, limit: 20 },
        });
        const b = batchesOf(res.json).find((x) => String(x.id) === id);
        expect.soft([String(b?.ready ?? "0"), Number(b?.unitCost ?? 0), Number(b?.readyValue ?? 0)]).toEqual(["10", 10_000, 100_000]);
      });

      await test.step("then: expires 27 Nov, with the days left", async () => {
        const left = daysTo(G1_EXPIRES);
        await expect.soft(page.getByTestId(`batches-expiry-${id}`)).toHaveText(shortDay(G1_EXPIRES));
        await expect.soft(page.getByTestId(`batches-expiry-${id}-left`)).toHaveText(`${left} day${left === 1 ? "" : "s"} left`);
        // Within 30 days, so it is drawn in the soon band (amber).
        await expect.soft(page.getByTestId(`batches-expiry-${id}-left`)).toHaveAttribute("data-band", "soon");
        // Both in the Expiring cell of the batch's own row.
        await expect.soft(cell(page, id, 7).getByTestId(`batches-expiry-${id}`)).toHaveCount(1);
      });
    });
  }
});

test.describe(`warehouse:all wants to find a batch (${C2})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open batches (${C2})`, async ({ page }) => {
      await asRole(page, r.key, ground.w);
      await openBatches(page);

      await test.step('then: "depleted" on its row', async () => {
        // The batch keeps its row, with nothing ready, marked depleted.
        await expect(row(page, ground.g2)).toBeVisible();
        await expect.soft(page.getByTestId(`batches-ready-${ground.g2}`)).toHaveText("0");
        const badge = row(page, ground.g2).getByTestId(`batches-depleted-${ground.g2}`);
        await expect.soft(badge).toBeVisible();
        await expect.soft(badge).toHaveText(/^depleted$/i);
        // Only the empty one: the batches still holding goods carry no badge.
        await expect.soft(page.getByTestId(`batches-depleted-${ground.g1}`)).toHaveCount(0);
        await expect.soft(page.getByTestId(`batches-depleted-${ground.g4}`)).toHaveCount(0);
        // Nothing left to find on a rack: its Racks cell is a dash.
        await expect.soft(page.getByTestId(`batches-racks-${ground.g2}`)).toHaveText("—");
      });
    });
  }
});

test.describe(`warehouse:all wants to find a batch (${C3})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open batches (${C3})`, async ({ page }) => {
      await asRole(page, `x${r.key}`, ground.x);
      await openBatches(page);
      const g = ground.g3;

      await test.step("then: 2 batches counted as expiring within 30 days", async () => {
        // Four batches listed — the count of 2 is out of these, not out of two.
        await expect.soft(page.getByTestId("batches-stat-count")).toHaveText("4");
        for (const id of Object.values(g)) await expect.soft(row(page, id)).toBeVisible();
        await expect.soft(page.getByTestId("batches-stat-expiring-card")).toContainText("Expiring ≤ 30 days");
        await expect.soft(page.getByTestId("batches-stat-expiring")).toHaveText("2");

        // Which two: the 10- and 25-day ones in the soon band; the 60-day one later; the undated one none.
        await expect.soft(page.getByTestId(`batches-expiry-${g.soon10}-left`)).toHaveAttribute("data-band", "soon");
        await expect.soft(page.getByTestId(`batches-expiry-${g.soon25}-left`)).toHaveAttribute("data-band", "soon");
        await expect.soft(page.getByTestId(`batches-expiry-${g.later60}-left`)).toHaveAttribute("data-band", "later");
        await expect.soft(page.getByTestId(`batches-expiry-${g.none}`)).toHaveText("—");

        // The contract, under the role's own token.
        const res = await send(page, "inventory.v1.InventoryService/BatchList", {
          teamId: ground.x,
          filter: { search: "" },
          page: { page: 1, limit: 20 },
        });
        expect.soft(res.status).toBe(200);
        expect.soft(String(res.json.expiringSoonCount ?? "0")).toBe("2");
      });
    });
  }
});

test.describe(`warehouse:all wants to find a batch (${C4})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} open batches (${C4})`, async ({ page }) => {
      await asRole(page, r.key, ground.w);
      await openBatches(page);

      await test.step("then: both racks on its row", async () => {
        const racks = row(page, ground.g4).getByTestId(`batches-racks-${ground.g4}`);
        await expect(racks).toBeVisible();
        await expect.soft(racks).toContainText("rak-a");
        await expect.soft(racks).toContainText("rak-b");
        // Every rack is named on its hover too, and no third one.
        const title = (await racks.getAttribute("title")) ?? "";
        expect.soft(title.split(", ").sort()).toEqual(["rak-a", "rak-b"]);
        // A batch whose product sits on RAK-A alone names only that one.
        await expect.soft(page.getByTestId(`batches-racks-${ground.g1}`)).toHaveText("rak-a");

        // The contract, under the role's own token: the batch's rack codes.
        const res = await send(page, "inventory.v1.InventoryService/BatchList", {
          teamId: ground.w,
          filter: { search: "" },
          page: { page: 1, limit: 20 },
        });
        const b = batchesOf(res.json).find((x) => String(x.id) === ground.g4);
        expect.soft([...(b?.rackCodes ?? [])].sort()).toEqual(["rak-a", "rak-b"]);
      });
    });
  }
});

test.describe(`warehouse:all wants to find a batch (${C5})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} filter batches (${C5})`, async ({ page }) => {
      await asRole(page, `m${r.key}`, ground.m);
      await openBatches(page);
      const melati = ground.melati.batches;
      const kenanga = ground.kenanga.batches[0]!;

      // Before the filter: both teams' goods, three batches.
      await expect(page.getByTestId("batches-stat-count")).toHaveText("3");
      for (const id of [...melati, kenanga]) await expect(row(page, id)).toBeVisible();

      await test.step("then: only Melati's batches", async () => {
        const asked = listAsked(page, [`"ownerTeamId":"${ground.melati.id}"`]);
        await pickTeam(page, page.getByTestId("batches-team-filter"), ground.melati.code);
        expect((await asked).status()).toBe(200);
        await expect(page).toHaveURL(new RegExp(`[?&]team=${ground.melati.id}(&|$)`));
        await expect.soft(row(page, kenanga)).toHaveCount(0);
        for (const id of melati) {
          await expect.soft(row(page, id)).toBeVisible();
          await expect.soft(page.getByTestId(`batches-team-${id}`)).toContainText(ground.melati.name);
        }
        // The count and the ready value narrow with the rows: 2 batches, Rp 20.000 + Rp 30.000.
        await expect.soft(page.getByTestId("batches-stat-count")).toHaveText("2");
        await expect.soft(page.getByTestId("batches-stat-value")).toContainText("50.000");

        // The contract, under the role's own token: Melati's two, and not Kenanga's.
        const res = await send(page, "inventory.v1.InventoryService/BatchList", {
          teamId: ground.m,
          filter: { ownerTeamId: ground.melati.id },
          page: { page: 1, limit: 20 },
        });
        expect.soft(res.status).toBe(200);
        expect.soft(idsOf(res.json)).toEqual([...melati].sort());
      });
    });
  }
});

test.describe(`warehouse:all wants to find a batch (${C6})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} filter batches (${C6})`, async ({ page }) => {
      await asRole(page, `x${r.key}`, ground.x);
      await openBatches(page);
      const g = ground.g3;

      // Before the filter: X's four batches — 10, 25 and 60 days, and one with no expiry.
      await expect(page.getByTestId("batches-stat-count")).toHaveText("4");

      await test.step("then: only batches expiring within 30 days", async () => {
        const asked = listAsked(page, ['"expiry":"BATCH_EXPIRY_FILTER_EXPIRING_SOON"']);
        await page.getByTestId("batches-expiry-trigger").click();
        await page.getByTestId("batches-expiry-option-1").click();
        expect((await asked).status()).toBe(200);
        await expect(page).toHaveURL(/[?&]expiry=1(&|$)/);
        await expect.soft(page.getByTestId("batches-stat-count")).toHaveText("2");
        // The 10- and 25-day batches, each drawn in the soon band; the 60-day one and the undated one gone.
        for (const id of [g.soon10, g.soon25]) {
          await expect.soft(row(page, id)).toBeVisible();
          await expect.soft(page.getByTestId(`batches-expiry-${id}-left`)).toHaveAttribute("data-band", "soon");
        }
        for (const id of [g.later60, g.none]) await expect.soft(row(page, id)).toHaveCount(0);

        // The contract, under the role's own token: exactly those two.
        const res = await send(page, "inventory.v1.InventoryService/BatchList", {
          teamId: ground.x,
          filter: { expiry: "BATCH_EXPIRY_FILTER_EXPIRING_SOON" },
          page: { page: 1, limit: 20 },
        });
        expect.soft(res.status).toBe(200);
        expect.soft(idsOf(res.json)).toEqual([g.soon10, g.soon25].sort());
      });
    });
  }
});

test.describe(`warehouse:all wants to find a batch (${C7})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} filter batches (${C7})`, async ({ page }) => {
      await asRole(page, `m${r.key}`, ground.m);
      await openBatches(page);
      const all = [...ground.melati.batches, ...ground.kenanga.batches];
      await expect(page.getByTestId("batches-stat-count")).toHaveText("3");

      await test.step("then: only batches arrived that week", async () => {
        // The week ENDING today (Jakarta), on the Arrived date: every batch that arrived in it — M's three, all accepted
        // today (no call back-dates an arrival, so the given's 1–7 Nov is the run day's week).
        const [from, to] = [jakartaDay(-6), jakartaDay(0)];
        const arrivedIn = (f: string, t: string) => [
          '"dateField":"BATCH_DATE_FIELD_ARRIVED"',
          `"fromUnix":"${dayStartUnix(f)}"`,
          `"toUnix":"${dayEndUnix(t)}"`,
        ];
        let asked = listAsked(page, arrivedIn(from, to));
        await pickRange(page, from, to);
        expect((await asked).status()).toBe(200);
        await expect(page).toHaveURL(new RegExp(`[?&]range=${from}\\.\\.${to}(&|$)`));
        await expect.soft(page.getByTestId("batches-date-range-field-label")).toContainText("Arrived");
        await expect.soft(page.getByTestId("batches-stat-count")).toHaveText("3");
        for (const id of all) await expect.soft(row(page, id)).toBeVisible();

        // The week before it: none of them arrived then — no rows, a count of 0.
        const [before, beforeEnd] = [jakartaDay(-13), jakartaDay(-7)];
        asked = listAsked(page, arrivedIn(before, beforeEnd));
        await pickRange(page, before, beforeEnd);
        expect((await asked).status()).toBe(200);
        await expect(page).toHaveURL(new RegExp(`[?&]range=${before}\\.\\.${beforeEnd}(&|$)`));
        await expect.soft(page.getByTestId("batches-stat-count")).toHaveText("0");
        await expect.soft(page.getByTestId("batches-empty")).toBeVisible();
        for (const id of all) await expect.soft(row(page, id)).toHaveCount(0);

        // One window holding some batches and not others, on the contract under the role's own token: the window
        // around Melati's arrival holds her two, and not Kenanga's, which arrived seconds later.
        const res = await send(page, "inventory.v1.InventoryService/BatchList", {
          teamId: ground.m,
          filter: {
            dateField: "BATCH_DATE_FIELD_ARRIVED",
            fromUnix: String(ground.melatiArrivedFrom),
            toUnix: String(ground.melatiArrivedTo),
          },
          page: { page: 1, limit: 20 },
        });
        expect.soft(res.status).toBe(200);
        expect.soft(idsOf(res.json)).toEqual([...ground.melati.batches].sort());
      });
    });
  }
});

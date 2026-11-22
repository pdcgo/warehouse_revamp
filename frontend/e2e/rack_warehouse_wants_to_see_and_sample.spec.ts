import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";

// warehouse:all wants to see what is on a rack, and to give a sample — the checks behind
// docs/acceptances/inventory/placement.md, section *rack*: givens 11 and 12 (when *open rack*) and 17 (when *record
// sample*). One test per role of each given — warehouse:owner, warehouse:admin, warehouse:staff — each signed in as a
// person of that role in the warehouse, on a rack and products of its own, so no figure is moved by another test.
//
//   11 (2 products · 5 and 3 units) → open rack
//      then: each product with its units and value — the rack page's shelf: Kaos 5 × Rp 10.000 = Rp 50.000, Topi
//      3 × Rp 20.000 = Rp 60.000, on the screen and on RackStock under the role's own token. A warehouse reads the value
//      since #109 (a-warehouse-sees-ready-value-but-a-shelf-only-units, its 🔄 2026-11-20 line — this given is the
//      owner's later word that ended the shelf-in-units reading).
//   12 (a restock accepted onto it · 1 move · 1 sample) → open rack
//      then: each shown in its history with the change and what is on the shelf after — the rack page's Riwayat: Received
//      +10 → 10, Moved −3 → 7, Sample −1 → 6, each row's What, Change and On shelf after (and RackHistory's own figures).
//   17 (rack A: 5 units · 1 to Pak Budi) → record sample, through the rack page's own dialog (rack-action-sample →
//      record-sample-dialog), 1 unit given to Pak Budi
//      then: rack A 4 — the shelf's line on the page, and RackStock;
//      then: ready stock down by 1 — the product's READY units in this warehouse, read by the role before and after:
//            ProductStockSummary's `readyQty` (the warehouse product page's Ready read) and the warehouse's own Products
//            list (`stock-onhand-<code>`, its units on hand here), 5 → 4;
//      then: sample in the rack's history with who received it — the Sample row, −1 → 4, its own line *given to Pak Budi*
//            (#108: StockMovement.recipient, a-sample-keeps-its-recipient; test id rack-history-row-<id>-recipient).
//
// The ground (root, once): a selling team that owns the goods and a warehouse, both root's; per role a person, four
// racks (11, 12, 12's move target, 17 "A") and four products, ONE restock per role accepted onto those racks
// (Kaos 5 + Topi 3 → rack 11, Celana 10 → rack 12, Sampel 5 → rack A), then on rack 12 a move of 3 to its neighbour and
// a sample of 1 to Bu Rina, both by root. The goods' prices are the restock's: what a unit cost this warehouse.

const PASSWORD = "e2e-rack-acc-pass-1";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
] as const;
type Key = (typeof ROLES)[number]["key"];

// Each given's case text, verbatim from placement.md — the marking script finds the tests by it.
const C11 = "2 products · 5 and 3 units";
const C12 = "a restock accepted onto it · 1 move · 1 sample";
const C17 = "rack A: 5 units · 1 to Pak Budi";

const RECIPIENT = "Pak Budi";
const SEEDED_RECIPIENT = "Bu Rina";

// A username is lowercase letters and digits only.
const username = (key: Key) => `e2erkacc${key}${SUFFIX}`;
const displayName = (given: string) => `Rak ${given} ${SUFFIX}`;
const rackCode = (n: string, key: Key) => `rk${n}-${key}-${SUFFIX}`;
// The four products of a role: P and Q on rack 11, H on rack 12, S on rack A.
const LINES = {
  P: { name: "Kaos Rak", count: 5, total: 50_000 },
  Q: { name: "Topi Rak", count: 3, total: 60_000 },
  H: { name: "Celana Rak", count: 10, total: 50_000 },
  S: { name: "Sampel Rak", count: 5, total: 40_000 },
} as const;
type Line = keyof typeof LINES;
const productCode = (line: Line, key: Key) => `RK${line}${key.toUpperCase()}${SUFFIX}`;
const productName = (line: Line, key: Key) => `${LINES[line].name} ${key} ${SUFFIX}`;

interface Ground {
  user: string;
  racks: { r11: string; r12: string; r12to: string; rA: string };
  products: Record<Line, { id: string; code: string }>;
}

const ground = { warehouse: "", seller: "", account: "", roles: {} as Record<Key, Ground> };

interface Movement {
  id: string;
  productId: string;
  delta?: string;
  balance?: string;
  kind: string;
  actorUserId?: string;
  recipient?: string;
}

interface ShelfLine {
  productId: string;
  onHand?: string;
  unitCost?: number;
  costKnown?: boolean;
  value?: number;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function asRole(page: Page, key: Key) {
  await login(page, username(key), PASSWORD);
  await useTeam(page, ground.warehouse);
}

// The shelf, as the server answers the signed-in person: product id → its line.
async function rackStock(page: Page, rackId: string): Promise<Record<string, ShelfLine>> {
  const res = await api(page, "inventory.v1.RackService/RackStock", {
    teamId: ground.warehouse,
    filter: { rackId },
    dataRequest: ["RACK_STOCK_DATA_TYPE_RACK_STOCK"],
    page: { page: 1, limit: 20 },
  });
  return Object.assign({}, ...(res.items ?? []).map((it: { rackStock?: { mapData: object } }) => it.rackStock?.mapData ?? {}));
}

// The rack's history, as the server answers the signed-in person — in its order.
async function rackHistory(page: Page, rackId: string): Promise<Movement[]> {
  const res = await api(page, "inventory.v1.RackService/RackHistory", {
    teamId: ground.warehouse,
    filter: { rackId },
    dataRequest: ["RACK_HISTORY_DATA_TYPE_MOVEMENT"],
    page: { page: 1, limit: 20 },
  });
  const byId: Record<string, Movement> = Object.assign(
    {},
    ...(res.items ?? []).map((it: { movement?: { mapData: object } }) => it.movement?.mapData ?? {}),
  );
  return ((res.ids ?? []) as string[]).map((id) => byId[id]!).filter(Boolean);
}

// The product's READY units in this warehouse — ProductStockSummary, the warehouse product page's Ready read.
async function readyOf(page: Page, productId: string): Promise<number> {
  const res = await api(page, "inventory.v1.InventoryService/ProductStockSummary", { teamId: ground.warehouse, productId });
  return Number(res.readyQty ?? 0);
}

// The product's units on hand here, as the warehouse's own Products list shows them.
async function listedOnHand(page: Page, code: string) {
  await page.goto(`/products?q=${code}`);
  return page.getByTestId(`stock-onhand-${code}`);
}

// One history row's cells on a desktop: When · What · Product · By · Change · On shelf after.
const cellsOf = (page: Page, movementId: string) => page.getByTestId(`rack-history-row-${movementId}`).getByRole("cell");

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.seller = await team(`E2E Rak Acc Seller ${SUFFIX}`, `RKS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Rak Acc Gudang ${SUFFIX}`, `RKW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Rak Acc ${SUFFIX}` });

  ground.account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E rak acc restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-RKA-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  // A restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account).
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: ground.account,
    operational: true,
  });

  for (const r of ROLES) {
    const user = String(
      (
        await api(page, "user.v1.UserService/CreateUser", {
          teamId: ground.warehouse,
          username: username(r.key),
          password: PASSWORD,
          name: displayName(r.given),
          role: r.role,
        })
      ).user.id,
    );

    const rack = async (n: string) =>
      String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: rackCode(n, r.key) })).rack.id);
    const racks = { r11: await rack("11"), r12: await rack("12"), r12to: await rack("12to"), rA: await rack("17a") };

    const products = {} as Ground["products"];
    for (const line of Object.keys(LINES) as Line[]) {
      const created = await api(page, "product.v1.ProductService/ProductCreate", {
        teamId: ground.seller,
        productCodePart: productCode(line, r.key),
        name: productName(line, r.key),
        categoryId: category.category.id,
      });
      products[line] = { id: String(created.product.id), code: String(created.product.productCode) };
    }
    ground.roles[r.key] = { user, racks, products };

    // GIVEN — one restock, accepted onto the role's racks: Kaos 5 + Topi 3 on rack 11, Celana 10 on rack 12, Sampel 5 on
    // rack A.
    const lines = Object.keys(LINES) as Line[];
    const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
      financeAccountId: ground.account,
      items: lines.map((line) => ({
        productId: products[line].id,
        productCode: products[line].code,
        name: productName(line, r.key),
        count: LINES[line].count,
        total: LINES[line].total,
      })),
    });
    const onRack: Record<Line, string> = { P: racks.r11, Q: racks.r11, H: racks.r12, S: racks.rA };
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouse,
      requestId: restock.request.id,
      lines: (restock.request.items as { id: string; productId: string }[]).map((item) => {
        const line = lines.find((l) => products[l].id === String(item.productId))!;
        return {
          itemId: item.id,
          receivedCount: LINES[line].count,
          placements: [{ placementId: onRack[line], quantity: LINES[line].count }],
        };
      }),
    });

    // GIVEN (12) — on rack 12, after the restock: 3 moved to its neighbour, then 1 given to Bu Rina.
    await api(page, "inventory.v1.RackService/RackMove", {
      teamId: ground.warehouse,
      fromRackId: racks.r12,
      lines: [{ productId: products.H.id, quantity: 3, toRackId: racks.r12to }],
    });
    await api(page, "inventory.v1.RackService/RackSample", {
      teamId: ground.warehouse,
      rackId: racks.r12,
      lines: [{ productId: products.H.id, quantity: 1 }],
      recipient: SEEDED_RECIPIENT,
      description: `seeded sample ${SUFFIX}`,
    });
  }

  await page.close();
});

test.describe(`warehouse:all wants to see what is on a rack (${C11})`, () => {
  for (const r of ROLES) {
    test(`${r.given} open rack (${C11})`, async ({ page }) => {
      const g = () => ground.roles[r.key];
      await asRole(page, r.key);

      // WHEN — open rack.
      await page.goto(`/inventories/racks/${g().racks.r11}`);
      await expect(page.getByTestId("rack-detail-page")).toBeVisible();

      const want = [
        { line: "P" as Line, units: "5", price: 10_000, value: 50_000, priceText: "Rp 10.000", valueText: "Rp 50.000" },
        { line: "Q" as Line, units: "3", price: 20_000, value: 60_000, priceText: "Rp 20.000", valueText: "Rp 60.000" },
      ];

      await test.step("then: each product with its units and value", async () => {
        // The screen: each product's row — its name, its units on this rack, its unit price and its value.
        for (const w of want) {
          const id = g().products[w.line].id;
          const row = page.getByTestId(`rack-stock-row-${id}`);
          await expect.soft(row).toContainText(productName(w.line, r.key));
          await expect.soft(row.getByTestId(`rack-stock-onhand-${id}`)).toHaveText(w.units);
          await expect.soft(row.getByTestId(`rack-unit-cost-${id}`)).toHaveText(w.priceText);
          await expect.soft(row.getByTestId(`rack-line-value-${id}`)).toHaveText(w.valueText);
        }
        await expect.soft(page.getByTestId("rack-detail-stock").locator('[data-testid^="rack-stock-row-"]')).toHaveCount(2);

        // The contract, under the role's own token: the same two lines, priced.
        const shelf = await rackStock(page, g().racks.r11);
        expect.soft(Object.keys(shelf).sort()).toEqual(want.map((w) => g().products[w.line].id).sort());
        for (const w of want) {
          expect.soft(shelf[g().products[w.line].id]).toMatchObject({
            onHand: w.units,
            unitCost: w.price,
            costKnown: true,
            value: w.value,
          });
        }
      });

      await test.step("regression: the tile sums the shelf — 8 units, Rp 110.000, every cost known", async () => {
        await expect.soft(page.getByTestId("rack-summary-count")).toContainText("8");
        await expect.soft(page.getByTestId("rack-summary-value")).toHaveText("Rp 110.000");
        await expect.soft(page.getByTestId("rack-summary-unknown-cost")).toHaveCount(0);
      });
    });
  }
});

test.describe(`warehouse:all wants to see what is on a rack (${C12})`, () => {
  for (const r of ROLES) {
    test(`${r.given} open rack (${C12})`, async ({ page }) => {
      const g = () => ground.roles[r.key];
      await asRole(page, r.key);

      // WHEN — open rack.
      await page.goto(`/inventories/racks/${g().racks.r12}`);
      await expect(page.getByTestId("rack-history-table")).toBeVisible();

      // Oldest first: the restock put 10 on the shelf, the move took 3 off, the sample 1.
      const want = [
        { kind: "MOVEMENT_KIND_RECEIVE", word: "Received", delta: "10", change: "+10", after: "10" },
        { kind: "MOVEMENT_KIND_MOVE", word: "Moved", delta: "-3", change: "-3", after: "7" },
        { kind: "MOVEMENT_KIND_SAMPLE", word: "Sample", delta: "-1", change: "-1", after: "6" },
      ];

      await test.step("then: each shown in its history with the change and what is on the shelf after", async () => {
        // The ledger, under the role's own token: exactly the three, each with its change and the shelf after it.
        const rows = await rackHistory(page, g().racks.r12);
        expect.soft(rows.map((m) => m.kind).sort()).toEqual(want.map((w) => w.kind).sort());

        // The screen: each row — what happened, to which product, the change, and what is on the shelf after.
        await expect.soft(page.getByTestId("rack-history-table").getByRole("columnheader")).toHaveText([
          "When",
          "What",
          "Product",
          "By",
          "Change",
          "On shelf after",
        ]);
        for (const w of want) {
          const m = rows.find((x) => x.kind === w.kind);
          expect.soft(m, `${w.word} row on the rack's history`).toBeDefined();
          if (!m) continue;
          expect.soft(m.delta, `${w.word}: change`).toBe(w.delta);
          expect.soft(m.balance, `${w.word}: on the shelf after`).toBe(w.after);

          const cells = cellsOf(page, m.id);
          await expect.soft(cells.nth(1)).toContainText(w.word);
          await expect.soft(cells.nth(2)).toHaveText(productName("H", r.key));
          await expect.soft(cells.nth(4)).toHaveText(w.change);
          await expect.soft(cells.nth(5)).toHaveText(w.after);
        }
      });

      await test.step("regression: the sample's row names who received it — given to Bu Rina (#108)", async () => {
        const sample = (await rackHistory(page, g().racks.r12)).find((m) => m.kind === "MOVEMENT_KIND_SAMPLE");
        expect.soft(sample?.recipient).toBe(SEEDED_RECIPIENT);
        await expect.soft(page.getByTestId(`rack-history-row-${sample?.id}-recipient`)).toHaveText(`given to ${SEEDED_RECIPIENT}`);
      });
    });
  }
});

test.describe(`warehouse:all wants to give a sample (${C17})`, () => {
  for (const r of ROLES) {
    test(`${r.given} record sample (${C17})`, async ({ page }) => {
      const g = () => ground.roles[r.key];
      const S = () => g().products.S;
      await asRole(page, r.key);

      // BEFORE — the product's ready units here, 5, read as the role: the server's and the Products list's.
      expect(await readyOf(page, S().id)).toBe(5);
      await expect(await listedOnHand(page, S().code)).toHaveText("5");

      // WHEN — record sample, through the rack page's own dialog: 1 unit, given to Pak Budi.
      await page.goto(`/inventories/racks/${g().racks.rA}`);
      await expect(page.getByTestId(`rack-stock-onhand-${S().id}`)).toHaveText("5");
      await page.getByTestId("rack-action-sample").click();
      const dialog = page.getByTestId("record-sample-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByTestId(`sample-qty-${S().id}`).fill("1");
      await dialog.getByTestId("sample-recipient").fill(RECIPIENT);
      await dialog.getByTestId("sample-note").fill(`for the product photos ${SUFFIX}`);
      await expect(dialog.getByTestId("sample-summary")).toHaveText("1 units of 1 product(s)");
      await dialog.getByTestId("sample-submit").click();
      await expect(dialog).toBeHidden();

      await test.step("then: rack A 4", async () => {
        await expect.soft(page.getByTestId(`rack-stock-onhand-${S().id}`)).toHaveText("4");
        expect.soft((await rackStock(page, g().racks.rA))[S().id]?.onHand).toBe("4");
      });

      await test.step("then: sample in the rack's history with who received it", async () => {
        const samples = (await rackHistory(page, g().racks.rA)).filter((m) => m.kind === "MOVEMENT_KIND_SAMPLE");
        expect.soft(samples).toHaveLength(1);
        const m = samples[0];
        expect.soft(m?.recipient).toBe(RECIPIENT);
        expect.soft(m?.delta).toBe("-1");
        expect.soft(m?.balance).toBe("4");
        expect.soft(m?.actorUserId).toBe(g().user);

        const cells = cellsOf(page, String(m?.id));
        await expect.soft(cells.nth(1)).toContainText("Sample");
        await expect.soft(page.getByTestId(`rack-history-row-${m?.id}-recipient`)).toHaveText(`given to ${RECIPIENT}`);
        await expect.soft(cells.nth(4)).toHaveText("-1");
        await expect.soft(cells.nth(5)).toHaveText("4");
      });

      await test.step("regression: the sample's row names who recorded it", async () => {
        const m = (await rackHistory(page, g().racks.rA)).find((x) => x.kind === "MOVEMENT_KIND_SAMPLE");
        await expect.soft(cellsOf(page, String(m?.id)).nth(3)).toContainText(displayName(r.given));
      });

      if (r.key === "stf") {
        await test.step("regression: on a phone the sample's block says given to Pak Budi on its own line (#108)", async () => {
          const m = (await rackHistory(page, g().racks.rA)).find((x) => x.kind === "MOVEMENT_KIND_SAMPLE");
          await page.setViewportSize({ width: 390, height: 844 });
          const block = page.getByTestId(`rack-history-row-${m?.id}`);
          await expect.soft(block).toContainText("Sample");
          await expect.soft(block.getByTestId(`rack-history-row-${m?.id}-recipient`)).toHaveText(`given to ${RECIPIENT}`);
          await expect.soft(block).toContainText("On shelf after 4");
          await page.setViewportSize({ width: 1280, height: 720 });
        });
      }

      await test.step("then: ready stock down by 1", async () => {
        await expect.poll(() => readyOf(page, S().id)).toBe(4);
        await expect.soft(await listedOnHand(page, S().code)).toHaveText("4");
      });
    });
  }
});

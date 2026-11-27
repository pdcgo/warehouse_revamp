import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { addMetric, asRoot, rupiah, signInAs, today } from "./metric_ground";

// ── add analytic metric, Restock before the accept — the checks behind docs/acceptances/analytic/inventory_metric.md givens 9–15 ──
//
// add analytic metric's checks for RESTOCK's figures before the accept on Analytic › Inventory (metrics/inventory/restock,
// #85). An acceptance has no test file of its own (docs/acceptances/guide.md): one test.describe per given + when (named
// as the given, its case in parentheses verbatim), per role a test — selling:all = owner, admin, cs; warehouse:all =
// owner, admin, staff — and one test.step("then: …") per then, stored VERBATIM below (acceptance_mark.py matches the
// literal text). A step that is no then is named `regression: …`.
//
// Business rules (docs/business/analytic/rpc_provide_decision.md):
// - the-restock-before-the-accept-prototype-is-accepted — Units / Value ordered on the create day, an edit's difference
//   on the edit day, a cancel taking it back on the cancel day; Units / Value lost on the way on the lost day, taken
//   back on the day a lost box is signed for as arrived; Courier COD on the accept day, Terima's final figure. The value
//   ordered is the restock's total (goods + the shipping its team paid — none here); a warehouse reads the units and the
//   COD it paid, never a value (a-warehouse-reads-the-newest-counts-as-accepted).
// - every-member-reads-every-metric-of-their-team — a CS reads its team's restock figures.
//
// GROUND (beforeAll, as root, through the API from the test runner): one selling team with a user per selling role, one
// warehouse with a user per warehouse role and a rack, one operational account. Every restock is 10 units of a product
// of its own for Rp 100.000 (Rp 10.000 a unit, no shipping), raised today to that warehouse — so a product filter reads
// exactly that restock.
// - a STATE given (created · COD accepted · marked lost) is one restock, seeded to its state in beforeAll and read by
//   every role it names;
// - a CHANGE given (2 removed · cancelled · a lost box arriving) cannot be read as its own row on a daily table — the
//   create is on the same day, so today's row is the NET of the two. Each role gets a restock of its own: today's row is
//   read BEFORE the change (as the role), root makes the change, and the then reads how far today's row moved — the
//   change, with its value.
//
// THE WHEN, as the person does it: Analytic grouped daily over the last 7 days, filtered to the restock's product
// (`?g=daily&r=7d&product=<id>`), Add Metric › Inventory › Restock, Done; the then reads today's row. (A before-reading
// opens the same table by its address.) The restock figures are written in the restock's own transaction, but a read is
// still re-loaded until it lands.

const DIGITS = Date.now().toString().slice(-6);
const SUFFIX = `${DIGITS}r`;
const PASSWORD = "e2e-restock-metric-pass-1";
const RESTOCK = "metrics/inventory/restock";
const UNITS = 10;
const TOTAL = 100_000;
const PER_UNIT = TOTAL / UNITS;
const COD = 15_000;

const SELLING = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "scs", side: "selling" },
] as const;
const WAREHOUSE = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "wstf", side: "warehouse" },
] as const;
type Role = (typeof SELLING)[number] | (typeof WAREHOUSE)[number];

// The givens' cases, VERBATIM (· is U+00B7), and their thens (− is U+2212, as the file writes it).
const G9 = { id: 9, case: "group: daily · add type: restock · restock of 10 units created today", then: "then: ordered 10 with its value" };
const G10 = { id: 10, case: "group: daily · add type: restock · 2 units removed from a restock today", then: "then: ordered −2 with its value" };
const G11 = { id: 11, case: "group: daily · add type: restock · restock with COD Rp 15.000 accepted today", then: "then: COD Rp 15.000" };
const G12 = { id: 12, case: "group: daily · add type: restock · restock of 10 units marked lost today", then: "then: lost 10 with its value" };
const G13 = { id: 13, case: "group: daily · add type: restock · restock of 10 units cancelled today", then: "then: ordered −10 with its value" };
const G14 = { id: 14, case: "group: daily · add type: restock · lost restock of 10 units arrives today", then: "then: lost −10 with its value" };
const G15 = { id: 15, case: "group: daily · add type: restock · restock of 10 units created today", then: "then: ordered 10, value not shown" };

const username = (key: string) => `e2eur${key}${SUFFIX}`;

type Raised = { id: string; itemId: string; product: string; productCode: string; name: string };

const ground = {
  team: "",
  warehouse: "",
  rack: "",
  account: "",
  category: "",
  // `<given>` (a state given) or `<given>-<role key>` (a change given) → its restock
  restocks: {} as Record<string, Raised>,
};

// A product of its own and its restock of 10 units for Rp 100.000, raised today.
async function raise(tag: string): Promise<Raised> {
  const name = `Sabun Restok ${tag} ${SUFFIX}`;
  const product = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: `UR${tag.replace(/-/g, "").toUpperCase()}${DIGITS}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  const made = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
    financeAccountId: ground.account,
    items: [{ productId: product.id, productCode: product.productCode, name, count: UNITS, total: TOTAL }],
  });

  return {
    id: String(made.request.id),
    itemId: String(made.request.items[0].id),
    product: String(product.id),
    productCode: String(product.productCode),
    name,
  };
}

async function markLost(r: Raised, tag: string) {
  await asRoot("inventory.v1.RestockRequestService/RestockRequestMarkLost", {
    teamId: ground.team,
    requestId: r.id,
    description: `kurir tidak bisa melacak paket ${tag} ${SUFFIX}`,
  });
}

async function seed() {
  const team = async (name: string, teamCode: string, type: string) =>
    String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Restock Metric Seller ${SUFFIX}`, `URS${DIGITS}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Restock Metric WH ${SUFFIX}`, `URW${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  for (const r of [...SELLING, ...WAREHOUSE]) {
    await asRoot("user.v1.UserService/CreateUser", {
      teamId: r.side === "selling" ? ground.team : ground.warehouse,
      username: username(r.key),
      password: PASSWORD,
      name: `Restock Metric ${r.key} ${SUFFIX}`,
      role: r.role,
    });
  }
  ground.rack = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `ur-${DIGITS}` })).rack.id);
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Restock Metric ${SUFFIX}` })).category.id);
  ground.account = String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E restock metric ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-UR-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: today(),
      })
    ).account.id,
  );
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.team,
    accountId: ground.account,
    operational: true,
  });

  // STATE givens — one restock each, seeded to its state.
  ground.restocks["9"] = await raise("9");
  const cod = (ground.restocks["11"] = await raise("11"));
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: cod.id,
    warehouseAdditionalCost: COD,
    warehouseAdditionalCostNote: `courier asked at the door ${SUFFIX}`,
    lines: [{ itemId: cod.itemId, receivedCount: UNITS, placements: [{ placementId: ground.rack, quantity: UNITS }] }],
  });
  const lost = (ground.restocks["12"] = await raise("12"));
  await markLost(lost, "12");

  // CHANGE givens — one restock per role; the change itself is made in the role's test. A lost box that arrives is
  // marked lost here.
  for (const r of SELLING) {
    ground.restocks[`10-${r.key}`] = await raise(`10-${r.key}`);
    ground.restocks[`13-${r.key}`] = await raise(`13-${r.key}`);
    const box = (ground.restocks[`14-${r.key}`] = await raise(`14-${r.key}`));
    await markLost(box, `14-${r.key}`);
  }
}

const tableOf = (product: string) => `/analytic?g=daily&m=${RESTOCK}&r=7d&product=${product}`;

// Today's row, as the page draws it: a figure, or null when the row (or the cell) is not there — a key whose figures
// net to nothing is no row at all.
async function read(page: Page, field: string): Promise<string | null> {
  const cell = page.getByTestId(`analytic-cell-${today()}-${field}`);
  if ((await cell.count()) === 0) return null;

  return (await cell.textContent())?.trim() ?? null;
}

// The table by its address, re-read until the headline has answered (it reads "—" until then) and `field`'s headline
// reads `whole` — so the row below is the answer's.
async function openTable(page: Page, product: string, field: string, whole: string) {
  await expect(async () => {
    await page.goto(tableOf(product));
    await expect(page.getByTestId(`analytic-headline-${field}-value`)).toHaveText(whole, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

// THE WHEN — Analytic by day over the last 7 days, filtered to the product, Restock added.
async function when(page: Page, r: Role, product: string) {
  await page.goto(`/analytic?g=daily&r=7d&product=${product}`);
  await expect(page.getByTestId("current-user")).toHaveText(username(r.key));
  await addMetric(page, "inventory", RESTOCK);
}

// Today's row after the WHEN, re-read (the address now carries the metric) until `field` reads `want`.
async function todayReads(page: Page, field: string, want: string) {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId(`analytic-cell-${today()}-${field}`)).toHaveText(want, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

const sign = (page: Page, r: Role) =>
  signInAs(page, username(r.key), PASSWORD, r.side === "selling" ? ground.team : ground.warehouse);

test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await seed();
});

// ── 9 · a restock of 10 created today ───────────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G9.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const raised = ground.restocks["9"]!;
      await sign(page, r);
      await when(page, r, raised.product);

      await test.step(G9.then, async () => {
        await todayReads(page, "ordered_count", String(UNITS));
        await expect(page.getByTestId(`analytic-cell-${today()}-ordered_value`)).toHaveText(rupiah(TOTAL));
      });
      await test.step("regression: nothing lost, nothing accepted yet", async () => {
        expect.soft(String(await read(page, "lost_count"))).toMatch(/^(0|—|null)$/);
        expect.soft(String(await read(page, "accepted_count"))).toMatch(/^(0|—|null)$/);
      });
    });
  }
});

// ── 10 · 2 units removed from a restock today ───────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G10.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const raised = ground.restocks[`10-${r.key}`]!;
      await sign(page, r);

      // BEFORE — today's row holds the restock's 10 ordered for Rp 100.000.
      await openTable(page, raised.product, "ordered_count", String(UNITS));
      expect(await read(page, "ordered_count")).toBe(String(UNITS));
      expect(await read(page, "ordered_value")).toBe(rupiah(TOTAL));

      // The given — the selling team takes 2 units off the restock's line (the edit replaces the line: 8 for Rp 80.000).
      await asRoot("inventory.v1.RestockRequestService/RestockRequestUpdate", {
        teamId: ground.team,
        requestId: raised.id,
        warehouseId: ground.warehouse,
        financeAccountId: ground.account,
        items: [
          {
            id: raised.itemId,
            productId: raised.product,
            productCode: raised.productCode,
            name: raised.name,
            count: UNITS - 2,
            total: TOTAL - 2 * PER_UNIT,
          },
        ],
      });

      await when(page, r, raised.product);

      await test.step(G10.then, async () => {
        // Today's row moved by the edit's difference: −2 units, −Rp 20.000.
        await todayReads(page, "ordered_count", String(UNITS - 2));
        const value = page.getByTestId(`analytic-cell-${today()}-ordered_value`);
        await expect(value).toHaveText(rupiah(TOTAL - 2 * PER_UNIT));
        expect(Number(await read(page, "ordered_count")) - UNITS).toBe(-2);
      });
    });
  }
});

// ── 11 · a restock with COD Rp 15.000 accepted today ────────────────────────────────────────────────────────────────

test.describe(`selling:all · warehouse:all wants to see statistics (${G11.case})`, () => {
  for (const r of [...SELLING, ...WAREHOUSE]) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const raised = ground.restocks["11"]!;
      await sign(page, r);
      await when(page, r, raised.product);

      await test.step(G11.then, async () => {
        await todayReads(page, "cod_amount", rupiah(COD));
      });
      await test.step(
        r.side === "warehouse"
          ? "regression: the warehouse reads the units it took in, and no value"
          : "regression: the units accepted beside it, with their value",
        async () => {
          await expect.soft(page.getByTestId(`analytic-cell-${today()}-accepted_count`)).toHaveText(String(UNITS));
          if (r.side === "warehouse") {
            await expect.soft(page.getByTestId(`analytic-cell-${today()}-ordered_value`)).toHaveCount(0);
            await expect.soft(page.getByTestId(`analytic-cell-${today()}-accepted_value`)).toHaveCount(0);
          } else {
            await expect.soft(page.getByTestId(`analytic-cell-${today()}-accepted_value`)).toHaveText(/^Rp /);
          }
        },
      );
    });
  }
});

// ── 12 · a restock of 10 marked lost today ──────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G12.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const raised = ground.restocks["12"]!;
      await sign(page, r);
      await when(page, r, raised.product);

      await test.step(G12.then, async () => {
        await todayReads(page, "lost_count", String(UNITS));
        await expect(page.getByTestId(`analytic-cell-${today()}-lost_value`)).toHaveText(rupiah(TOTAL));
      });
      await test.step("regression: a lost box is not a cancel — the ordered 10 stay", async () => {
        await expect.soft(page.getByTestId(`analytic-cell-${today()}-ordered_count`)).toHaveText(String(UNITS));
      });
    });
  }
});

// ── 13 · a restock of 10 cancelled today ────────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G13.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const raised = ground.restocks[`13-${r.key}`]!;
      await sign(page, r);

      // BEFORE — today's row holds the restock's 10 ordered for Rp 100.000.
      await openTable(page, raised.product, "ordered_count", String(UNITS));
      expect(await read(page, "ordered_count")).toBe(String(UNITS));
      expect(await read(page, "ordered_value")).toBe(rupiah(TOTAL));

      // The given — the selling team cancels it while it is on its way (the money stays spent).
      await asRoot("inventory.v1.RestockRequestService/RestockRequestCancel", {
        teamId: ground.team,
        requestId: raised.id,
        moneyReturned: false,
      });

      await when(page, r, raised.product);

      await test.step(G13.then, async () => {
        // The cancel took the 10 and their Rp 100.000 back on the same day: the product's whole reads 0 (once the
        // headline has answered), and today's row nets to nothing — no row, or zeros.
        await expect(async () => {
          await page.reload();
          await expect(page.getByTestId("analytic-headline-ordered_count-value")).toHaveText("0", { timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        await expect(page.getByTestId("analytic-headline-ordered_value-value")).toHaveText(/^(Rp 0|—)$/);
        expect(String(await read(page, "ordered_count"))).toMatch(/^(0|null)$/);
        expect(String(await read(page, "ordered_value"))).toMatch(/^(Rp 0|null)$/);
      });
    });
  }
});

// ── 14 · a lost restock of 10 arrives today ─────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G14.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const raised = ground.restocks[`14-${r.key}`]!;
      await sign(page, r);

      // BEFORE — today's row holds the box's 10 lost for Rp 100.000 (and its 10 ordered).
      await openTable(page, raised.product, "lost_count", String(UNITS));
      expect(await read(page, "lost_count")).toBe(String(UNITS));
      expect(await read(page, "lost_value")).toBe(rupiah(TOTAL));

      // The given — the box turns up after all: its warehouse signs for it as arrived.
      await asRoot("inventory.v1.RestockRequestService/RestockRequestArrive", { teamId: ground.warehouse, requestId: raised.id });

      await when(page, r, raised.product);

      await test.step(G14.then, async () => {
        // The arrival took the 10 lost and their Rp 100.000 back on the same day: today's lost nets to 0.
        await todayReads(page, "lost_count", "0");
        await expect(page.getByTestId(`analytic-cell-${today()}-lost_value`)).toHaveText(rupiah(0));
      });
      await test.step("regression: the ordered 10 stay — an arrival is no cancel", async () => {
        await expect.soft(page.getByTestId(`analytic-cell-${today()}-ordered_count`)).toHaveText(String(UNITS));
      });
    });
  }
});

// ── 15 · a restock of 10 created today, read by its warehouse ───────────────────────────────────────────────────────
//
// The same restock as given 9 (raised today to this warehouse, not yet accepted). A warehouse reads the units ordered
// and never a value (a-warehouse-reads-the-newest-counts-as-accepted): no Value ordered cell, column or headline card —
// proven beside the Units ordered column and card that ARE drawn, so the absence is not an empty page.

test.describe(`warehouse:all wants to see statistics (${G15.case})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const raised = ground.restocks["9"]!;
      await sign(page, r);
      await when(page, r, raised.product);

      await test.step(G15.then, async () => {
        await todayReads(page, "ordered_count", String(UNITS));
        await expect(page.getByTestId("analytic-sort-ordered_count")).toBeVisible();
        await expect(page.getByTestId("analytic-headline-ordered_count-value")).toHaveText(String(UNITS));
        // value not shown — no cell, no column, no headline card, and no "Value ordered" label on the table or the strip
        await expect(page.getByTestId(`analytic-cell-${today()}-ordered_value`)).toHaveCount(0);
        await expect(page.getByTestId("analytic-sort-ordered_value")).toHaveCount(0);
        await expect(page.locator('[data-testid^="analytic-headline-ordered_value"]')).toHaveCount(0);
        await expect(page.getByTestId("analytic-table")).not.toContainText("Value ordered");
        await expect(page.getByTestId("analytic-headline")).not.toContainText("Value ordered");
      });
      await test.step("regression: the warehouse reads no restock value of any kind", async () => {
        await expect.soft(page.locator('[data-testid^="analytic-cell-"][data-testid$="_value"]')).toHaveCount(0);
        await expect.soft(page.locator('[data-testid^="analytic-sort-"][data-testid$="_value"]')).toHaveCount(0);
      });
    });
  }
});

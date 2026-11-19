import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, readyAt } from "./restock_helpers";
import { listLanded } from "./pickers";

// ── warehouse:owner · warehouse:admin wants to correct a received count — the checks behind
//    docs/acceptances/inventory/restock.md ─────────────────────────────────────────────────────────────────────────────
//
// One test per GIVEN, run as EVERY role the given names (warehouse:owner, warehouse:admin — the receiving warehouse's
// Owner or Admin corrects, the-warehouse-corrects-a-wrong-stock-in-alone). Each THEN is its own step, named exactly as its
// row, and checked SOFTLY so one failing then does not hide the next. The WHEN goes through the restock's own page:
// Correct Received Count → the form → the real count (and, for units in, the rack they go onto) → a reason → Save
// Correction → the confirm (the-received-count-prototype-is-accepted).
//
// The GIVEN is seeded through the API by root: per role and given, a restock of 10 × one product of its own for Rp 100.000
// (Rp 10.000 a unit, no costs — the batch price, a-stock-in-correction-keeps-the-batch-price), naming the ONE supplier,
// accepted onto the ONE rack:
//   (all received · received count too high)  — accepted as 10, the box held 8: corrected 10 → 8, 2 units out;
//   (missing items · received count too low)  — accepted as 7 (3 missing), the box held 9: corrected 7 → 9, 2 units in.
//
// Where each then is read:
// - `restock shows corrected received count` — the warehouse's restock page: the line's Received, *corrected from N*.
// - `correction recorded in restock timeline` — that page's Riwayat: ONE correction row, *Received count corrected ·
//   from → to*, the units it moved, the reason and who.
// - `ready stock increases|decreases` — the selling team's Ready at the warehouse, on its product picker: before and after.
// - `stock on 1 rack increases|decreases` — the rack's page, the product's on-hand: before and after.
// - `missing items increase|decrease` — the warehouse's restock page, the line's Missing: `—` → `2 (correction)`, or
//   `3` → `3 − 2 (correction)` (the door's 3, two of them found).
// - `selling team sees correction value` — the selling team's restock page: the line's *Missing (correction) ±2* badge,
//   and in its detail what the units are worth at the batch price, Rp 20.000 — borne by the selling team, or lifted off it.
// - `correction recorded in product history` — the selling team's product page, Stock history: ONE *Received count
//   corrected* row, from → to.
// - `missing items recorded in analytic metric` — Analytic › Restock by product, this week, filtered to the product, as
//   the role that corrected: the accept and the correction land on the same day (a-received-count-correction-counts-on-
//   its-own-day), so the day's missing reads 0 + 2 = 2, or 3 − 2 = 1.
// - `recorded at 1 supplier` — the supplier's Statistics by product, as the selling team: the product's row reads the
//   corrected figures — restocked 8 (Rp 80.000) and lost 2, a 20% lost rate; or restocked 9 (Rp 90.000) and lost 1, 10%.
// The figures that land on a fold (analytic, supplier) are re-read until they do.
test.describe("warehouse:owner · warehouse:admin wants to correct a received count", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
  ] as const;
  const ORDERED = 10;
  const TOTAL = 100_000;
  const CASES = [
    {
      cond: "status: accepted · all received · received count too high · 1 product · 1 rack · 1 supplier",
      key: "hi",
      accepted: 10,
      real: 8,
      way: "decreases",
      missing: "increase",
      missingBefore: "—",
      missingAfter: "2 (correction)",
      moved: "2 Missing (correction)",
      badge: "Missing (correction) +2",
      value: "worth Rp 20.000 · borne by the selling team",
      metricMissing: "2",
      supplier: { restocked: "Rp 80.000", lostRate: "20%" },
    },
    {
      cond: "status: accepted · missing items · received count too low · 1 product · 1 rack · 1 supplier",
      key: "lo",
      accepted: 7,
      real: 9,
      way: "increases",
      missing: "decrease",
      missingBefore: "3",
      missingAfter: "3 − 2 (correction)",
      moved: "2 into the batch",
      badge: "Missing (correction) −2",
      value: "Rp 20.000 less borne by the selling team",
      metricMissing: "1",
      supplier: { restocked: "Rp 90.000", lostRate: "10%" },
    },
  ] as const;
  const RESTOCK_METRIC = "metrics/inventory/restock";

  const username = (role: string) => `e2ercc${role}${SUFFIX}`;
  const displayName = (given: string) => `Rcc ${given} ${SUFFIX}`;
  const SELLER = `e2erccseller${SUFFIX}`;
  const WH_CODE = `RC${SUFFIX}`;
  const RACK_CODE = `rcc-${SUFFIX}`;
  const sku = (role: string, kase: string) => `RCC${role.toUpperCase()}${kase.toUpperCase()}${SUFFIX}`;
  const reason = (role: string, kase: string) => `dihitung ulang di rak ${role} ${kase} ${SUFFIX}`;

  type Raised = { request: { id: string; items: { id: string }[] } };

  const ground = {
    team: "",
    warehouse: "",
    rack: "",
    supplier: "",
    products: {} as Record<string, string>,
    restocks: {} as Record<string, Raised>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    // RQS, not RS: restock_warehouse_wants_to_receive.spec.ts seeds RS${SUFFIX}, and the two share restock_helpers'
    // SUFFIX in the restock family's batch — the second TeamCreate was refused (team_code already exists).
    ground.team = await team(`E2E Rcc Seller ${SUFFIX}`, `RQS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Rcc Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");
    ground.rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: RACK_CODE, name: "E2E correct shelf" }))
        .rack.id,
    );

    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.warehouse,
        username: username(r.key),
        password: PASSWORD,
        name: displayName(r.given),
        role: r.role,
      });
    }
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.team,
      username: SELLER,
      password: PASSWORD,
      name: `Rcc selling:owner ${SUFFIX}`,
      role: "ROLE_SELLING_OWNER",
    });

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Rcc Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Rcc Cat ${SUFFIX}` });

    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.team,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Rcc BCA ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `83${SUFFIX}01`,
          openingBalance: 10_000_000,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: ground.team,
      accountId: account,
      operational: true,
    });

    // GIVEN — per role and case: the restock, raised and accepted (all 10, or 7 with 3 missing) onto the one rack.
    for (const r of ROLES) {
      for (const c of CASES) {
        const code = sku(r.key, c.key);
        const productId = String(
          (
            await api(page, "product.v1.ProductService/ProductCreate", {
              teamId: ground.team,
              productCodePart: code,
              name: `E2E ${code}`,
              categoryId: category.category.id,
            })
          ).product.id,
        );
        ground.products[code] = productId;

        const raised = (await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: ground.team,
          warehouseId: ground.warehouse,
          financeAccountId: account,
          items: [{ productId, productCode: code, name: `E2E ${code}`, count: ORDERED, total: TOTAL, supplierId: ground.supplier }],
        })) as Raised;
        await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
          teamId: ground.warehouse,
          requestId: raised.request.id,
          lines: [
            {
              itemId: raised.request.items[0].id,
              receivedCount: c.accepted,
              ...(c.accepted < ORDERED ? { missingNote: "never in the box" } : {}),
              placements: [{ placementId: ground.rack, quantity: c.accepted }],
            },
          ],
        });
        ground.restocks[`${r.key}-${c.key}`] = raised;
      }
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // The product's on-hand on the one rack, as the rack's page shows it.
  async function onRack(page: Page, productId: string) {
    await page.goto(`/inventories/racks/${ground.rack}`);
    await expect(page.getByTestId("rack-detail-page")).toBeVisible();
    return page.getByTestId(`rack-stock-onhand-${productId}`);
  }

  // WHEN — Correct Received Count on the restock's own page: the real count, the rack (units in go onto one; units out
  // come off the rack holding them, which the form picks), the reason, Save Correction and its confirm.
  async function correct(page: Page, restock: Raised, real: number, why: string) {
    const id = restock.request.id;
    const item = restock.request.items[0].id;

    await page.goto(`/inventories/restock/${id}`);
    await page.getByTestId(`restock-action-correct-count-${id}`).click();
    const form = page.getByTestId("rc-dialog");
    await expect(form).toBeVisible();

    const box = form.getByTestId(`rc-line-${item}-real`);
    await box.fill(String(real));
    await expect(box).toHaveValue(String(real));
    const to = form.getByTestId(`rc-line-${item}-to`);
    if ((await form.getByTestId(`rc-line-${item}-from`).count()) === 0) {
      await expect(to).toBeVisible();
      await listLanded(page.getByTestId(`rack-select-option-${ground.rack}`));
      await to.click();
      await page.getByTestId(`rack-select-option-${ground.rack}`).click();
    } else {
      await expect(form.getByTestId(`rc-line-${item}-from`)).toContainText(RACK_CODE);
    }
    await form.getByTestId("rc-reason").fill(why);

    await expect(page.getByTestId("rc-save")).toBeEnabled();
    const saved = page.waitForResponse((res) =>
      res.url().endsWith("/warehouse.inventory.v1.RestockRequestService/RestockReceivedCountCorrect"),
    );
    await page.getByTestId("rc-save").click();
    await page.getByRole("alertdialog").getByTestId("confirm-action").click();
    expect((await saved).status()).toBe(200);
    await expect(form).toBeHidden();
  }

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} correct received count restock (${c.cond})`, async ({ page }) => {
        const restock = ground.restocks[`${r.key}-${c.key}`];
        const id = restock.request.id;
        const code = sku(r.key, c.key);
        const productId = ground.products[code];
        const why = reason(r.key, c.key);

        // The starting point — the selling team's Ready at the warehouse is what the accept put away.
        await signIn(page, SELLER, ground.team);
        await expect(await readyAt(page, WH_CODE, code)).toHaveText(String(c.accepted));

        // …and the warehouse's: the rack holds it, the line's Missing reads the door's.
        await signIn(page, username(r.key), ground.warehouse);
        await expect(await onRack(page, productId)).toHaveText(String(c.accepted));
        await page.goto(`/inventories/restock/${id}`);
        await expect(page.getByTestId(`restock-detail-received-${productId}`)).toContainText(String(c.accepted));
        if (c.missingBefore === "—") {
          await expect(page.getByTestId(`restock-detail-missing-${productId}`)).toHaveText("—");
        } else {
          await expect(page.getByTestId(`restock-detail-missing-${productId}-count`)).toHaveText(c.missingBefore);
        }
        await expect(page.locator('[data-kind="correction"]')).toHaveCount(0);

        // WHEN
        await correct(page, restock, c.real, why);

        // THEN — as the warehouse that corrected it.
        await test.step("then: restock shows corrected received count", async () => {
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(page.getByTestId(`restock-detail-received-${productId}`)).toContainText(String(c.real));
          await expect.soft(page.getByTestId(`restock-detail-received-${productId}-was`)).toHaveText(`corrected from ${c.accepted}`);
        });

        await test.step("then: correction recorded in restock timeline", async () => {
          const row = page.locator('[data-kind="correction"]');
          await expect.soft(row).toHaveCount(1);
          await expect.soft(row).toContainText(`Received count corrected · ${c.accepted} → ${c.real}`);
          await expect.soft(row).toContainText(`E2E ${code} · ${c.moved}`);
          await expect.soft(row).toContainText(why);
          await expect.soft(row).toContainText(displayName(r.given));
        });

        await test.step(`then: missing items ${c.missing}`, async () => {
          await expect.soft(page.getByTestId(`restock-detail-missing-${productId}-count`)).toHaveText(c.missingAfter);
        });

        await test.step(`then: stock on 1 rack ${c.way === "decreases" ? "decreases" : "increases"}`, async () => {
          await expect.soft(await onRack(page, productId)).toHaveText(String(c.real));
        });

        await test.step("then: missing items recorded in analytic metric", async () => {
          await expect
            .soft(async () => {
              await page.goto(`/analytic?g=product&m=${RESTOCK_METRIC}&r=7d&product=${productId}`);
              await expect(page.getByTestId(`analytic-cell-${productId}-missing_count`)).toHaveText(c.metricMissing, {
                timeout: 3_000,
              });
            })
            .toPass({ timeout: 30_000 });
        });

        // THEN — as the selling team, whose stock and money these are.
        await signIn(page, SELLER, ground.team);
        await test.step(`then: ready stock ${c.way}`, async () => {
          await expect.soft(await readyAt(page, WH_CODE, code)).toHaveText(String(c.real));
        });

        await test.step("then: selling team sees correction value", async () => {
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(page.getByTestId(`restock-detail-correction-badge-${productId}`)).toHaveText(c.badge);
          await page.getByTestId(`restock-detail-adjustment-${productId}`).click();
          const detail = page.getByTestId(`restock-detail-adjustment-${productId}-dialog`);
          await expect.soft(detail).toBeVisible();
          await expect.soft(detail.getByTestId(`restock-detail-correction-${productId}-value`)).toHaveText(c.value);
          await page.keyboard.press("Escape");
        });

        await test.step("then: correction recorded in product history", async () => {
          await page.goto(`/products/${productId}`);
          await page.getByTestId("pd-tab-history").click();
          const rows = page
            .getByTestId("pd-panel-history")
            .locator('[data-testid^="pd-history-row-"]')
            .filter({ hasText: "Received count corrected" });
          await expect.soft(rows).toHaveCount(1);
          await expect.soft(rows.first().locator('[data-testid$="-count"]')).toHaveText(`${c.accepted} → ${c.real}`);
          await expect.soft(rows.first()).toContainText(why);
        });

        await test.step("then: recorded at 1 supplier", async () => {
          await expect
            .soft(async () => {
              await page.goto(`/inventories/suppliers/${ground.supplier}`);
              await page.getByTestId("supplier-tab-statistics").click();
              await page.getByTestId("statistics-view-product").click();
              const row = page
                .getByTestId("supplier-statistics")
                .locator('[data-testid^="statistics-product-row-"]')
                .filter({ hasText: code });
              await expect(row).toHaveCount(1, { timeout: 2_000 });
              await expect(row).toContainText(c.supplier.restocked, { timeout: 2_000 });
              await expect(row.getByTestId("figure-lost-rate")).toHaveText(c.supplier.lostRate, { timeout: 2_000 });
            })
            .toPass({ timeout: 30_000 });
        });
      });
    }
  }
});

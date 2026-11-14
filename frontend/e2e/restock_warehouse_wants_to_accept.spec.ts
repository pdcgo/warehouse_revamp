import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, login, api, ongoingOf, inboundRow, readyAt } from "./restock_helpers";

// warehouse:all wants to accept a restock — split out of restock.spec.ts by its describe block (backlog #51), every test and title
// unchanged. Self-contained: the block seeds its own ground in beforeAll; the helpers live in restock_helpers.ts.

// ── warehouse:all wants to accept a restock — the checks behind docs/acceptances/inventory/restock.md ─────────────────
//
// One test per GIVEN, run as EVERY warehouse role. The accept itself goes through the API, with that role's own token:
// the accept FORM has its own coverage in its stories, and what these givens check is where the figures land, which
// the form does not change. Every then is read on a screen — the warehouse's inbound list, rack, and batch, and the
// selling team's product picker for its Ready and Ongoing.
//
// (from arrived) and (from ongoing) count a restock of 10 pcs for Rp 100.000 whole onto the shelf. Each product also has
// a second restock of 5 pcs that stays ongoing, so `ongoing stock decreases` reads 15 → 5 rather than "something → none".
//
// (product new to warehouse) and (product already listed) read the warehouse's own Products — every product it holds or
// has held — for the product's ONE row. (has brokens, thrown away) counts 10 in with 2 broken: 8 reach the shelf, and the
// 2 are a broken row the selling team reads on its restock page. (has brokens, put on rack) is 🚧 unimplemented — the
// accept keeps no rack for broken units — so it has no check here yet. (has missing items) counts
// 7 in of 10, and the 3 are a missing row, read the same way. (1 supplier) and (multi suppliers) check
// `recorded at supplier`. (set courier charge) is not tested here yet. (multi suppliers) is ❌ error: supplier_service folds a restock under ONE restock-level supplier, so a restock
// whose lines name different suppliers is recorded at none (commonLineSupplier). Its check is `test.fail` — green while
// the bug stands, red the day it is fixed, which is the sign to ask the owner to change the status
// (acceptances-are-markdown). A one-supplier restock accepted AFTER the mixed one is its CONTROL: once that shows, the
// fold has run, so the mixed one's absence is the bug and not a slow fold. A broken fold fails the (1 supplier) test
// beside it, so `test.fail` hides nothing.
test.describe("warehouse:all wants to accept a restock", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;
  // The givens whose restock is counted whole onto the shelf, by the status it is in when it is counted.
  const CASES = [
    { cond: "from arrived", key: "ar", from: "arrived", status: 4 },
    { cond: "from ongoing", key: "on", from: "ongoing", status: 1 },
  ] as const;
  // A counted restock: 10 pcs for Rp 100.000, so Rp 10.000 a unit. Its product's other restock: 5 pcs, left ongoing.
  const COUNTED = 10;
  const COUNTED_TOTAL = 100_000;
  const LEFT_ONGOING = 5;
  // Of a (has brokens, thrown away) restock's 10, how many are broken; of a (has missing items) one's, how many never came.
  const BROKEN = 2;
  const MISSING = 3;

  type Raised = { request: { id: string; items: { id: string }[] } };

  const username = (role: string) => `e2eacp${role}${SUFFIX}`;
  const displayName = (given: string) => `Acp ${given} ${SUFFIX}`;
  const SELLER = `e2eacpseller${SUFFIX}`;
  const WH_CODE = `PW${SUFFIX}`;
  // Per role: line C (supplier A) of the one-supplier restock; lines A (supplier A) and B (supplier B) of the MIXED
  // restock, and line D (supplier A) of its control.
  const sku = (role: string, line: "A" | "B" | "C" | "D") => `ACP${role.toUpperCase()}${line}${SUFFIX}`;
  // Per role and case: the product of the restock counted whole onto the shelf.
  const caseSku = (role: string, kase: string) => `ACP${role.toUpperCase()}${kase.toUpperCase()}${SUFFIX}`;
  const ground = {
    team: "",
    warehouse: "",
    rack: "",
    account: "",
    supplierA: "",
    supplierB: "",
    // The supplier every OTHER given's restock names, so A's Statistics holds the supplier givens' products alone — a
    // product among dozens of bigger ones falls off the list, and reads as never recorded.
    supplierC: "",
    products: {} as Record<string, string>,
    restocks: {} as Record<string, Raised>,
  };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    ground.team = String(
      (
        await api(page, "team.v1.TeamService/TeamCreate", {
          name: `E2E Acp Seller ${SUFFIX}`,
          teamCode: `PS${SUFFIX}`,
          type: "TEAM_TYPE_SELLING",
          ownerUserId: ROOT_USER_ID,
        })
      ).team.id,
    );
    ground.warehouse = String(
      (
        await api(page, "team.v1.TeamService/TeamCreate", {
          name: `E2E Acp Warehouse ${SUFFIX}`,
          teamCode: WH_CODE,
          type: "TEAM_TYPE_WAREHOUSE",
          ownerUserId: ROOT_USER_ID,
        })
      ).team.id,
    );
    ground.rack = String(
      (
        await api(page, "inventory.v1.RackService/RackCreate", {
          teamId: ground.warehouse,
          code: `acp-${SUFFIX}`,
          name: "E2E accept shelf",
        })
      ).rack.id,
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
      name: `Acp selling:owner ${SUFFIX}`,
      role: "ROLE_SELLING_OWNER",
    });

    ground.supplierA = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Acp Sup A ${SUFFIX}` }))
        .supplier.id,
    );
    ground.supplierB = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Acp Sup B ${SUFFIX}` }))
        .supplier.id,
    );
    ground.supplierC = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Acp Sup C ${SUFFIX}` }))
        .supplier.id,
    );

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Acp Cat ${SUFFIX}` });
    const product = async (code: string) => {
      const created = await api(page, "product.v1.ProductService/ProductCreate", {
        teamId: ground.team,
        productCodePart: code,
        name: `E2E ${code}`,
        categoryId: category.category.id,
      });
      ground.products[code] = String(created.product.id);
    };
    for (const r of ROLES) {
      for (const line of ["A", "B", "C", "D"] as const) await product(sku(r.key, line));
      for (const c of CASES) await product(caseSku(r.key, c.key));
      for (const kase of ["nw", "al", "br", "ms"]) await product(caseSku(r.key, kase));
    }

    const account = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E Acp BCA ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `79${SUFFIX}01`,
      openingBalance: 10_000_000,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    });
    ground.account = String(account.account.id);
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: ground.team,
      accountId: ground.account,
      operational: true,
    });

    // GIVEN — per role, the restocks it will count in, raised here by root (any seller would do; the seller is not who
    // is being checked): one with one supplier, one with multi suppliers, and the multi one's control.
    for (const r of ROLES) {
      ground.restocks[`${r.key}-single`] = await raise(page, [{ code: sku(r.key, "C"), supplierId: ground.supplierA }]);
      ground.restocks[`${r.key}-mixed`] = await raise(page, [
        { code: sku(r.key, "A"), supplierId: ground.supplierA },
        { code: sku(r.key, "B"), supplierId: ground.supplierB },
      ]);
      ground.restocks[`${r.key}-control`] = await raise(page, [{ code: sku(r.key, "D"), supplierId: ground.supplierA }]);
    }

    // GIVEN — per role and case, the restock to count whole (signed for first when the case is from arrived), and the
    // same product's second restock, which stays ongoing.
    for (const r of ROLES) {
      for (const c of CASES) {
        const code = caseSku(r.key, c.key);
        const counted = await raise(page, [
          { code, supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
        ]);
        if (c.key === "ar") {
          await api(page, "inventory.v1.RestockRequestService/RestockRequestArrive", {
            teamId: ground.warehouse,
            requestId: counted.request.id,
          });
        }
        ground.restocks[`${r.key}-${c.key}`] = counted;
        await raise(page, [{ code, supplierId: ground.supplierC, count: LEFT_ONGOING, total: LEFT_ONGOING * 10_000 }]);
      }
    }

    // GIVEN — per role, a product the warehouse has never held, and one it already lists: counted in once here, by root,
    // before the role counts in its second restock.
    for (const r of ROLES) {
      const fresh = caseSku(r.key, "nw");
      ground.restocks[`${r.key}-nw`] = await raise(page, [
        { code: fresh, supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
      ]);

      const listed = caseSku(r.key, "al");
      const first = await raise(page, [{ code: listed, supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL }]);
      await acceptWhole(page, [first], COUNTED);
      ground.restocks[`${r.key}-al`] = await raise(page, [
        { code: listed, supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
      ]);

      // …and two ongoing restocks: one that will come in with broken units, one with units missing.
      ground.restocks[`${r.key}-br`] = await raise(page, [
        { code: caseSku(r.key, "br"), supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
      ]);
      ground.restocks[`${r.key}-ms`] = await raise(page, [
        { code: caseSku(r.key, "ms"), supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
      ]);
    }

    await page.close();
  });

  // The rows of the warehouse's own Products (every product it holds or has held) that carry this product code.
  async function warehouseRows(page: Page, code: string) {
    await page.goto(`/products?q=${code}`);
    return page.locator('[data-testid^="stock-row-"]').filter({ hasText: code });
  }

  // A restock of the given lines — 2 pcs for Rp 20.000 each unless said — raised for the selling team by `page`'s user.
  async function raise(
    page: Page,
    lines: { code: string; supplierId: string; count?: number; total?: number }[],
  ): Promise<Raised> {
    const created = await page.evaluate(
      async ([body, apiUrl]) => {
        const token =
          window.sessionStorage.getItem("warehouse_revamp.token") ??
          window.localStorage.getItem("warehouse_revamp.token");
        const res = await fetch(`${apiUrl}/warehouse.inventory.v1.RestockRequestService/RestockRequestCreate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`RestockRequestCreate: ${res.status} ${await res.text()}`);
        return res.json();
      },
      [
        {
          teamId: ground.team,
          warehouseId: ground.warehouse,
          financeAccountId: ground.account,
          items: lines.map((l) => ({
            productId: ground.products[l.code],
            productCode: l.code,
            name: `E2E ${l.code}`,
            count: l.count ?? 2,
            total: l.total ?? 20000,
            supplierId: l.supplierId,
          })),
        }, API_URL] as const,
    );
    return created as Raised;
  }

  // WHEN — `page`'s warehouse role counts each restock in, whole, onto the shelf, in the order given.
  async function acceptWhole(page: Page, restocks: Raised[], count = 2) {
    for (const restock of restocks) {
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: restock.request.id,
        lines: restock.request.items.map((item) => ({
          itemId: item.id,
          receivedCount: count,
          placements: [{ placementId: ground.rack, quantity: count }],
        })),
      });
    }
  }

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // THEN is read by the selling team, on a supplier's Statistics, by product.
  async function asSeller(page: Page) {
    await signIn(page, SELLER, ground.team);
  }

  async function byProduct(page: Page, supplierId: string) {
    await page.goto(`/inventories/suppliers/${supplierId}`);
    await page.getByTestId("supplier-tab-statistics").click();
    await page.getByTestId("statistics-view-product").click();
    return page.getByTestId("supplier-statistics");
  }

  // The fold runs on an event, so a product is re-read until it lands rather than once.
  async function untilRecorded(page: Page, supplierId: string, code: string) {
    await expect(async () => {
      const stats = await byProduct(page, supplierId);
      await expect(stats.getByTestId("statistics-products")).toContainText(`E2E ${code}`, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} accept restock (${c.cond})`, async ({ page }) => {
        const restock = ground.restocks[`${r.key}-${c.key}`];
        const id = restock.request.id;
        const code = caseSku(r.key, c.key);
        const productId = ground.products[code];

        await signIn(page, username(r.key), ground.warehouse);
        const row = await inboundRow(page, id, code);
        await expect(row.getByTestId(`restock-status-${c.status}`)).toBeVisible();

        await acceptWhole(page, [restock], COUNTED);

        // THEN — as the warehouse that counted it.
        await test.step(`then: status changed from ${c.from} to accepted`, async () => {
          const after = await inboundRow(page, id, code);
          await expect.soft(after.getByTestId("restock-status-2")).toBeVisible();
          await expect.soft(after.getByTestId(`restock-status-${c.status}`)).toHaveCount(0);
        });

        // Counted straight from ongoing, the box arrived the moment it was counted, signed for by whoever counted it.
        if (c.key === "on") {
          await test.step("then: receiver and time recorded", async () => {
            await inboundRow(page, id, code);
            await expect.soft(page.getByTestId(`restock-arrived-${id}`)).toContainText(/\d/);
            await expect.soft(page.getByTestId(`restock-arrived-${id}-by`)).toContainText(displayName(r.given));
          });
        }

        await test.step("then: units on rack", async () => {
          await page.goto(`/inventories/racks/${ground.rack}`);
          await expect.soft(page.getByTestId(`rack-stock-onhand-${productId}`)).toHaveText(String(COUNTED));
        });

        // The batch the count minted, on the warehouse's batch list: Rp 100.000 ÷ 10 a unit. ⚠ Found by its RESTOCK
        // number, then its product: the list's search reads the restock number and the receipt only, whatever its
        // placeholder says about products (batch_list.go).
        await test.step("then: price set on batch", async () => {
          await page.goto(`/inventories/batches?q=${id}`);
          const batch = page.locator('[data-testid^="batches-row-"]').filter({ hasText: code });
          await expect.soft(batch).toHaveCount(1);
          if ((await batch.count()) === 1) {
            await batch.click();
            await expect.soft(page.getByTestId("batch-detail-unit-cost")).toContainText(
              (COUNTED_TOTAL / COUNTED).toLocaleString("id-ID"),
            );
          }
        });

        // THEN — as the selling team, whose Ready and Ongoing these are.
        await signIn(page, SELLER, ground.team);
        await test.step("then: ready stock increases", async () => {
          await expect.soft(await readyAt(page, WH_CODE, code)).toHaveText(String(COUNTED));
        });

        await test.step(`then: ongoing stock decreases (from ${COUNTED + LEFT_ONGOING} to ${LEFT_ONGOING})`, async () => {
          await expect.soft(await ongoingOf(page, code)).toHaveText(String(LEFT_ONGOING));
        });
      });
    }
  }

  for (const r of ROLES) {
    test(`${r.given} accept restock (has brokens, thrown away)`, async ({ page }) => {
      const restock = ground.restocks[`${r.key}-br`];
      const id = restock.request.id;
      const code = caseSku(r.key, "br");
      const productId = ground.products[code];

      await signIn(page, username(r.key), ground.warehouse);
      await expect((await inboundRow(page, id, code)).getByTestId("restock-status-1")).toBeVisible();

      // WHEN — 10 in the box, 2 of them broken and thrown away: the 8 good ones go on the shelf.
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: id,
        lines: [
          {
            itemId: restock.request.items[0].id,
            receivedCount: COUNTED,
            brokenCount: BROKEN,
            brokenNote: "crushed in transit",
            placements: [{ placementId: ground.rack, quantity: COUNTED - BROKEN }],
          },
        ],
      });

      await test.step("then: status changed from ongoing to accepted", async () => {
        const after = await inboundRow(page, id, code);
        await expect.soft(after.getByTestId("restock-status-2")).toBeVisible();
        await expect.soft(after.getByTestId("restock-status-1")).toHaveCount(0);
      });

      // THEN — as the selling team: its Ready, and its restock page's count.
      await signIn(page, SELLER, ground.team);
      await test.step(`then: ready stock increases, broken excluded (${COUNTED} − ${BROKEN})`, async () => {
        await expect.soft(await readyAt(page, WH_CODE, code)).toHaveText(String(COUNTED - BROKEN));
      });

      await test.step("then: broken items recorded", async () => {
        await page.goto(`/inventories/restock/${id}`);
        await page.getByTestId("section-nav-products").click();
        await page.getByTestId(`restock-detail-adjustment-${productId}`).click();
        await expect.soft(page.getByTestId(`restock-detail-adjustment-${productId}-dialog`)).toBeVisible();
        await expect.soft(page.getByTestId(`restock-detail-broken-${productId}-count`)).toContainText(String(BROKEN));
      });
    });

    test(`${r.given} accept restock (has missing items)`, async ({ page }) => {
      const restock = ground.restocks[`${r.key}-ms`];
      const id = restock.request.id;
      const code = caseSku(r.key, "ms");
      const productId = ground.products[code];
      const arrived = COUNTED - MISSING;

      await signIn(page, username(r.key), ground.warehouse);
      await expect((await inboundRow(page, id, code)).getByTestId("restock-status-1")).toBeVisible();

      // WHEN — 10 ordered, 7 in the box, all good on the shelf: the other 3 are worked out as missing.
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: id,
        lines: [
          {
            itemId: restock.request.items[0].id,
            receivedCount: arrived,
            missingNote: "never in the box",
            placements: [{ placementId: ground.rack, quantity: arrived }],
          },
        ],
      });

      await test.step("then: status changed from ongoing to accepted", async () => {
        const after = await inboundRow(page, id, code);
        await expect.soft(after.getByTestId("restock-status-2")).toBeVisible();
        await expect.soft(after.getByTestId("restock-status-1")).toHaveCount(0);
      });

      // THEN — as the selling team: its Ready, and its restock page's count.
      await signIn(page, SELLER, ground.team);
      await test.step(`then: ready stock increases, missing excluded (${COUNTED} − ${MISSING})`, async () => {
        await expect.soft(await readyAt(page, WH_CODE, code)).toHaveText(String(arrived));
      });

      await test.step("then: missing items recorded", async () => {
        await page.goto(`/inventories/restock/${id}`);
        await page.getByTestId("section-nav-products").click();
        await page.getByTestId(`restock-detail-adjustment-${productId}`).click();
        await expect.soft(page.getByTestId(`restock-detail-adjustment-${productId}-dialog`)).toBeVisible();
        await expect.soft(page.getByTestId(`restock-detail-missing-${productId}-count`)).toContainText(String(MISSING));
      });
    });

    test(`${r.given} accept restock (product new to warehouse)`, async ({ page }) => {
      const code = caseSku(r.key, "nw");

      await signIn(page, username(r.key), ground.warehouse);
      await acceptWhole(page, [ground.restocks[`${r.key}-nw`]], COUNTED);

      await test.step("then: product listed in target warehouse", async () => {
        const rows = await warehouseRows(page, code);
        await expect.soft(rows).toHaveCount(1);
        await expect.soft(rows.locator('[data-testid^="stock-onhand-"]')).toHaveText(String(COUNTED));
      });
    });

    test(`${r.given} accept restock (product already listed)`, async ({ page }) => {
      const code = caseSku(r.key, "al");

      await signIn(page, username(r.key), ground.warehouse);
      const before = await warehouseRows(page, code);
      await expect(before).toHaveCount(1);

      await acceptWhole(page, [ground.restocks[`${r.key}-al`]], COUNTED);

      // Still ONE row, now holding both counts.
      await test.step("then: product not listed again", async () => {
        const rows = await warehouseRows(page, code);
        await expect.soft(rows.locator('[data-testid^="stock-onhand-"]')).toHaveText(String(COUNTED * 2));
        await expect.soft(rows).toHaveCount(1);
      });
    });

    test(`${r.given} accept restock (1 supplier)`, async ({ page }) => {
      await login(page, username(r.key), PASSWORD);
      await acceptWhole(page, [ground.restocks[`${r.key}-single`]]);

      await asSeller(page);
      await test.step("then: recorded at supplier", async () => {
        await untilRecorded(page, ground.supplierA, sku(r.key, "C"));
      });
    });

    test(`${r.given} accept restock (multi suppliers)`, async ({ page }) => {
      test.fail(true, "❌ error — docs/acceptances/inventory/restock.md#a-multi-supplier-restock-is-recorded-at-no-supplier");

      // The mixed one first, its control after.
      await login(page, username(r.key), PASSWORD);
      await acceptWhole(page, [ground.restocks[`${r.key}-mixed`], ground.restocks[`${r.key}-control`]]);

      await asSeller(page);
      // The control has landed, so the fold has run past the mixed restock.
      await untilRecorded(page, ground.supplierA, sku(r.key, "D"));

      await test.step("then: recorded at supplier", async () => {
        const atA = await byProduct(page, ground.supplierA);
        await expect.soft(atA.getByTestId("statistics-products")).toContainText(`E2E ${sku(r.key, "A")}`);
        const atB = await byProduct(page, ground.supplierB);
        await expect.soft(atB).toContainText(`E2E ${sku(r.key, "B")}`);
      });
    });
  }
});

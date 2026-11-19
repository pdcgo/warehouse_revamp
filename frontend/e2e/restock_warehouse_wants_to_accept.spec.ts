import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, login, api, ongoingOf, inboundRow, readyAt } from "./restock_helpers";
import { listLanded } from "./pickers";

// warehouse:all wants to accept a restock — split out of restock.spec.ts by its describe block (backlog #51), every test and title
// unchanged. Self-contained: the block seeds its own ground in beforeAll; the helpers live in restock_helpers.ts.

// ── warehouse:all wants to accept a restock — the checks behind docs/acceptances/inventory/restock.md ─────────────────
//
// One test per GIVEN, run as EVERY warehouse role. The accept itself goes through the API, with that role's own token:
// the accept FORM has its own coverage in its stories, and what these givens check is where the figures land, which
// the form does not change. Every then is read on a screen — the warehouse's inbound list, rack, and batch, and the
// selling team's product picker for its Ready and Ongoing.
//
// Every given names five facts — status · what the box held · whether the product is new to the warehouse · COD ·
// suppliers — and differs from the plain one, (status: ongoing · all received · new product · no COD · 1 supplier), by one.
//
// (status: arrived …) and (status: ongoing …) count a restock of 10 pcs for Rp 100.000 whole onto the shelf. Each product
// also has a second restock of 5 pcs that stays ongoing, so `ongoing stock decreases` reads 15 → 5 rather than
// "something → none". The plain given's thens are read by three tests: that one, `…: new product listed in warehouse`
// and `…: recorded at 1 supplier`, each on its own ground.
//
// The new-product and listed-product checks read the warehouse's own Products — every product it holds or has held — for
// the product's ONE row. (brokens thrown away) counts 10 in with 2 broken: 8 reach the shelf, and the 2 are a broken row
// the selling team reads on its restock page. (brokens on rack) cannot be set up as written since #77: the owner's
// a-restocks-broken-units-are-just-broken-for-now (2026-11-18) — *"broken is enough to be broken, no need placement"* —
// removed the accept page's rack choice for broken units (a-broken-product-may-go-on-a-rack is withdrawn), and the
// acceptance row now contradicts it (the owner's to change; reported, not edited). So that given is counted in through
// the ACCEPT PAGE the only way it has: 2 broken, no rack offered for them, the 8 good on the shelf — its count in the
// metric checked as every role — and `brokens on rack` keeps its 🚧 `test.fail` as warehouse:owner's own test: the page
// offering a rack for the broken units. (missing items) counts 7 in of 10, and the 3 are a missing row, read the same way.
// `recorded in product history` is read on the selling team's own product page, Stock history: one Restock row, +10.
// `<what> recorded in analytic metric` is read as the role that counted it in, on Analytic → Restock by product, filtered
// to the product: accepted, broken or missing, as the case says. `can print barcode` — an accepted row offers Print
// (labels-print-from-arrived): one label per unit put away, each with its rack and its QR code, and Cetak reaches the
// browser's print (stubbed, so a headless run never opens a dialog). (status: arrived …) is `recorded at 1 supplier` on a
// supplier of its own (D), so its Statistics hold those three products alone.
// (COD) — the courier's charge typed at the accept: the restock's page says it, and the SELLING team's liability ledger
// with the warehouse holds it (read as selling:owner — liability is not a staff read). `COD recorded in analytic metric`
// is 🚧 unimplemented — liability keeps no metric — so its check is its own test, marked `test.fail` with the status, as
// warehouse:owner: any figure of the product's Restock row reading the charge (field-agnostic, since where it will show is
// not built). The day it turns red the then is built: ask the owner, then run it as every role, pointed at that field.
// (multi suppliers) is ✅ ok since 2026-11-14 (the owner's word, after supplier_service
// began crediting each LINE's own supplier — the-supplier-comes-from-the-restock-until-lines-name-a-store); until then the
// restock was recorded at none and this check was `test.fail`. A one-supplier restock accepted AFTER the multi-supplier one
// is its CONTROL: once that shows, the fold has run, so a missing multi-supplier row is a real failure, not a slow fold.
test.describe("warehouse:all wants to accept a restock", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;
  // The givens whose restock is counted whole onto the shelf, by the status it is in when it is counted.
  const CASES = [
    { cond: "status: arrived · all received · new product · no COD · 1 supplier", key: "ar", from: "arrived", status: 4 },
    { cond: "status: ongoing · all received · new product · no COD · 1 supplier", key: "on", from: "ongoing", status: 1 },
  ] as const;
  // A counted restock: 10 pcs for Rp 100.000, so Rp 10.000 a unit. Its product's other restock: 5 pcs, left ongoing.
  const COUNTED = 10;
  const COUNTED_TOTAL = 100_000;
  const LEFT_ONGOING = 5;
  // Of a (has brokens, thrown away) restock's 10, how many are broken; of a (has missing items) one's, how many never came.
  const BROKEN = 2;
  const MISSING = 3;
  // (COD): the courier's charge per role — amounts no other figure of these pages reads — and the 🚧 metric test's own.
  const COD = { own: 6_150, adm: 6_250, stf: 6_350 } as Record<string, number>;
  const COD_METRIC = 7_350;
  const COD_NOTE = `courier asked at the door ${SUFFIX}`;
  const rp = (n: number) => n.toLocaleString("id-ID");
  const RESTOCK_METRIC = "metrics/inventory/restock";

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
    // The (status: arrived …) given's own, for its `recorded at 1 supplier` — the same reason.
    supplierD: "",
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
    ground.supplierD = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Acp Sup D ${SUFFIX}` }))
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
      for (const kase of ["nw", "al", "br", "ms", "cd", "cx", "bk", "bx"]) await product(caseSku(r.key, kase));
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
          { code, supplierId: c.key === "ar" ? ground.supplierD : ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
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

      // …and one the courier asks a charge for at the door; warehouse:owner's 🚧 metric test has one more, below.
      ground.restocks[`${r.key}-cd`] = await raise(page, [
        { code: caseSku(r.key, "cd"), supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
      ]);

      // …and one that comes in with broken units the role puts on a shelf; warehouse:owner's 🚧 test has one more.
      ground.restocks[`${r.key}-bk`] = await raise(page, [
        { code: caseSku(r.key, "bk"), supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
      ]);
    }
    ground.restocks["own-cx"] = await raise(page, [
      { code: caseSku("own", "cx"), supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
    ]);
    ground.restocks["own-bx"] = await raise(page, [
      { code: caseSku("own", "bx"), supplierId: ground.supplierC, count: COUNTED, total: COUNTED_TOTAL },
    ]);

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

  // THEN is read on Analytic → Restock by product, this week, as `page`'s user — the product's own row (the page's
  // product filter). The figure lands on the fold, so it is re-read until it does.
  async function restockMetric(page: Page, productId: string, field: string, expected: string) {
    await expect
      .soft(async () => {
        await page.goto(`/analytic?g=product&m=${RESTOCK_METRIC}&r=7d&product=${productId}`);
        await expect(page.getByTestId(`analytic-cell-${productId}-${field}`)).toHaveText(expected, { timeout: 3_000 });
      })
      .toPass({ timeout: 30_000 });
  }

  // THEN is read on the selling team's own product page, Stock history: the accept is ONE Restock row, +count.
  async function productHistory(page: Page, productId: string, count: number) {
    await page.goto(`/products/${productId}`);
    await page.getByTestId("pd-tab-history").click();
    const rows = page
      .getByTestId("pd-panel-history")
      .locator('[data-testid^="pd-history-row-"]')
      .filter({ hasText: "Restock" });
    await expect.soft(rows).toHaveCount(1);
    await expect.soft(rows.first()).toContainText(`+${count}`);
  }

  // THEN — the accepted row offers Print (labels-print-from-arrived): Cetak Label on this restock, one label per unit put
  // away, each with its rack and its QR code, the arrived-only note gone; Cetak reaches the browser's print (stubbed).
  async function printsBarcode(page: Page, id: string, code: string, units: number) {
    await inboundRow(page, id, code);
    await page.getByTestId(`restock-action-labels-${id}`).click();
    await expect(page.getByTestId("labels-page")).toBeVisible();
    const group = page.getByTestId(`labels-group-${id}`);
    await expect(group).toBeVisible();
    await expect.soft(group.getByTestId("labels-arrived-note")).toHaveCount(0);

    const printed = page.getByTestId("labels-print-root");
    await expect.soft(printed.locator(".print-label")).toHaveCount(units);
    await expect.soft(printed.locator(".print-label svg")).toHaveCount(units);
    await expect.soft(printed.getByTestId("label-sku").first()).toHaveText(code);
    await expect.soft(printed.getByTestId("label-placement").first()).toHaveText(`acp-${SUFFIX}`);

    await page.evaluate(() => {
      const w = window as unknown as { __printed: number; print: () => void };
      w.__printed = 0;
      w.print = () => {
        w.__printed += 1;
      };
    });
    await expect(page.getByTestId("labels-print")).toBeEnabled();
    await page.getByTestId("labels-print").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  }

  // WHEN — `page`'s warehouse role counts the restock in whole, paying the courier `charge` at the door (its note required).
  async function acceptWithCod(page: Page, restock: Raised, charge: number) {
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouse,
      requestId: restock.request.id,
      warehouseAdditionalCost: charge,
      warehouseAdditionalCostNote: COD_NOTE,
      lines: restock.request.items.map((item) => ({
        itemId: item.id,
        receivedCount: COUNTED,
        placements: [{ placementId: ground.rack, quantity: COUNTED }],
      })),
    });
  }

  // WHEN — on the accept page, as `page`'s role: all 10 arrived, 2 of them broken (with a note). Broken is just broken
  // (a-restocks-broken-units-are-just-broken-for-now): the page offers NO rack for them — neither the Dibuang / Ditaruh di
  // rak choice nor a Rusak placement row — and the line is finished with the 8 good ones on the shelf alone.
  async function acceptBrokensOnPage(page: Page, restock: Raised, productId: string) {
    await page.goto(`/inventories/restock/${restock.request.id}/accept`);
    await expect(page.getByTestId(`accept-line-${productId}`)).toBeVisible();
    await page.getByTestId(`accept-all-arrived-${productId}`).click();
    await page.getByTestId(`accept-broken-${productId}`).fill(String(BROKEN));
    await page.getByTestId(`accept-broken-note-${productId}`).fill("crushed in transit");
    await expect(page.getByTestId(`accept-broken-block-${productId}`)).toBeVisible();
    await expect(page.getByTestId(`accept-broken-to-rack-${productId}`)).toHaveCount(0);
    await expect(page.getByTestId(`accept-broken-to-discard-${productId}`)).toHaveCount(0);
    await expect(page.getByTestId(`accept-broken-place-${productId}`)).toHaveCount(0);
    await expect(page.getByTestId(`accept-placement-broken-${productId}`)).toHaveCount(0);

    const good = page.getByTestId(`accept-placement-${productId}-0`);
    await listLanded(good.getByTestId(`rack-select-option-${ground.rack}`));
    await good.getByTestId("rack-select").click();
    await good.getByTestId(`rack-select-option-${ground.rack}`).click();

    const submit = page.getByTestId("accept-submit");
    await expect(submit).toBeEnabled();
    const accepted = page.waitForResponse((res) =>
      res.url().endsWith("/warehouse.inventory.v1.RestockRequestService/RestockRequestAccept"),
    );
    await submit.click();
    await page.getByTestId("confirm-action").click();
    expect((await accepted).status()).toBe(200);
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

        await test.step("then: all received on rack", async () => {
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

        // (status: ongoing …) reads this then in its own test below, on a product of its own.
        if (c.key === "ar") {
          await test.step("then: new product listed in warehouse", async () => {
            const rows = await warehouseRows(page, code);
            await expect.soft(rows).toHaveCount(1);
            await expect.soft(rows.locator('[data-testid^="stock-onhand-"]')).toHaveText(String(COUNTED));
          });
        }

        await test.step("then: all received recorded in analytic metric", async () => {
          await restockMetric(page, productId, "accepted_count", String(COUNTED));
        });

        // THEN — as the selling team, whose Ready and Ongoing these are.
        await signIn(page, SELLER, ground.team);
        await test.step("then: ready stock increases by all received", async () => {
          await expect.soft(await readyAt(page, WH_CODE, code)).toHaveText(String(COUNTED));
        });

        await test.step(`then: ongoing stock decreases by all received (from ${COUNTED + LEFT_ONGOING} to ${LEFT_ONGOING})`, async () => {
          await expect.soft(await ongoingOf(page, code)).toHaveText(String(LEFT_ONGOING));
        });

        await test.step("then: recorded in product history", async () => {
          await productHistory(page, productId, COUNTED);
        });

        // (status: ongoing …) reads this then in its own test below, at supplier A; this given's restock names D alone.
        if (c.key === "ar") {
          await test.step("then: recorded at 1 supplier", async () => {
            await expect
              .soft(async () => {
                const stats = await byProduct(page, ground.supplierD);
                await expect(stats.getByTestId("statistics-products")).toContainText(`E2E ${code}`, { timeout: 2_000 });
              })
              .toPass({ timeout: 30_000 });
          });
        }

        // THEN — back as the warehouse role: Print is last, since its page is the one a failure stops on.
        await signIn(page, username(r.key), ground.warehouse);
        await test.step("then: can print barcode", async () => {
          await printsBarcode(page, id, code, COUNTED);
        });
      });
    }
  }

  for (const r of ROLES) {
    test(`${r.given} accept restock (status: ongoing · brokens thrown away · new product · no COD · 1 supplier)`, async ({ page }) => {
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

      await test.step("then: brokens recorded in analytic metric", async () => {
        await restockMetric(page, productId, "broken_count", String(BROKEN));
      });

      // THEN — as the selling team: its Ready, and its restock page's count.
      await signIn(page, SELLER, ground.team);
      await test.step(`then: ready stock increases, brokens excluded (${COUNTED} − ${BROKEN})`, async () => {
        await expect.soft(await readyAt(page, WH_CODE, code)).toHaveText(String(COUNTED - BROKEN));
      });

      await test.step("then: brokens thrown away recorded", async () => {
        await page.goto(`/inventories/restock/${id}`);
        await page.getByTestId("section-nav-products").click();
        await page.getByTestId(`restock-detail-adjustment-${productId}`).click();
        await expect.soft(page.getByTestId(`restock-detail-adjustment-${productId}-dialog`)).toBeVisible();
        await expect.soft(page.getByTestId(`restock-detail-broken-${productId}-count`)).toContainText(String(BROKEN));
      });
    });

    test(`${r.given} accept restock (status: ongoing · missing items · new product · no COD · 1 supplier)`, async ({ page }) => {
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

      await test.step("then: missing items recorded in analytic metric", async () => {
        await restockMetric(page, productId, "missing_count", String(MISSING));
      });

      // THEN — as the selling team: its Ready, and its restock page's count.
      await signIn(page, SELLER, ground.team);
      await test.step(`then: ready stock increases, missing items excluded (${COUNTED} − ${MISSING})`, async () => {
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

    // The broken units counted in through the accept page — no rack is offered for them since #77 (see the head of this
    // file). Their count lands in the metric; `brokens on rack` itself is 🚧 — the owner's test below.
    test(`${r.given} accept restock (status: ongoing · brokens on rack · new product · no COD · 1 supplier)`, async ({ page }) => {
      const restock = ground.restocks[`${r.key}-bk`];
      const productId = ground.products[caseSku(r.key, "bk")];

      await signIn(page, username(r.key), ground.warehouse);
      await acceptBrokensOnPage(page, restock, productId);

      await test.step("then: brokens recorded in analytic metric", async () => {
        await restockMetric(page, productId, "broken_count", String(BROKEN));
      });
    });

    test(`${r.given} accept restock (status: ongoing · all received · new product · no COD · 1 supplier): new product listed in warehouse`, async ({ page }) => {
      const code = caseSku(r.key, "nw");

      await signIn(page, username(r.key), ground.warehouse);
      await acceptWhole(page, [ground.restocks[`${r.key}-nw`]], COUNTED);

      await test.step("then: new product listed in warehouse", async () => {
        const rows = await warehouseRows(page, code);
        await expect.soft(rows).toHaveCount(1);
        await expect.soft(rows.locator('[data-testid^="stock-onhand-"]')).toHaveText(String(COUNTED));
      });
    });

    test(`${r.given} accept restock (status: ongoing · all received · listed product · no COD · 1 supplier)`, async ({ page }) => {
      const code = caseSku(r.key, "al");

      await signIn(page, username(r.key), ground.warehouse);
      const before = await warehouseRows(page, code);
      await expect(before).toHaveCount(1);

      await acceptWhole(page, [ground.restocks[`${r.key}-al`]], COUNTED);

      // Still ONE row, now holding both counts.
      await test.step("then: listed product not listed again", async () => {
        const rows = await warehouseRows(page, code);
        await expect.soft(rows.locator('[data-testid^="stock-onhand-"]')).toHaveText(String(COUNTED * 2));
        await expect.soft(rows).toHaveCount(1);
      });

      // This week's Restock of the product holds both counts in: root's first 10 and this 10.
      await test.step("then: all received recorded in analytic metric", async () => {
        await restockMetric(page, ground.products[code], "accepted_count", String(COUNTED * 2));
      });
    });

    test(`${r.given} accept restock (status: ongoing · all received · new product · no COD · 1 supplier): recorded at 1 supplier`, async ({ page }) => {
      await login(page, username(r.key), PASSWORD);
      await acceptWhole(page, [ground.restocks[`${r.key}-single`]]);

      await asSeller(page);
      await test.step("then: recorded at 1 supplier", async () => {
        await untilRecorded(page, ground.supplierA, sku(r.key, "C"));
      });
    });

    test(`${r.given} accept restock (status: ongoing · all received · new product · no COD · multi suppliers)`, async ({ page }) => {

      // The mixed one first, its control after.
      await login(page, username(r.key), PASSWORD);
      await acceptWhole(page, [ground.restocks[`${r.key}-mixed`], ground.restocks[`${r.key}-control`]]);

      await asSeller(page);
      // The control has landed, so the fold has run past the mixed restock.
      await untilRecorded(page, ground.supplierA, sku(r.key, "D"));

      await test.step("then: recorded at each supplier", async () => {
        const atA = await byProduct(page, ground.supplierA);
        await expect.soft(atA.getByTestId("statistics-products")).toContainText(`E2E ${sku(r.key, "A")}`);
        const atB = await byProduct(page, ground.supplierB);
        await expect.soft(atB).toContainText(`E2E ${sku(r.key, "B")}`);
      });
    });

    test(`${r.given} accept restock (status: ongoing · all received · new product · COD · 1 supplier)`, async ({ page }) => {
      const restock = ground.restocks[`${r.key}-cd`];
      const id = restock.request.id;
      const code = caseSku(r.key, "cd");
      const charge = COD[r.key];

      await signIn(page, username(r.key), ground.warehouse);
      await expect((await inboundRow(page, id, code)).getByTestId("restock-status-1")).toBeVisible();

      // WHEN — counted in whole, the courier paid at the door.
      await acceptWithCod(page, restock, charge);

      await test.step("then: COD recorded on restock", async () => {
        await page.goto(`/inventories/restock/${id}`);
        await expect.soft(page.getByTestId("restock-detail-courier-charge")).toContainText(rp(charge));
        await expect.soft(page.getByTestId("restock-detail-courier-charge-note")).toContainText(COD_NOTE);
      });

      // THEN — as the selling team, who owes the warehouse the charge: its ledger with the warehouse holds the restock's
      // courier entry. Liability posts it from the accept's event, so it is re-read until it lands.
      await signIn(page, SELLER, ground.team);
      await test.step("then: COD recorded in liability", async () => {
        await expect
          .soft(async () => {
            await page.goto(`/liability/${ground.warehouse}`);
            const entry = page
              .getByTestId("liability-detail-all")
              .locator('[data-testid^="liability-detail-entry-"]')
              .filter({ hasText: `restock #${id}` });
            await expect(entry).toHaveCount(1, { timeout: 3_000 });
            await expect(entry).toContainText(rp(charge));
          })
          .toPass({ timeout: 30_000 });
      });
    });
  }

  // 🚧 — its own test, so the expected failure hides none of the thens above (see the head of this file).
  test("warehouse:owner accept restock (status: ongoing · brokens on rack · new product · no COD · 1 supplier): brokens on rack", async ({
    page,
  }) => {
    test.fail(
      true,
      "🚧 unimplemented (docs/acceptances/inventory/restock.md) — and not to be built for now: a-restocks-broken-units-are-just-broken-for-now (2026-11-18) removed the accept page's rack choice for broken units",
    );

    const productId = ground.products[caseSku("own", "bx")];

    await signIn(page, username("own"), ground.warehouse);
    await page.goto(`/inventories/restock/${ground.restocks["own-bx"].request.id}/accept`);
    await expect(page.getByTestId(`accept-line-${productId}`)).toBeVisible();
    await page.getByTestId(`accept-all-arrived-${productId}`).click();
    await page.getByTestId(`accept-broken-${productId}`).fill(String(BROKEN));
    await expect(page.getByTestId(`accept-broken-block-${productId}`)).toBeVisible();

    // The page offers a rack for the broken units — the choice it had before #77 (accept-broken-to-rack). Field-agnostic
    // past that: the day a rack for broken units is asked again and built, this turns red — ask the owner.
    await test.step("then: brokens on rack", async () => {
      await expect(page.getByTestId(`accept-broken-to-rack-${productId}`)).toBeVisible({ timeout: 5_000 });
    });
  });

  // 🚧 — its own test, so the expected failure hides none of the thens above (see the head of this file).
  test("warehouse:owner accept restock (status: ongoing · all received · new product · COD · 1 supplier): COD recorded in analytic metric", async ({
    page,
  }) => {
    test.fail(
      true,
      "🚧 unimplemented (docs/acceptances/inventory/restock.md) — liability keeps no metric, so no analytic metric records the COD",
    );

    const restock = ground.restocks["own-cx"];
    const productId = ground.products[caseSku("own", "cx")];

    await signIn(page, username("own"), ground.warehouse);
    await acceptWithCod(page, restock, COD_METRIC);

    // Restock by product, this week: ANY figure of the product's row reading the charge. Re-read until it lands.
    await test.step("then: COD recorded in analytic metric", async () => {
      await expect(async () => {
        await page.goto(`/analytic?g=product&m=${RESTOCK_METRIC}&r=7d&product=${productId}`);
        await expect(
          page.locator(`[data-testid^="analytic-cell-${productId}-"]`).filter({ hasText: rp(COD_METRIC) }),
        ).not.toHaveCount(0, { timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
    });
  });
});

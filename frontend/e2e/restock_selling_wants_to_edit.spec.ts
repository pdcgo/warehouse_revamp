import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick, ongoingOf, inboundRow } from "./restock_helpers";

// selling:all wants to edit a restock — split out of restock.spec.ts by its describe block (backlog #51), every test and title
// unchanged. Self-contained: the block seeds its own ground in beforeAll; the helpers live in restock_helpers.ts.

// ── selling:all wants to edit a restock — the checks behind docs/acceptances/inventory/restock.md ───────────────────────
//
// Every selling role edits through its own restock page and form. The restocks are the GIVEN, seeded through the API;
// each has its OWN paying account, so a balance read in one test is never moved by another test's events.
//
// (ongoing: edit product, change), (ongoing: edit product, add) and (ongoing: edit product, removed) are one test each per
// role, each THEN a step named as its row. The other two tests — an
// ongoing restock moved to another warehouse and account, and an arrived restock's count with a product added — predate
// the edit givens' rediscussion: they keep their old step names until their givens are tested by hand
// (ongoing: target warehouse, ongoing: paying account, arrived).
test.describe("selling:all wants to edit a restock", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  // The restocks seeded per role: "on" for (ongoing: edit product, change), "ad" for (ongoing: edit product, add), "rm"
  // for (ongoing: edit product, removed), and the two that predate the rediscussion.
  const CASES = [
    { cond: "ongoing", key: "on" },
    { cond: "ongoing: edit product, add", key: "ad" },
    { cond: "ongoing: edit product, removed", key: "rm" },
    { cond: "ongoing, moved to another warehouse and account", key: "mv" },
    { cond: "arrived", key: "ar" },
  ] as const;

  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  const username = (role: string) => `e2eedt${role}${SUFFIX}`;
  const W1_USER = `e2eedtwa${SUFFIX}`;
  const W2_USER = `e2eedtwb${SUFFIX}`;
  const W1_CODE = `EA${SUFFIX}`;
  const W2_CODE = `EB${SUFFIX}`;
  const SUPPLIER_NAME = `E2E Edt Supplier ${SUFFIX}`;
  // P is the restock's line; Q the product an arrived restock gains by the edit.
  const code = (role: string, kase: string, line: "P" | "Q") => `ED${role.toUpperCase()}${kase.toUpperCase()}${line}${SUFFIX}`;
  const at = (role: string, kase: string) => `${role}-${kase}`;

  const ground = {
    team: "",
    w1: "",
    w2: "",
    supplier: "",
    accounts: {} as Record<string, string>,
    // The account a moved restock moves to, per role.
    newAccounts: {} as Record<string, string>,
    restocks: {} as Record<string, string>,
    // Product id by product code — a line's note icon is named by its product.
    products: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Edt Seller ${SUFFIX}`, `ES${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.w1 = await team(`E2E Edt Warehouse A ${SUFFIX}`, W1_CODE, "TEAM_TYPE_WAREHOUSE");
    ground.w2 = await team(`E2E Edt Warehouse B ${SUFFIX}`, W2_CODE, "TEAM_TYPE_WAREHOUSE");

    const user = (teamId: string, name: string, role: string) =>
      api(page, "user.v1.UserService/CreateUser", { teamId, username: name, password: PASSWORD, name, role });
    for (const r of ROLES) await user(ground.team, username(r.key), r.role);
    await user(ground.w1, W1_USER, "ROLE_WAREHOUSE_STAFF");
    await user(ground.w2, W2_USER, "ROLE_WAREHOUSE_STAFF");

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: SUPPLIER_NAME })).supplier.id,
    );

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Edt Cat ${SUFFIX}` });
    const product = async (productCode: string) =>
      String(
        (
          await api(page, "product.v1.ProductService/ProductCreate", {
            teamId: ground.team,
            productCodePart: productCode,
            name: `E2E ${productCode}`,
            categoryId: category.category.id,
          })
        ).product.id,
      );

    const account = async (name: string, number: string) => {
      const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name,
        holderName: "E2E",
        accountNumber: number,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      });
      const id = String(created.account.id);
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId: ground.team,
        accountId: id,
        operational: true,
      });
      return id;
    };

    let n = 0;
    for (const r of ROLES) {
      ground.newAccounts[r.key] = await account(`E2E Edt New ${r.key} ${SUFFIX}`, `80${SUFFIX}${++n}`);

      for (const c of CASES) {
        const p = code(r.key, c.key, "P");
        const productId = await product(p);
        ground.products[p] = productId;
        const q = code(r.key, c.key, "Q");
        const qId = c.key === "ar" || c.key === "ad" || c.key === "rm" ? await product(q) : "";

        const accountId = await account(`E2E Edt ${r.key} ${c.key} ${SUFFIX}`, `80${SUFFIX}${++n}`);
        ground.accounts[at(r.key, c.key)] = accountId;

        // GIVEN — an ongoing restock of 10 × Rp 10.000 to warehouse A, one supplier, paid from its own account; the
        // removed case's also carries Q, 4 for Rp 40.000, to be taken off.
        const items = [{ productId, productCode: p, name: `E2E ${p}`, count: 10, total: 100_000, supplierId: ground.supplier }];
        if (c.key === "rm") {
          items.push({ productId: qId, productCode: q, name: `E2E ${q}`, count: 4, total: 40_000, supplierId: ground.supplier });
        }
        const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: ground.team,
          warehouseId: ground.w1,
          financeAccountId: accountId,
          receipt: `E2E-EDT-${r.key}-${c.key}-${SUFFIX}`.toUpperCase(),
          items,
        });
        const id = String(created.request.id);
        // …and for the arrived case, signed for by warehouse A.
        if (c.key === "ar") {
          await api(page, "inventory.v1.RestockRequestService/RestockRequestArrive", { teamId: ground.w1, requestId: id });
        }
        ground.restocks[at(r.key, c.key)] = id;
      }
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // An account's balance as its page shows it, once the line `text` is in its history — the create's payment, or the
  // edit's — so a read is never of an account an event has yet to reach.
  async function balanceOnceRecorded(page: Page, accountId: string, text: string): Promise<number> {
    let balance = 0;
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-log-table")).toContainText(text, { timeout: 2_000 });
      const shown = page.getByTestId("account-detail-balance");
      await expect(shown).toHaveText(/\d/, { timeout: 2_000 });
      balance = Number((await shown.innerText()).replace(/[^\d-]/g, ""));
    }).toPass({ timeout: 30_000 });
    return balance;
  }

  async function balanceIs(page: Page, accountId: string, expected: number) {
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(expected), { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  // (ongoing: edit product, change) — line 0 goes from 10 for Rp 100.000 to 12 for Rp 120.000, and gains a note.
  const LINE_NOTE = "two more at the same price";
  for (const r of ROLES) {
    test(`${r.given} edit restock (ongoing: edit product, change)`, async ({ page }) => {
      const id = ground.restocks[at(r.key, "on")];
      const account = ground.accounts[at(r.key, "on")];
      const p = code(r.key, "on", "P");

      await signIn(page, username(r.key), ground.team);
      const before = await balanceOnceRecorded(page, account, `Restock #${id}`);

      // WHEN — Edit on the restock's own page, as this role, while it is ongoing.
      await page.goto(`/inventories/restock/${id}`);
      await page.getByTestId(`restock-action-edit-${id}`).click();
      await expect(page.getByTestId("restock-edit-page")).toBeVisible();
      await page.getByTestId("restock-qty-0").fill("12");
      await page.getByTestId("restock-total-price-0").fill("120000");
      await page.getByTestId("restock-line-0-note").fill(LINE_NOTE);
      // The courier is asked for while the parcel is open (the-courier-is-required-on-the-form); the seed named none.
      await page.getByTestId("restock-courier").getByRole("combobox").click();
      await page.getByTestId("shipment-channel-option-jne").click();
      await expect(page.getByTestId("restock-form-ready")).toBeVisible();
      await page.getByTestId("submit-restock").click();
      await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));

      // THEN — as the seller. The note is an icon at the end of the product, its words in its name.
      await test.step("then: restock shows new count, total and note", async () => {
        await page.getByTestId("section-nav-products").click();
        const products = page.getByTestId("restock-detail-products");
        await expect.soft(products).toContainText("12");
        await expect.soft(products).toContainText("120.000");
        await expect
          .soft(page.getByTestId(`restock-detail-line-note-${ground.products[p]}`))
          .toHaveAttribute("aria-label", new RegExp(LINE_NOTE));
      });

      await test.step("then: ongoing total adjusted (from 10 to 12)", async () => {
        await expect.soft(await ongoingOf(page, p)).toHaveText("12");
      });

      await test.step(`then: paying account balance adjusted (decrease/increase) (by ${rupiah(20_000)})`, async () => {
        await expect.soft(async () => balanceIs(page, account, before - 20_000)).toPass({ timeout: 35_000 });
      });

      await test.step("then: edit recorded in account history", async () => {
        await page.goto(`/financial-accounts/${account}`);
        await expect.soft(page.getByTestId("account-log-table")).toContainText(`Restock #${id} edited`);
      });

      // THEN — as the warehouse it goes to: its inbound row sizes the box anew.
      await signIn(page, W1_USER, ground.w1);
      await test.step("then: total warehouse receive changes", async () => {
        await expect.soft(await inboundRow(page, id)).toContainText("1 product · 12 pcs");
      });
    });

    // (ongoing: edit product, add) — the restock of 10 × P for Rp 100.000 gains 5 × Q for Rp 50.000. Q follows the
    // restock's one supplier, which an edit opens as the supplier for every product.
    test(`${r.given} edit restock (ongoing: edit product, add)`, async ({ page }) => {
      const id = ground.restocks[at(r.key, "ad")];
      const account = ground.accounts[at(r.key, "ad")];
      const p = code(r.key, "ad", "P");
      const q = code(r.key, "ad", "Q");

      await signIn(page, username(r.key), ground.team);
      const before = await balanceOnceRecorded(page, account, `Restock #${id}`);

      // WHEN — Edit on the restock's own page, as this role, while it is ongoing: Q ticked beside P.
      await page.goto(`/inventories/restock/${id}`);
      await page.getByTestId(`restock-action-edit-${id}`).click();
      await expect(page.getByTestId("restock-edit-page")).toBeVisible();
      await page.getByTestId("restock-pick-products").click();
      await tick(page, q);
      await page.getByTestId("product-picker-confirm").click();
      await page.getByTestId("restock-qty-1").fill("5");
      await page.getByTestId("restock-total-price-1").fill("50000");
      // The courier is asked for while the parcel is open (the-courier-is-required-on-the-form); the seed named none.
      await page.getByTestId("restock-courier").getByRole("combobox").click();
      await page.getByTestId("shipment-channel-option-jne").click();
      await expect(page.getByTestId("restock-form-ready")).toBeVisible();
      await page.getByTestId("submit-restock").click();
      await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));

      // THEN — as the seller.
      await test.step("then: new product added", async () => {
        await page.getByTestId("section-nav-products").click();
        const products = page.getByTestId("restock-detail-products");
        await expect.soft(products).toContainText(q);
        await expect.soft(products).toContainText(p);
      });

      await test.step("then: ongoing total adjusted (Q from 0 to 5, P still 10)", async () => {
        await expect.soft(await ongoingOf(page, q)).toHaveText("5");
        await expect.soft(await ongoingOf(page, p)).toHaveText("10");
      });

      await test.step(`then: paying account balance adjusted (decrease) (by ${rupiah(50_000)})`, async () => {
        await expect.soft(async () => balanceIs(page, account, before - 50_000)).toPass({ timeout: 35_000 });
      });

      await test.step("then: edit recorded in account history", async () => {
        await page.goto(`/financial-accounts/${account}`);
        await expect.soft(page.getByTestId("account-log-table")).toContainText(`Restock #${id} edited`);
      });

      // THEN — as the warehouse it goes to.
      await signIn(page, W1_USER, ground.w1);
      await test.step("then: total warehouse receive changes", async () => {
        await expect.soft(await inboundRow(page, id)).toContainText("2 products · 15 pcs");
      });
    });

    // (ongoing: edit product, removed) — the restock of 10 × P and 4 × Q (Rp 100.000 + Rp 40.000) loses Q.
    test(`${r.given} edit restock (ongoing: edit product, removed)`, async ({ page }) => {
      const id = ground.restocks[at(r.key, "rm")];
      const account = ground.accounts[at(r.key, "rm")];
      const p = code(r.key, "rm", "P");
      const q = code(r.key, "rm", "Q");

      await signIn(page, username(r.key), ground.team);
      const before = await balanceOnceRecorded(page, account, `Restock #${id}`);

      // WHEN — Edit on the restock's own page, as this role, while it is ongoing: Q unticked in the picker.
      await page.goto(`/inventories/restock/${id}`);
      await page.getByTestId(`restock-action-edit-${id}`).click();
      await expect(page.getByTestId("restock-edit-page")).toBeVisible();
      await page.getByTestId("restock-pick-products").click();
      await tick(page, q, false);
      await page.getByTestId("product-picker-confirm").click();
      await expect(page.getByTestId("restock-line-1")).toHaveCount(0);
      // The courier is asked for while the parcel is open (the-courier-is-required-on-the-form); the seed named none.
      await page.getByTestId("restock-courier").getByRole("combobox").click();
      await page.getByTestId("shipment-channel-option-jne").click();
      await expect(page.getByTestId("restock-form-ready")).toBeVisible();
      await page.getByTestId("submit-restock").click();
      await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));

      // THEN — as the seller.
      await test.step("then: product removed", async () => {
        await page.getByTestId("section-nav-products").click();
        const products = page.getByTestId("restock-detail-products");
        await expect.soft(products).toContainText(p);
        await expect.soft(products).not.toContainText(q);
      });

      // Q comes off Ongoing — a dash or a 0, whichever the picker draws for none — and P keeps its 10.
      await test.step("then: ongoing total adjusted (Q from 4 to none, P still 10)", async () => {
        await expect.soft(await ongoingOf(page, q)).toHaveText(/^(0|—)$/);
        await expect.soft(await ongoingOf(page, p)).toHaveText("10");
      });

      await test.step(`then: paying account balance adjusted (increase) (by ${rupiah(40_000)})`, async () => {
        await expect.soft(async () => balanceIs(page, account, before + 40_000)).toPass({ timeout: 35_000 });
      });

      await test.step("then: edit recorded in account history", async () => {
        await page.goto(`/financial-accounts/${account}`);
        await expect.soft(page.getByTestId("account-log-table")).toContainText(`Restock #${id} edited`);
      });

      // THEN — as the warehouse it goes to.
      await signIn(page, W1_USER, ground.w1);
      await test.step("then: total warehouse receive changes", async () => {
        await expect.soft(await inboundRow(page, id)).toContainText("1 product · 10 pcs");
      });
    });
  }

  // The two tests that predate the edit givens' rediscussion (see the block's head).
  for (const c of CASES.filter((k) => k.key === "mv" || k.key === "ar")) {
    for (const r of ROLES) {
      test(`${r.given} edit (${c.cond})`, async ({ page }) => {
        const id = ground.restocks[at(r.key, c.key)];
        const account = ground.accounts[at(r.key, c.key)];
        const p = code(r.key, c.key, "P");
        const q = code(r.key, c.key, "Q");

        await signIn(page, username(r.key), ground.team);
        const before = await balanceOnceRecorded(page, account, `Restock #${id}`);
        const beforeNew = c.key === "mv" ? await balanceOnceRecorded(page, ground.newAccounts[r.key], "") : 0;

        // WHEN — from the restock's own page, as this role: Edit while ongoing, Edit Lines once it has arrived (only the
        // lines can change then).
        await page.goto(`/inventories/restock/${id}`);
        await page.getByTestId(c.key === "ar" ? `restock-action-edit-lines-${id}` : `restock-action-edit-${id}`).click();
        await expect(page.getByTestId("restock-edit-page")).toBeVisible();

        if (c.key === "ar") {
          await page.getByTestId("restock-qty-0").fill("12");
          await page.getByTestId("restock-total-price-0").fill("120000");
        }

        if (c.key === "mv") {
          await page.getByTestId("restock-warehouse").locator("input").fill(W2_CODE);
          await page.getByTestId(`team-select-option-${W2_CODE}`).click();
          await page.getByTestId("restock-finance-account").click();
          await page.getByTestId(`restock-finance-account-option-${ground.newAccounts[r.key]}`).click();
        }

        if (c.key === "ar") {
          // A product added after the box arrived names its own supplier and says why (a-line-added-after-arrival-names-its-supplier).
          await page.getByTestId("restock-pick-products").click();
          await tick(page, q);
          await page.getByTestId("product-picker-confirm").click();
          await page.getByTestId("restock-line-1-picker-trigger").click();
          const dialog = page.getByTestId("restock-line-1-picker-dialog");
          await dialog.getByTestId("restock-line-1-picker-search").fill(SUPPLIER_NAME);
          await dialog.getByTestId(`restock-line-1-picker-supplier-${ground.supplier}`).click();
          await dialog.getByTestId("restock-line-1-picker-confirm").click();
          await page.getByTestId("restock-qty-1").fill("5");
          await page.getByTestId("restock-total-price-1").fill("50000");
          await page.getByTestId("restock-line-1-note").fill("added after the box arrived");
        } else {
          // The courier is asked for while the parcel is open (the-courier-is-required-on-the-form); the seed named none.
          await page.getByTestId("restock-courier").getByRole("combobox").click();
          await page.getByTestId("shipment-channel-option-jne").click();
        }

        await expect(page.getByTestId("restock-form-ready")).toBeVisible();
        await page.getByTestId("submit-restock").click();
        await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));

        // THEN — as the seller.
        if (c.key === "ar") {
          await test.step("then: restock shows changed lines", async () => {
            await page.getByTestId("section-nav-products").click();
            await expect.soft(page.getByTestId("restock-detail-products")).toContainText("12");
          });
          await test.step("then: restock shows added product", async () => {
            await expect.soft(page.getByTestId("restock-detail-products")).toContainText(q);
          });
        }

        if (c.key === "ar") {
          await test.step("then: ongoing stock follows new count", async () => {
            await expect.soft(await ongoingOf(page, p)).toContainText("12");
            await expect.soft(await ongoingOf(page, q)).toContainText("5");
          });

          const paid = 20_000 + 50_000;
          await test.step(`then: paying account balance follows difference (by ${rupiah(paid)})`, async () => {
            await expect.soft(async () => balanceIs(page, account, before - paid)).toPass({ timeout: 35_000 });
          });
          await test.step("then: edit recorded in account history", async () => {
            await page.goto(`/financial-accounts/${account}`);
            await expect.soft(page.getByTestId("account-log-table")).toContainText(`Restock #${id} edited`);
          });
        }

        if (c.key === "mv") {
          await test.step("then: payment moves to new account", async () => {
            await expect.soft(async () => balanceIs(page, account, before + 100_000)).toPass({ timeout: 35_000 });
            await expect.soft(async () => balanceIs(page, ground.newAccounts[r.key], beforeNew - 100_000)).toPass({
              timeout: 35_000,
            });
          });
        }

        // THEN — as the warehouses.
        if (c.key === "ar") {
          await signIn(page, W1_USER, ground.w1);
          await test.step("then: target warehouse sees new lines", async () => {
            await expect.soft(await inboundRow(page, id)).toContainText("2 products · 17 pcs");
          });
        }

        if (c.key === "mv") {
          await signIn(page, W2_USER, ground.w2);
          await test.step("then: recorded at new warehouse", async () => {
            await expect.soft(await inboundRow(page, id)).toBeVisible();
          });
          await signIn(page, W1_USER, ground.w1);
          await test.step("then: removed from old warehouse", async () => {
            await expect.soft(await inboundRow(page, id)).toHaveCount(0);
          });
        }
      });
    }
  }
});

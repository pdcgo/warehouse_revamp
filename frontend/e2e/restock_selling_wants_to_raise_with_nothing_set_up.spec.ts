import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page, Request } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, tick } from "./restock_helpers";
import { pickTeam } from "./pickers";

// selling wants to restock with nothing set up to pick from — docs/acceptances/inventory/restock.md givens 15–19 of
// *create restock* (#144). Split from restock_selling_wants_to_raise.spec.ts, the same WHEN's spec, to keep each file
// under the ~450 s a spec may take alone (the two together ran 321 s, and 549 s on a loaded machine). Self-contained:
// each given's describe seeds its own ground in beforeAll.

// ── #144 — THE FORM'S HELPERS POINT TO WHAT IS MISSING (create restock, givens 15–19) ───────────────────────────────────
//
// docs/acceptances/inventory/restock.md givens 15–19, behind restock_decision.md's
// the-supplier-popup-points-to-create-supplier-when-none-exists, the-account-box-points-to-the-accounts-page and
// a-helper-link-opens-a-new-tab, and the 🔄 on the-checks-run-products-warehouse-account-resi (a supplier is optional —
// given 15's *restock created without a supplier*). Every given and role is a selling team of its OWN — the account box
// and the supplier list are read per team — holding one product, with a warehouse of the given's own to restock into. The
// person signs in through the form and opens the restock form from the list's own door.
//
// ⚠ GIVEN 15's EMPTINESS IS STUBBED. The popup lists EVERY team's suppliers (SupplierList with the EVERY_TEAM scope —
// a-line-connects-to-any-teams-supplier-from-a-popup), and the run's database is shared: the global setup and the other
// specs of the batch make suppliers, so "no supplier in any team" cannot be made real. For the given's part the popup's
// read is answered EMPTY by `page.route` (the RPC's own JSON: no items, no ids, a page of 0) and let go before the person
// comes back to the form, so the supplier made in the new tab is read for real.
//
// BACK ON THE FORM (a-helper-link-opens-a-new-tab): the helper opens its page in a NEW TAB, and the form's picker reads
// its list again on `visibilitychange` while that list is still empty (api/rereadOnReturn.ts — TanStack's focusManager
// listens for it on window). `backOnTheForm` closes the tab and brings the form's page to the front; when headless
// Chromium sends no visibilitychange for that (the form's page never went hidden), it fires the event the browser would
// fire — at document, bubbling — and records which of the two it needed in the test's annotations.
const H_PASSWORD = "e2e-rs144-pass-1";
type HelpRole = { given: string; role: string; key: string; letter: string };
const H_OWNER: HelpRole = { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own", letter: "O" };
const H_ADMIN: HelpRole = { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm", letter: "A" };
const H_CS: HelpRole = { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs", letter: "C" };

// The givens' cases, verbatim from restock.md — the marking script finds the tests by them.
const C15 = "1 product · 1 warehouse · operational account · no supplier in any team";
const C16 = "1 product · 1 warehouse · operational account · other teams have suppliers · none of its own";
const C17 = "1 product · 1 warehouse · no account";
const C18 = "1 product · 1 warehouse · accounts · none operational";
const C19 = "1 product · 1 warehouse · no operational account";

const SUPPLIER_LIST = "**/warehouse.supplier.v1.SupplierService/SupplierList";
const ACCOUNTS = "financial_account.v1.FinancialAccountService";

type HelpAccount = { id: string; name: string };
type HelpTeam = { team: string; name: string; user: string; product: string; productId: string; accounts: HelpAccount[] };
type HelpGround = { whCode: string; teams: Record<string, HelpTeam> };

// A team code is at most 10 characters: "VH", the given's letter (15 A … 19 E), the role's letter (W the warehouse, V
// another team), the 6-digit SUFFIX — no other SUFFIX importer's codes start "VH".
const helpCode = (g: string, letter: string) => `VH${g}${letter}${SUFFIX}`;
const helpToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// An account of `teamId`, opened today, with the caller's token — root's in a ground, the role's in the helper's tab.
async function helpAccount(page: Page, teamId: string, name: string, accountNumber: string): Promise<string> {
  const made = await api(page, `${ACCOUNTS}/FinancialAccountCreate`, {
    teamId,
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name,
    holderName: "E2E",
    accountNumber,
    openingBalance: 1_000_000,
    openingOn: helpToday(),
  });

  return String(made.account.id);
}

// The given's ground (root, once per given): its warehouse and, per role, a selling team with the role's person, one
// product and `accounts.count` accounts — marked operational when `accounts.operational`.
async function helpGround(
  browser: Browser,
  g: string,
  roles: HelpRole[],
  accounts: { count: number; operational: boolean },
): Promise<HelpGround> {
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const whCode = helpCode(g, "W");
  await team(`E2E RS144 Warehouse ${g} ${SUFFIX}`, whCode, "TEAM_TYPE_WAREHOUSE");
  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E RS144 Cat ${g} ${SUFFIX}` });

  const teams: Record<string, HelpTeam> = {};
  for (const r of roles) {
    const name = `E2E RS144 Seller ${g}${r.letter} ${SUFFIX}`;
    const teamId = await team(name, helpCode(g, r.letter), "TEAM_TYPE_SELLING");
    const user = `e2ers144${g.toLowerCase()}${r.key}${SUFFIX}`;
    await api(page, "user.v1.UserService/CreateUser", { teamId, username: user, password: H_PASSWORD, name: user, role: r.role });

    const product = `VH${g}${r.letter}P${SUFFIX}`;
    const made = await api(page, "product.v1.ProductService/ProductCreate", {
      teamId,
      productCodePart: product,
      name: `E2E ${product}`,
      categoryId: category.category.id,
    });

    const owned: HelpAccount[] = [];
    for (let n = 1; n <= accounts.count; n++) {
      const accountName = `E2E RS144 ${g}${r.letter}${n} ${SUFFIX}`;
      const id = await helpAccount(page, teamId, accountName, `E2E-RS144-${g}${r.letter}${n}-${SUFFIX}`);
      if (accounts.operational) {
        await api(page, `${ACCOUNTS}/FinancialAccountOperationalSet`, { teamId, accountId: id, operational: true });
      }
      owned.push({ id, name: accountName });
    }

    teams[r.key] = { team: teamId, name, user, product, productId: String(made.product.id), accounts: owned };
  }

  await page.close();
  return { whCode, teams };
}

// The role signs in (the form — remember me, so a new tab of the context is signed in too) and works in its own team.
async function helpSignIn(page: Page, t: HelpTeam) {
  await login(page, t.user, H_PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), t.team);
}

// The form, from the list's own door, with the given's one product (3 pcs for Rp 30.000) and its warehouse.
async function helpForm(page: Page, t: HelpTeam, whCode: string) {
  await page.goto("/inventories/restock");
  await page.getByTestId("open-create-restock").or(page.getByTestId("open-create-restock-empty")).first().click();
  await expect(page).toHaveURL(/\/inventories\/restock\/new$/);

  await page.getByTestId("restock-pick-products").click();
  await tick(page, t.product);
  await page.getByTestId("product-picker-confirm").click();
  await page.getByTestId("restock-qty-0").fill("3");
  await page.getByTestId("restock-total-price-0").fill("30000");
  await pickTeam(page, page.getByTestId("restock-warehouse"), whCode);
}

// What the person typed on the form — read before the helper's tab and again after it.
async function helpTyped(page: Page) {
  return {
    lines: await page.getByTestId(/^restock-line-\d+$/).count(),
    qty: await page.getByTestId("restock-qty-0").inputValue(),
    total: await page.getByTestId("restock-total-price-0").inputValue(),
    warehouse: await page.getByTestId("restock-warehouse").locator("input").inputValue(),
  };
}

// A helper link: it opens its page in a NEW tab of the same context (noopener — no `popup` event), the form left where
// it was.
async function followHelper(page: Page, link: Locator, path: RegExp): Promise<Page> {
  await expect(link).toHaveAttribute("target", "_blank");
  const opened = page.context().waitForEvent("page");
  await link.click();
  const tab = await opened;
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(path);
  await expect(page).toHaveURL(/\/inventories\/restock\/new$/);

  return tab;
}

// The person leaves the helper's tab and is back on the form: the picker's list is read again (`rpc`) — see the block's
// note for how the return is made.
async function backOnTheForm(page: Page, tab: Page, rpc: string): Promise<void> {
  const reread = (timeout: number) =>
    page
      .waitForRequest((req: Request) => req.method() === "POST" && req.url().endsWith(rpc), { timeout })
      .then(
        () => true,
        () => false,
      );

  const onReturn = reread(3_000);
  await tab.close();
  await page.bringToFront();
  let how = "on the tab's close and bringToFront alone";
  if (!(await onReturn)) {
    const onEvent = reread(10_000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    expect(await onEvent, `${rpc} read again on return`).toBe(true);
    how = "only once visibilitychange was fired on the form's page (bringToFront sent none)";
  }
  test.info().annotations.push({ type: "re-read on return", description: `${rpc} — ${how}` });
  console.log(`[rs144] re-read on return — ${rpc} — ${how}`);
}

// `restock-finance-account-open` — Open Financial Accounts, in a NEW tab, on the role's own team.
async function openAccountsTab(page: Page, t: HelpTeam): Promise<Page> {
  const link = page.getByTestId("restock-finance-account-open");
  await expect(link).toContainText("Open Financial Accounts");
  await expect(link).toHaveAttribute("href", "/financial-accounts");
  const tab = await followHelper(page, link, /\/financial-accounts$/);
  await expect(tab.getByTestId("financial-accounts-page")).toBeVisible();
  await expect(tab.getByTestId("team-switcher")).toContainText(t.name);

  return tab;
}

// On the accounts page (the helper's tab), as the role: the row menu's Mark Operational, confirmed.
async function markOnThePage(tab: Page, a: HelpAccount) {
  await expect(tab.getByTestId("financial-accounts-table")).toBeVisible();
  await tab.getByTestId(`account-actions-${a.id}`).click();
  await tab.getByTestId(`account-mark-operational-${a.id}`).click();
  const confirm = tab.getByRole("alertdialog", { name: `Mark ${a.name} as Operational` });
  await expect(confirm).toBeVisible();
  const answered = tab.waitForResponse((res) => res.url().endsWith(`${ACCOUNTS}/FinancialAccountOperationalSet`));
  await confirm.getByTestId("confirm-action").click();
  expect((await answered).status()).toBe(200);
  await expect(tab.getByTestId(`account-operational-${a.id}`)).toBeVisible();
}

// Back on the form: the account now operational is offered — the only one, so pre-picked (the form's autoPickSingle) —
// `notOffered` are not, and the box's helper is gone.
async function accountOnReturn(page: Page, a: HelpAccount, notOffered: HelpAccount[]) {
  const select = page.getByTestId("restock-finance-account");
  await expect(select).toContainText(a.name);
  await expect(page.getByTestId("restock-finance-account-missing")).toHaveCount(0);
  await select.click();
  await expect(page.getByTestId(`restock-finance-account-option-${a.id}`)).toBeVisible();
  for (const o of notOffered) {
    await expect(page.getByTestId(`restock-finance-account-option-${o.id}`)).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
}

// Given 15 — no supplier anywhere: both popups (the card's Choose Supplier, the product's) link to the suppliers page;
// the supplier made there is listed on the way back and picked, with the line as typed; and the restock is raised with
// no supplier at all. CS cannot create a supplier (supplier manage: the owner and admin do) — it is led to the page all
// the same (the decision's note), so for CS the supplier is made meanwhile by somebody who may (root, for the spec).
test.describe(`selling:all wants to restock (${C15})`, () => {
  test.describe.configure({ timeout: 120_000 });
  const ROLES = [H_OWNER, H_ADMIN, H_CS];
  let ground: HelpGround;

  test.beforeAll(async ({ browser }) => {
    ground = await helpGround(browser, "A", ROLES, { count: 1, operational: true });
  });

  for (const r of ROLES) {
    test(`${r.given} create restock (${C15})`, async ({ page, browser }) => {
      const t = ground.teams[r.key]!;
      const supplierName = `E2E RS144 New Supplier ${r.key} ${SUFFIX}`;
      await helpSignIn(page, t);

      // THE GIVEN — no supplier in any team: the popup's every-team read answered empty (see the block's note); any
      // other supplier read goes through.
      let held = 0;
      await page.route(SUPPLIER_LIST, async (route) => {
        const req = route.request();
        if (req.method() !== "POST" || !(req.postData() ?? "").includes("SUPPLIER_LIST_SCOPE_EVERY_TEAM")) {
          await route.continue();
          return;
        }
        held += 1;
        await route.fulfill({
          status: 200,
          headers: { "access-control-allow-origin": req.headers()["origin"] ?? "*", vary: "Origin" },
          contentType: "application/json",
          body: JSON.stringify({ items: [], ids: [], pageInfo: { currentPage: 1, totalPage: 0, totalItems: "0" } }),
        });
      });

      await helpForm(page, t, ground.whCode);
      // Its one operational account, pre-picked.
      await expect(page.getByTestId("restock-finance-account")).toContainText(t.accounts[0]!.name);

      await test.step("then: supplier popup links to Create Supplier", async () => {
        // The product's popup, then the card's — the card's stays open for the next then.
        for (const p of ["restock-line-0-picker", "restock-all-supplier-picker"]) {
          await page.getByTestId(`${p}-trigger`).click();
          await expect(page.getByTestId(`${p}-dialog`)).toBeVisible();
          await expect(page.getByTestId(`${p}-empty`)).toHaveText("No suppliers yet.");
          await expect(page.getByTestId(`${p}-create-supplier-help`)).toBeVisible();
          const link = page.getByTestId(`${p}-create-supplier`);
          await expect(link).toHaveText("Create Supplier");
          await expect(link).toHaveAttribute("href", "/inventories/suppliers");
          await expect(link).toHaveAttribute("target", "_blank");
          if (p === "restock-line-0-picker") {
            await page.getByTestId(`${p}-cancel`).click();
            await expect(page.getByTestId(`${p}-dialog`)).toBeHidden();
          }
        }
        expect(held, "the popup's read was the stub's").toBeGreaterThan(0);
      });

      await test.step("then: back on the form, new supplier can be picked, lines kept", async () => {
        const before = await helpTyped(page);
        const tab = await followHelper(
          page,
          page.getByTestId("restock-all-supplier-picker-create-supplier"),
          /\/inventories\/suppliers$/,
        );
        await expect(tab.getByTestId("suppliers-page")).toBeVisible();

        let supplierId: string;
        if (r.key === "cs") {
          const root = await browser.newPage();
          await login(root, ROOT_USERNAME, ROOT_PASSWORD);
          const made = await api(root, "supplier.v1.SupplierService/SupplierCreate", { teamId: t.team, name: supplierName });
          supplierId = String(made.supplier.id);
          await root.close();
        } else {
          // Through the suppliers page's own form, in the helper's tab.
          await tab.getByTestId("open-create-supplier-empty").or(tab.getByTestId("open-create-supplier")).first().click();
          await tab.getByTestId("supplier-name").fill(supplierName);
          const made = tab.waitForResponse((res) => res.url().endsWith("SupplierService/SupplierCreate"));
          await tab.getByTestId("submit-supplier").click();
          const res = await made;
          expect(res.status()).toBe(200);
          supplierId = String((await res.json()).supplier.id);
          await expect(tab.locator('[data-testid^="supplier-row-"]', { hasText: supplierName })).toBeVisible();
        }

        // The given let go: the popup's next read is the server's.
        await page.unroute(SUPPLIER_LIST);
        await backOnTheForm(page, tab, "SupplierService/SupplierList");

        // The card's popup, still open, has read again with nothing typed: every team's suppliers, no helper.
        const p = "restock-all-supplier-picker";
        await expect(page.getByTestId(`${p}-suppliers`)).toBeVisible();
        await expect(page.getByTestId(`${p}-empty`)).toHaveCount(0);
        await expect(page.getByTestId(`${p}-create-supplier-help`)).toHaveCount(0);

        // The new one, picked — it keeps no store, so "no store" is chosen for it and Connect is live.
        await page.getByTestId(`${p}-search`).fill(supplierName);
        await page.getByTestId(`${p}-supplier-${supplierId}`).click();
        await page.getByTestId(`${p}-confirm`).click();
        await expect(page.getByTestId("restock-all-supplier-shown")).toContainText(supplierName);
        await expect(page.getByTestId("restock-line-0-supplier-shown")).toContainText(supplierName);

        // …and the form as it was typed.
        expect(await helpTyped(page)).toEqual(before);
        await expect(page.getByTestId("restock-line-0")).toContainText(t.product);
      });

      await test.step("then: restock created without a supplier", async () => {
        // The supplier taken off again: the product names none.
        await page.getByTestId("restock-all-supplier-clear").click();
        await expect(page.getByTestId("restock-all-supplier-none")).toHaveText("Not chosen yet");
        await expect(page.getByTestId("restock-line-0-supplier-shown")).toHaveText("Not chosen yet");

        await page.getByTestId("restock-courier").getByRole("combobox").click();
        await page.getByTestId("shipment-channel-option-jne").click();
        await page.getByTestId("restock-receipt").fill(`E2E-RS144-A${r.letter}-${SUFFIX}`);

        // Ready as it stands — nothing asks for a supplier.
        await expect(page.getByTestId("restock-form-ready")).toBeVisible();
        const created = page.waitForResponse((res) => res.url().endsWith("RestockRequestService/RestockRequestCreate"));
        await page.getByTestId("submit-restock").click();
        const res = await created;
        expect(res.status()).toBe(200);
        const sent = res.request().postDataJSON() as { items: { supplierId?: string }[] };
        expect(sent.items).toHaveLength(1);
        expect(String(sent.items[0]!.supplierId ?? "0")).toBe("0");
        const restockId = String((await res.json()).request.id);
        await expect(page).toHaveURL(/\/inventories\/restock$/);

        // Read back as the role: its one line, no supplier…
        const detail = (
          await api(page, "inventory.v1.RestockRequestService/RestockRequestDetail", { teamId: t.team, requestId: restockId })
        ).request as { items: { productId: string; supplierId?: string }[] };
        expect(detail.items).toHaveLength(1);
        expect(String(detail.items[0]!.productId)).toBe(t.productId);
        expect(String(detail.items[0]!.supplierId ?? "0")).toBe("0");

        // …and on the restock's own page: connected to no supplier.
        await page.goto(`/inventories/restock/${restockId}`);
        await page.getByTestId("section-nav-products").click();
        await expect(page.getByTestId(`restock-detail-supplier-${t.productId}`)).toHaveText("Not connected to a supplier");
      });
    });
  }
});

// Given 16 — another team's supplier, none of the team's own: both popups list it under the team that keeps it, and
// neither offers the helper (it shows only when there is nothing to list anywhere).
test.describe(`selling:all wants to restock (${C16})`, () => {
  test.describe.configure({ timeout: 120_000 });
  const ROLES = [H_OWNER, H_ADMIN, H_CS];
  let ground: HelpGround;
  const other = { team: "", name: `E2E RS144 Other Team ${SUFFIX}`, supplier: "", supplierName: `E2E RS144 Other Supplier ${SUFFIX}` };

  test.beforeAll(async ({ browser }) => {
    ground = await helpGround(browser, "B", ROLES, { count: 1, operational: true });

    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    other.team = String(
      (
        await api(page, "team.v1.TeamService/TeamCreate", {
          name: other.name,
          teamCode: helpCode("B", "V"),
          type: "TEAM_TYPE_SELLING",
          ownerUserId: ROOT_USER_ID,
        })
      ).team.id,
    );
    other.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: other.team, name: other.supplierName })).supplier.id,
    );
    await page.close();
  });

  for (const r of ROLES) {
    test(`${r.given} create restock (${C16})`, async ({ page }) => {
      const t = ground.teams[r.key]!;
      await helpSignIn(page, t);
      await helpForm(page, t, ground.whCode);

      await test.step("then: no helper, other teams' suppliers listed", async () => {
        for (const p of ["restock-all-supplier-picker", "restock-line-0-picker"]) {
          await page.getByTestId(`${p}-trigger`).click();
          // Nothing typed: every team's suppliers, page one — none of them the team's own — and no helper.
          const list = page.getByTestId(`${p}-suppliers`);
          await expect(list).toBeVisible();
          await expect(list.locator(`[data-testid^="${p}-supplier-"]:not([data-testid$="-stores"])`).first()).toBeVisible();
          await expect(list).not.toContainText("Your team");
          await expect(page.getByTestId(`${p}-empty`)).toHaveCount(0);
          await expect(page.getByTestId(`${p}-create-supplier-help`)).toHaveCount(0);

          // The other team's supplier, found by its name, under the team that keeps it.
          await page.getByTestId(`${p}-search`).fill(other.supplierName);
          const row = page.getByTestId(`${p}-supplier-${other.supplier}`);
          await expect(row).toBeVisible();
          await expect(row).toContainText(other.supplierName);
          await expect(row).toContainText(other.name);
          await expect(page.getByTestId(`${p}-create-supplier-help`)).toHaveCount(0);

          await page.getByTestId(`${p}-cancel`).click();
          await expect(page.getByTestId(`${p}-dialog`)).toBeHidden();
        }
      });
    });
  }
});

// Given 17 — no account at all: the box says to create one and mark it, links to Financial Accounts in a new tab; the
// account made there (the role's own token) and marked on the page's row menu is offered on the way back, the line kept.
test.describe(`selling owner · admin wants to restock (${C17})`, () => {
  test.describe.configure({ timeout: 120_000 });
  const ROLES = [H_OWNER, H_ADMIN];
  let ground: HelpGround;

  test.beforeAll(async ({ browser }) => {
    ground = await helpGround(browser, "C", ROLES, { count: 0, operational: false });
  });

  for (const r of ROLES) {
    test(`${r.given} create restock (${C17})`, async ({ page }) => {
      const t = ground.teams[r.key]!;
      await helpSignIn(page, t);
      await helpForm(page, t, ground.whCode);
      let tab: Page | undefined;

      await test.step("then: account box says create one and mark it operational", async () => {
        await expect(page.getByTestId("restock-finance-account")).toContainText("No operational account");
        await expect(page.getByTestId("restock-finance-account-missing")).toHaveAttribute("data-case", "none");
        await expect(page.getByTestId("restock-finance-account-missing-text")).toHaveText(
          "No account yet — create one and mark it operational.",
        );
      });

      await test.step("then: link opens Financial Accounts", async () => {
        tab = await openAccountsTab(page, t);
      });

      await test.step("then: back on the form, new account can be picked, lines kept", async () => {
        const before = await helpTyped(page);
        const made: HelpAccount = { id: "", name: `E2E RS144 C${r.letter} New ${SUFFIX}` };
        made.id = await helpAccount(tab!, t.team, made.name, `E2E-RS144-C${r.letter}N-${SUFFIX}`);
        await tab!.reload();
        await markOnThePage(tab!, made);

        await backOnTheForm(page, tab!, `${ACCOUNTS}/FinancialAccountList`);
        await accountOnReturn(page, made, []);
        expect(await helpTyped(page)).toEqual(before);
        await expect(page.getByTestId("restock-line-0")).toContainText(t.product);
      });
    });
  }
});

// Given 18 — two accounts, neither operational: the box says to mark one, links to Financial Accounts in a new tab; the
// one marked there is offered on the way back (the other is not), the line kept.
test.describe(`selling owner · admin wants to restock (${C18})`, () => {
  test.describe.configure({ timeout: 120_000 });
  const ROLES = [H_OWNER, H_ADMIN];
  let ground: HelpGround;

  test.beforeAll(async ({ browser }) => {
    ground = await helpGround(browser, "D", ROLES, { count: 2, operational: false });
  });

  for (const r of ROLES) {
    test(`${r.given} create restock (${C18})`, async ({ page }) => {
      const t = ground.teams[r.key]!;
      const [marked, unmarked] = [t.accounts[0]!, t.accounts[1]!];
      await helpSignIn(page, t);
      await helpForm(page, t, ground.whCode);
      let tab: Page | undefined;

      await test.step("then: account box says mark one operational", async () => {
        await expect(page.getByTestId("restock-finance-account")).toContainText("No operational account");
        await expect(page.getByTestId("restock-finance-account-missing")).toHaveAttribute("data-case", "unmarked");
        await expect(page.getByTestId("restock-finance-account-missing-text")).toHaveText(
          "No account marked operational — mark one.",
        );
      });

      await test.step("then: link opens Financial Accounts", async () => {
        tab = await openAccountsTab(page, t);
      });

      await test.step("then: back on the form, account marked operational can be picked, lines kept", async () => {
        const before = await helpTyped(page);
        await markOnThePage(tab!, marked);

        await backOnTheForm(page, tab!, `${ACCOUNTS}/FinancialAccountList`);
        await accountOnReturn(page, marked, [unmarked]);
        expect(await helpTyped(page)).toEqual(before);
        await expect(page.getByTestId("restock-line-0")).toContainText(t.product);
      });
    });
  }
});

// Given 19 — CS, no operational account (one, unmarked): the box asks CS to turn to the owner or admin, and links nowhere
// (making and marking an account is admin and up).
test.describe(`selling:cs wants to restock (${C19})`, () => {
  test.describe.configure({ timeout: 120_000 });
  const ROLES = [H_CS];
  let ground: HelpGround;

  test.beforeAll(async ({ browser }) => {
    ground = await helpGround(browser, "E", ROLES, { count: 1, operational: false });
  });

  for (const r of ROLES) {
    test(`${r.given} create restock (${C19})`, async ({ page }) => {
      const t = ground.teams[r.key]!;
      await helpSignIn(page, t);
      await helpForm(page, t, ground.whCode);

      await test.step("then: account box says ask owner or admin", async () => {
        await expect(page.getByTestId("restock-finance-account")).toContainText("No operational account");
        await expect(page.getByTestId("restock-finance-account-missing")).toHaveAttribute("data-case", "ask");
        await expect(page.getByTestId("restock-finance-account-missing-text")).toHaveText(
          "Ask your owner or admin to set up an operational account.",
        );
      });

      await test.step("then: no link to Financial Accounts", async () => {
        const box = page.getByTestId("restock-finance-account-missing");
        await expect(box).toBeVisible();
        await expect(page.getByTestId("restock-finance-account-open")).toHaveCount(0);
        await expect(box.locator("a")).toHaveCount(0);
      });
    });
  }
});

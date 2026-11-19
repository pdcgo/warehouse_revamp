import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── selling:all wants to record the supplier's solution — the checks behind docs/acceptances/inventory/restock.md ─────
//
// WHEN `resolve restock problem`, two givens:
//   A (status: accepted · missing items · money refunded · operational account) — 10 × Rp 10.000 ordered, 8 in the box:
//     2 missing, and the supplier pays the Rp 20.000 for them back into the paying (operational) account.
//   B (status: accepted · broken items · goods resent) — 10 in the box, 2 of them broken: the supplier sends 2 again.
//
// EVERY THEN IS 🚧 unimplemented. The rows come from a discussion, not a decision (restock.md's 📝 note under
// § resolve: missing and broken units are settled with the supplier; goods sent again are proposed as a NEW restock that
// names the one it settles). Nothing is built for it: no RPC, and an accepted restock's page offers no action at all
// (SellingRestockActions: accepted · lost · cancelled → nothing). So each then is its own test, marked `test.fail` with
// the status (guide.md) — its own, because `test.fail` flips a whole test and would hide a then that turns real while
// the others do not. Each runs as selling:owner on its own restock (and, for A, its own operational account, so no
// balance read is moved by another test), as the 🚧 checks of create / mark lost restock do; the day one turns red the
// then is built — ask the owner, then run it as every selling role on the built test ids.
//
// FIELD-AGNOSTIC, because how it will be built is not known: the GIVEN is proven on the rendered restock page (accepted,
// its missing or broken count shown); the WHEN looks for a resolve action under any name it could be built with and
// clicks it — softly, so each test goes on to read its then where that then must land:
//   - `solution recorded on restock` — the restock's page shows a solution (a `solution`/`resol…` test id, or the word).
//   - `solution shown in restock timeline` — the restock's Riwayat gains a row.
//   - `operational account balance increases by refund` — the paying account reads its balance + Rp 20.000.
//   - `refund recorded in operational account history` — that account gains a line naming the restock.
//   - `resent goods arrive as new restock` — the team's restock list gains one, and its warehouse's inbound queue reads
//     1 restock · 2 pcs (an accepted restock is not in it).
test.describe("selling:all wants to record the supplier's solution", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const OWNER = `e2ervown${SUFFIX}`;
  const STAFF = `e2ervwst${SUFFIX}`;
  const COND_REFUND = "status: accepted · missing items · money refunded · operational account";
  const COND_RESENT = "status: accepted · broken items · goods resent";
  const SERVICE = "inventory.v1.RestockRequestService";

  const ORDERED = 10;
  const TOTAL = 100_000; // Rp 10.000 a unit
  const MISSING = 2;
  const BROKEN = 2;
  const REFUND = (TOTAL / ORDERED) * MISSING; // Rp 20.000 — what the 2 missing units were paid
  // RestockRequestStatus, as the badges' test ids carry it.
  const ACCEPTED = 2;
  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  // One restock per 🚧 then: given A's four, given B's two. ⚠ No key — so no resi — may carry the words the action and the
  // solution are looked for by: a resi reading …-SOLUTION-… once named the page's copy button, so the WHEN "found" it.
  const REFUND_KEYS = ["record", "timeline", "balance", "history"] as const;
  const RESENT_KEYS = ["record", "resent"] as const;
  const key = (given: "A" | "B", then: string) => `${given}-${then}`;

  const code = `RVP${SUFFIX}`;
  const resi = (k: string) => `E2E-RV-${k}-${SUFFIX}`.toUpperCase();

  const ground = {
    team: "",
    warehouse: "",
    product: "",
    restocks: {} as Record<string, string>,
    accounts: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    const user = (teamId: string, name: string, role: string) =>
      api(page, "user.v1.UserService/CreateUser", { teamId, username: name, password: PASSWORD, name, role });

    ground.team = await team(`E2E Rv Seller ${SUFFIX}`, `RVS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Rv Warehouse ${SUFFIX}`, `RVW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    await user(ground.team, OWNER, "ROLE_SELLING_OWNER");
    await user(ground.warehouse, STAFF, "ROLE_WAREHOUSE_STAFF");
    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: "e2e-rv", name: "E2E resolve shelf" }))
        .rack.id,
    );

    const supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Rv Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Rv Cat ${SUFFIX}` });
    ground.product = String(
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.team,
          productCodePart: code,
          name: `E2E ${code}`,
          categoryId: category.category.id,
        })
      ).product.id,
    );

    const keys = [...REFUND_KEYS.map((t) => key("A", t)), ...RESENT_KEYS.map((t) => key("B", t))];
    for (const k of keys) {
      // Its own operational account — the balance and history reads are of this restock alone.
      const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Rv ${k} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-RVP-${k}-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      });
      const accountId = String(created.account.id);
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId: ground.team,
        accountId,
        operational: true,
      });
      ground.accounts[k] = accountId;

      // GIVEN — raised for 10 × Rp 10.000, and counted in by the warehouse: A short by 2, B whole with 2 broken.
      const raised = await api(page, `${SERVICE}/RestockRequestCreate`, {
        teamId: ground.team,
        warehouseId: ground.warehouse,
        financeAccountId: accountId,
        receipt: resi(k),
        items: [{ productId: ground.product, productCode: code, name: `E2E ${code}`, count: ORDERED, total: TOTAL, supplierId: supplier }],
      });
      ground.restocks[k] = String(raised.request.id);
      const missing = k.startsWith("A-");
      const received = missing ? ORDERED - MISSING : ORDERED;
      const broken = missing ? 0 : BROKEN;
      await api(page, `${SERVICE}/RestockRequestAccept`, {
        teamId: ground.warehouse,
        requestId: raised.request.id,
        lines: [
          {
            itemId: raised.request.items[0].id,
            receivedCount: received,
            ...(broken > 0 ? { brokenCount: broken, brokenNote: "pecah di jalan" } : {}),
            ...(missing ? { missingNote: "tidak ada di kardus" } : {}),
            placements: [{ placementId: rack, quantity: received - broken }],
          },
        ],
      });
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // The GIVEN on the rendered screen: the restock's own page, accepted, its problem shown.
  async function openAccepted(page: Page, id: string, given: "A" | "B") {
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${ACCEPTED}`)).toBeVisible();
    if (given === "A") {
      // The shortfall is flagged in the title row.
      await expect(page.getByTestId("restock-detail-missing")).toContainText(String(MISSING));
      return;
    }
    // The broken units are in the line's Penyesuaian, whose figures open in a dialog.
    const pid = ground.product;
    await page.getByTestId(`restock-detail-adjustment-${pid}`).click();
    await expect(page.getByTestId(`restock-detail-adjustment-${pid}-dialog`)).toBeVisible();
    await expect(page.getByTestId(`restock-detail-broken-${pid}-count`)).toContainText(String(BROKEN));
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(`restock-detail-adjustment-${pid}-dialog`)).toHaveCount(0);
  }

  // WHEN — resolve restock problem, on the restock's page: a resolve action under any name it could be built with.
  // 🚧 none exists, so this is soft — the test goes on to read its then where it must land.
  async function resolve(page: Page) {
    const named = /resolve|solution|solusi|selesaikan|penyelesaian/i;
    const action = page
      .locator('[data-testid^="restock-action-resolve"], [data-testid^="restock-action-solution"], [data-testid^="restock-resolve"]')
      .or(page.getByRole("button", { name: named }))
      .or(page.getByRole("menuitem", { name: named }));
    await expect.soft(action.first(), "a resolve action on the accepted restock's page").toBeVisible({ timeout: 5_000 });
    if ((await action.count()) > 0) await action.first().click();
  }

  // A solution shown on the restock's page — any test id naming it, or the word.
  async function solutionOnPage(page: Page, id: string) {
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId("restock-detail-page")).toBeVisible();
    const shown = page
      .locator('[data-testid*="solution"], [data-testid*="resol"]')
      .or(page.getByTestId("restock-detail-page").getByText(/solution|solusi|penyelesaian/i));
    await expect(shown.first()).toBeVisible({ timeout: 5_000 });
  }

  // An account's balance as its page shows it, once the line `text` is in its history — the create's payment — so a read
  // is never of an account an event has yet to reach.
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

  // The account's history lines naming this restock — `Restock #12`, never `Restock #123`.
  const restockLines = (page: Page, id: string) =>
    page.locator("[data-testid^='account-log-row-']").filter({ hasText: new RegExp(`Restock #${id}(?!\\d)`) });

  const timelineRows = (page: Page) => page.locator("[data-testid^='restock-timeline-'][data-kind]");
  const MARK = "🚧 unimplemented (docs/acceptances/inventory/restock.md § resolve) — nothing records the supplier's solution";

  // ── A: missing items, money refunded ───────────────────────────────────────────────────────────────────────────────
  test(`selling:owner resolve restock problem (${COND_REFUND}): solution recorded on restock`, async ({ page }) => {
    test.fail(true, `${MARK}: an accepted restock's page offers no resolve action`);
    const id = ground.restocks[key("A", "record")];
    await signIn(page, OWNER, ground.team);
    await openAccepted(page, id, "A");
    await resolve(page);
    await test.step("then: solution recorded on restock", async () => {
      await solutionOnPage(page, id);
    });
  });

  test(`selling:owner resolve restock problem (${COND_REFUND}): solution shown in restock timeline`, async ({ page }) => {
    test.fail(true, `${MARK}: no solution row in the restock timeline`);
    const id = ground.restocks[key("A", "timeline")];
    await signIn(page, OWNER, ground.team);
    await openAccepted(page, id, "A");
    // The accept's own rows are drawn before they are counted.
    await expect(timelineRows(page).first()).toBeVisible();
    const before = await timelineRows(page).count();
    await resolve(page);
    await test.step("then: solution shown in restock timeline", async () => {
      await expect(async () => {
        await page.goto(`/inventories/restock/${id}`);
        await expect(timelineRows(page).first()).toBeVisible({ timeout: 2_000 });
        expect(await timelineRows(page).count()).toBeGreaterThan(before);
      }).toPass({ timeout: 15_000 });
    });
  });

  test(`selling:owner resolve restock problem (${COND_REFUND}): operational account balance increases by refund`, async ({ page }) => {
    test.fail(true, `${MARK}: no refund reaches the operational account`);
    const id = ground.restocks[key("A", "balance")];
    const account = ground.accounts[key("A", "balance")];
    await signIn(page, OWNER, ground.team);
    const before = await balanceOnceRecorded(page, account, `Restock #${id}`);
    await openAccepted(page, id, "A");
    await resolve(page);
    await test.step(`then: operational account balance increases by refund (by ${rupiah(REFUND)}, from ${rupiah(before)})`, async () => {
      await expect(async () => {
        await page.goto(`/financial-accounts/${account}`);
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(before + REFUND), { timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
    });
  });

  test(`selling:owner resolve restock problem (${COND_REFUND}): refund recorded in operational account history`, async ({ page }) => {
    test.fail(true, `${MARK}: no refund line in the operational account's history`);
    const id = ground.restocks[key("A", "history")];
    const account = ground.accounts[key("A", "history")];
    await signIn(page, OWNER, ground.team);
    await balanceOnceRecorded(page, account, `Restock #${id}`);
    const linesBefore = await restockLines(page, id).count();
    expect(linesBefore).toBeGreaterThan(0);
    await openAccepted(page, id, "A");
    await resolve(page);
    await test.step("then: refund recorded in operational account history", async () => {
      await expect(async () => {
        await page.goto(`/financial-accounts/${account}`);
        await expect(page.getByTestId("account-log-table")).toBeVisible({ timeout: 2_000 });
        expect(await restockLines(page, id).count()).toBeGreaterThan(linesBefore);
      }).toPass({ timeout: 20_000 });
    });
  });

  // ── B: broken items, goods resent ──────────────────────────────────────────────────────────────────────────────────
  test(`selling:owner resolve restock problem (${COND_RESENT}): solution recorded on restock`, async ({ page }) => {
    test.fail(true, `${MARK}: an accepted restock's page offers no resolve action`);
    const id = ground.restocks[key("B", "record")];
    await signIn(page, OWNER, ground.team);
    await openAccepted(page, id, "B");
    await resolve(page);
    await test.step("then: solution recorded on restock", async () => {
      await solutionOnPage(page, id);
    });
  });

  test(`selling:owner resolve restock problem (${COND_RESENT}): resent goods arrive as new restock`, async ({ page }) => {
    test.fail(true, `${MARK}: goods sent again raise no new restock`);
    const id = ground.restocks[key("B", "resent")];
    const rows = page.locator('[data-testid^="restock-row-"]');

    // GIVEN, as the warehouse: every restock to it is accepted, so nothing is on its way.
    await signIn(page, STAFF, ground.warehouse);
    await page.goto("/inventories/restock");
    await expect(page.getByTestId("restock-stat-restocks-value")).toHaveText("0");

    // …and as the seller: the team's six restocks on its list.
    await signIn(page, OWNER, ground.team);
    await page.goto("/inventories/restock");
    await expect(page.getByTestId("restock-selling-page")).toBeVisible();
    await expect(page.getByTestId(`restock-row-${id}`)).toBeVisible();
    const before = await rows.count();

    await openAccepted(page, id, "B");
    await resolve(page);
    await test.step("then: resent goods arrive as new restock", async () => {
      // The team's list gains the new restock…
      await expect(async () => {
        await page.goto("/inventories/restock");
        await expect(page.getByTestId(`restock-row-${id}`)).toBeVisible({ timeout: 2_000 });
        expect(await rows.count()).toBe(before + 1);
      }).toPass({ timeout: 15_000 });
      // …and its warehouse sees the 2 units on their way.
      await signIn(page, STAFF, ground.warehouse);
      await page.goto("/inventories/restock");
      await expect(page.getByTestId("restock-stat-restocks-value")).toHaveText("1");
      await expect(page.getByTestId("restock-stat-units-value")).toHaveText(String(BROKEN));
    });
  });
});

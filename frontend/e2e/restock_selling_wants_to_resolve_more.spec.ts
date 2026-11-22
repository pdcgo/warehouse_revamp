import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── selling:all wants to record the supplier's solution, more than one way — docs/acceptances/inventory/restock.md ────
//
// WHEN `resolve restock problem`, givens 36 and 37 (33 and 34 are restock_selling_wants_to_resolve.spec.ts — split so
// neither file runs much past seven minutes alone), and the settle that closes a problem (Tandai Selesai):
//   36 (status: accepted · 5 missing items · 3 resent · 2 refunded · operational account) — 10 × Rp 10.000 ordered, 5 in
//      the box: the supplier sends 3 again (Kirim Ulang, the page opening on the 5 short, 3 typed) and pays Rp 20.000
//      back for the other 2 (Refund).
//   37 (status: accepted · 5 missing items · 3 resent · 2 not settled yet) — the same box: 3 sent again, nothing yet for
//      the other 2.
//
// BUILT by backlog #101 (a-restock-problem-is-settled-by-resolution-rows and every 🔄 under it, the-restock-resolutions-
// prototype-is-accepted): a restock takes as many resolution rows as it needs; a refund posts into its account (async —
// read polled); a reshipping creates an INBOUND custom shipment.
//
// What the rows ask that a later owner decision answers otherwise:
//   - `resent goods arrive as new restock` (36) — ⚠ CONFLICT with a-suppliers-reshipping-comes-in-as-a-custom-shipment
//     (owner, 2026-11-20, "B" against the recommendation of a new linked restock): the goods arrive as an inbound custom
//     shipment. Its OWN test (selling:owner), its then looking for the new restock, marked test.fail with the conflict;
//     every role's test proves what IS built as `regression: resent goods arrive as an inbound parcel`.
//   - `restock stays listed with 2 missing left` (37) — ⚠ CONFLICT with a-restock-problem-is-settled-by-resolution-rows
//     (🔄 *"a resolution names no units"*, owner "B" against the recommendation; the decision itself says the row reads a
//     count the app will not keep): a resolution names no product and no count, so nothing knows "2 left" — the restock
//     stays on the problem list (its tags on) until the seller marks it settled, and its row's missing count is the one
//     Terima wrote, 5. Its OWN test (selling:owner) reads the literal "2 missing" and is marked test.fail; every role's
//     test proves what IS built as `regression: restock stays in the problem list until Tandai Selesai`.
// The rows come from a 2026-11-16 discussion (restock.md's 📝 note), not a decision.
//
// Each given runs as EVERY selling role, each on its OWN restock and its OWN operational account. Last, one regression
// test of the settle itself (selling:owner): Tandai Selesai takes the problem tags off and the restock leaves the problem
// list (it stays under Semua, marked Selesai); Catat Resolusi stays open after it (🔄 *"a settled restock still takes
// resolutions"* — a late refund leaves it settled); a settled Hilang restock leaves the Hilang tab (🔄 *the Hilang tab
// sends lost + unsettled*) and stays under Semua.
test.describe("resolve restock problem", () => {
  test.describe.configure({ timeout: 150_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const SERVICE = "inventory.v1.RestockRequestService";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  const COND_BOTH = "status: accepted · 5 missing items · 3 resent · 2 refunded · operational account";
  const COND_OPEN = "status: accepted · 5 missing items · 3 resent · 2 not settled yet";
  const CONFLICT_RESTOCK =
    "conflict: a-suppliers-reshipping-comes-in-as-a-custom-shipment — resent goods arrive as an inbound parcel, not a new restock";
  const CONFLICT_UNITS = "conflict: a-restock-problem-is-settled-by-resolution-rows — a resolution names no units";

  const ORDERED = 10;
  const TOTAL = 100_000; // Rp 10.000 a unit
  const UNIT = TOTAL / ORDERED;
  const MISSING = 5;
  const RESENT = 3;
  const REFUND = UNIT * (MISSING - RESENT); // Rp 20.000 — the 2 not sent again
  const LATE_REFUND = 5_000;
  // RestockRequestStatus, as the badges' test ids carry it.
  const ACCEPTED = 2;
  const LOST = 5;
  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  // One restock (and one paying account) per role and given; `*-new` are the conflict tests' own; `settle` (accepted,
  // 2 missing + 1 broken — both tags) and `lost` are the settle regression's.
  const BOTH_KEYS = [...ROLES.map((r) => `B-${r.key}`), "B-new"];
  const OPEN_KEYS = [...ROLES.map((r) => `O-${r.key}`), "O-new"];
  const SETTLE = "settle";
  const LOST_KEY = "lost";

  const username = (key: string) => `e2ervm${key}${SUFFIX}`;
  const STAFF = `e2ervmwh${SUFFIX}`;
  const code = `RVMP${SUFFIX}`;
  const resi = (k: string) => `E2E-RVM-${k}-${SUFFIX}`.toUpperCase();
  const resentResi = (k: string) => `E2E-RVMK-${k}-${SUFFIX}`.toUpperCase();

  const ground = {
    team: "",
    warehouse: "",
    product: "",
    kurang: "",
    rusak: "",
    restocks: {} as Record<string, string>,
    accounts: {} as Record<string, { id: string; name: string }>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    // The name is the username, so who recorded a row reads as the person signed in.
    const user = (teamId: string, name: string, role: string) =>
      api(page, "user.v1.UserService/CreateUser", { teamId, username: name, password: PASSWORD, name, role });

    ground.team = await team(`E2E RvM Seller ${SUFFIX}`, `RVMS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E RvM Warehouse ${SUFFIX}`, `RVMW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    for (const r of ROLES) await user(ground.team, username(r.key), r.role);
    await user(ground.warehouse, STAFF, "ROLE_WAREHOUSE_STAFF");
    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: "e2e-rvm", name: "E2E resolve more shelf" }))
        .rack.id,
    );

    // The reshipping's supplier is the server's pick — the one every restock line names.
    const supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E RvM Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E RvM Cat ${SUFFIX}` });
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

    for (const k of [...BOTH_KEYS, ...OPEN_KEYS, SETTLE, LOST_KEY]) {
      // Its own operational account — the balance reads are of this restock alone.
      const name = `E2E RvM ${k} ${SUFFIX}`;
      const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name,
        holderName: "E2E",
        accountNumber: `E2E-RVM-${k}-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      });
      const accountId = String(created.account.id);
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId: ground.team,
        accountId,
        operational: true,
      });
      ground.accounts[k] = { id: accountId, name };

      // GIVEN — raised for 10 × Rp 10.000 from that account.
      const raised = await api(page, `${SERVICE}/RestockRequestCreate`, {
        teamId: ground.team,
        warehouseId: ground.warehouse,
        financeAccountId: accountId,
        receipt: resi(k),
        shipmentCost: 0,
        items: [{ productId: ground.product, productCode: code, name: `E2E ${code}`, count: ORDERED, total: TOTAL, supplierId: supplier }],
      });
      const requestId = raised.request.id;
      ground.restocks[k] = String(requestId);
      if (k === LOST_KEY) {
        await api(page, `${SERVICE}/RestockRequestMarkLost`, { teamId: ground.team, requestId, description: "paket hilang di kurir" });
        continue;
      }
      // Counted in by the warehouse: 36 / 37 with 5 in the box (5 missing — Barang kurang); the settle regression's with
      // 8, one broken (2 missing + 1 broken — Barang kurang and Barang rusak).
      const received = k === SETTLE ? 8 : ORDERED - MISSING;
      const broken = k === SETTLE ? 1 : 0;
      await api(page, `${SERVICE}/RestockRequestAccept`, {
        teamId: ground.warehouse,
        requestId,
        lines: [
          {
            itemId: raised.request.items[0].id,
            receivedCount: received,
            missingNote: "tidak ada di kardus",
            ...(broken > 0 ? { brokenCount: broken, brokenNote: "pecah di jalan" } : {}),
            placements: [{ placementId: rack, quantity: received - broken }],
          },
        ],
      });
    }

    // The settle regression's restock already holds one resolution (a refund) before it is settled.
    await api(page, `${SERVICE}/RestockResolutionCreate`, {
      teamId: ground.team,
      restockId: ground.restocks[SETTLE],
      type: "RESTOCK_RESOLUTION_TYPE_REFUND",
      note: "refund awal",
      refundAmount: UNIT,
      financeAccountId: ground.accounts[SETTLE].id,
      idempotencyKey: `e2e-rvm-seed-${SUFFIX}`,
    });

    // The app's two problem tags (inventory migration 00055), by their task.
    const listed = await api(page, `${SERVICE}/RestockTagList`, { teamId: "1", q: "Barang", page: { page: 1, limit: 200 } });
    const tags = (listed.tags ?? []) as { id: string; appTask?: string }[];
    ground.kurang = String(tags.find((t) => t.appTask === "restock.problem.missing")?.id ?? "");
    ground.rusak = String(tags.find((t) => t.appTask === "restock.problem.broken")?.id ?? "");
    expect(ground.kurang && ground.rusak, JSON.stringify(tags)).toBeTruthy();

    await page.close();
  });

  async function signIn(page: Page, user: string, team = ground.team) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // The restock's page, its Resolusi section drawn — the GIVEN: accepted (a problem restock) or lost.
  async function openResolutions(page: Page, id: string, status = ACCEPTED) {
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${status}`)).toBeVisible();
    await expect(page.getByTestId("restock-detail-resolutions-section").getByTestId("resolution-section")).toBeVisible();
  }

  // Catat Resolusi → one of its types.
  async function pick(page: Page, slug: "refund" | "return" | "reshipping") {
    await page.getByTestId("resolution-record").click();
    await expect(page.getByTestId("resolution-record-menu")).toBeVisible();
    await page.getByTestId(`resolution-record-${slug}`).click();
  }

  const created = (page: Page) => page.waitForResponse((r) => r.url().endsWith(`/warehouse.${SERVICE}/RestockResolutionCreate`));

  // WHEN — Catat Resolusi → Refund: the amount typed, the account left on the one it opens on (the restock's paying
  // account), a note. Returns the resolution's id.
  async function recordRefund(page: Page, id: string, amount: number, account: { id: string; name: string }, note: string) {
    await openResolutions(page, id);
    await pick(page, "refund");
    await expect(page.getByTestId("resolution-refund-dialog")).toBeVisible();
    await expect(page.getByTestId("resolution-refund-account")).toContainText(account.name);
    await page.getByTestId("resolution-refund-amount").fill(String(amount));
    await page.getByTestId("resolution-refund-note").fill(note);
    const [res] = await Promise.all([created(page), page.getByTestId("confirm-action").click()]);
    expect(res.status()).toBe(200);
    const sent = res.request().postDataJSON() as { refundAmount?: number; financeAccountId?: string };
    expect(sent.refundAmount).toBe(amount);
    expect(String(sent.financeAccountId)).toBe(account.id);
    await expect(page.getByTestId("confirm-action")).toHaveCount(0);
    return String(((await res.json()) as { resolution: { id: string } }).resolution.id);
  }

  // WHEN — Catat Resolusi → Kirim Ulang: the page opens on the 5 short; 3 typed over it, the courier picked (JNE), a resi
  // and a note typed, the warehouse left on the restock's; saved, it returns to the restock. Returns the resolution's and
  // its inbound parcel's ids.
  async function recordReshipping(page: Page, id: string, k: string, note: string) {
    const pid = ground.product;
    const count = page.getByTestId(`reshipping-count-${pid}`);
    await openResolutions(page, id);
    await pick(page, "reshipping");
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}/reshipping$`));
    await expect(page.getByTestId("reshipping-form")).toBeVisible();
    await expect(page.getByTestId(`reshipping-line-${pid}`)).toBeVisible();
    await expect(count).toHaveValue(String(MISSING));
    await count.fill(String(RESENT));
    await count.press("Tab");
    await expect(count).toHaveValue(String(RESENT));
    await page.getByTestId("reshipping-resi").fill(resentResi(k));
    await page.getByTestId("reshipping-note").fill(note);
    // The courier's list lands late and remounts the field once: picked again until the form reads ready.
    await expect(async () => {
      await page.getByTestId("reshipping-courier").getByRole("combobox").click();
      await page.getByTestId("shipment-channel-option-jne").click({ timeout: 3_000 });
      await expect(page.getByTestId("reshipping-ready-ready")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    const [res] = await Promise.all([created(page), page.getByTestId("reshipping-save").click()]);
    expect(res.status()).toBe(200);
    const sent = res.request().postDataJSON() as {
      reshipping: { warehouseId: string; lines: { productId: string; count: string }[] };
    };
    expect(String(sent.reshipping.warehouseId)).toBe(ground.warehouse);
    expect(sent.reshipping.lines.map((l) => [String(l.productId), String(l.count)])).toEqual([[pid, String(RESENT)]]);
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));
    const body = (await res.json()) as { resolution: { id: string }; customShipment: { id: string } };
    return { resolution: String(body.resolution.id), parcel: String(body.customShipment.id) };
  }

  // WHEN — Tandai Selesai, confirmed. `none`: no resolution is recorded, which the dialog says (its notes box is empty —
  // drawn with no size — when there is nothing to warn of, so it is only attached).
  async function settle(page: Page, none: boolean) {
    await page.getByTestId("resolution-settle").click();
    await expect(page.getByTestId("confirm-action")).toBeVisible();
    await expect(page.getByTestId("resolution-settle-notes")).toBeAttached();
    await expect(page.getByTestId("resolution-settle-none")).toHaveCount(none ? 1 : 0);
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/warehouse.${SERVICE}/RestockRequestSettle`) && r.status() === 200),
      page.getByTestId("confirm-action").click(),
    ]);
    await expect(page.getByTestId("confirm-action")).toHaveCount(0);
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

  // A seller's list, loaded: its table, or its empty state when nothing matches.
  async function sellerList(page: Page, query: string) {
    await page.goto(`/inventories/restock${query}`);
    await expect(page.getByTestId("restock-requests-table").or(page.getByTestId("restock-requests-empty")).first()).toBeVisible();
  }

  const problemList = () => `?tag=${ground.kurang},${ground.rusak}`;
  const resolutionRows = (page: Page) => page.locator("[data-testid^='resolution-row-'][data-type]");
  const trail = (page: Page, kind: string) => page.locator(`[data-testid^='restock-timeline-'][data-kind='${kind}']`);

  // The team's restock list, before — so a new restock would show as one more row.
  async function restockCount(page: Page, id: string) {
    await page.goto("/inventories/restock");
    await expect(page.getByTestId(`restock-row-${id}`)).toBeVisible();
    return page.locator('[data-testid^="restock-row-"]').count();
  }

  // ── 36: 5 missing — 3 resent, 2 refunded ───────────────────────────────────────────────────────────────────────────
  test.describe(`selling:all wants to record the supplier's solution (${COND_BOTH})`, () => {
    for (const r of ROLES) {
      test(`${r.given} resolve restock problem (${COND_BOTH})`, async ({ page }) => {
        const k = `B-${r.key}`;
        const id = ground.restocks[k];
        const account = ground.accounts[k];

        await signIn(page, username(r.key));
        // GIVEN — the payment is on the account; the restock is accepted, 5 short, no resolution yet.
        const before = await balanceOnceRecorded(page, account.id, `Restock #${id}`);
        await openResolutions(page, id);
        await expect(page.getByTestId("restock-detail-missing")).toContainText(String(MISSING));
        await expect(page.getByTestId("resolution-empty")).toBeVisible();

        // WHEN — as this role: 3 sent again, then Rp 20.000 back for the other 2.
        const sent = await recordReshipping(page, id, k, `kirim ulang 3 ${r.key} ${SUFFIX}`);
        const refund = await recordRefund(page, id, REFUND, account, `refund 2 ${r.key} ${SUFFIX}`);

        await test.step("then: both solutions recorded on restock", async () => {
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(resolutionRows(page)).toHaveCount(2);
          const prefix = `resolution-row-${sent.resolution}`;
          await expect.soft(page.getByTestId(prefix)).toHaveAttribute("data-type", "RESHIPPING");
          await expect.soft(page.getByTestId(`${prefix}-parcel-link`)).toHaveText(`Reshipping #${sent.parcel}`);
          await expect.soft(page.getByTestId(`${prefix}-parcel`).getByTestId("inbound-status-on_the_way")).toBeVisible();
          await expect.soft(page.getByTestId(`${prefix}-parcel`)).toContainText(`${RESENT} pcs`);
          await expect.soft(page.getByTestId(`resolution-row-${refund}`)).toHaveAttribute("data-type", "REFUND");
          await expect.soft(page.getByTestId(`resolution-row-${refund}-refund`)).toHaveText(`${rupiah(REFUND)} into ${account.name}`);
          await expect.soft(page.getByTestId(`resolution-row-${refund}-when`)).toContainText(username(r.key));
          // Both are in the Riwayat too.
          await expect.soft(trail(page, "resolution")).toHaveCount(2);
        });
        await test.step("then: operational account balance increases by refund", async () => {
          await expect
            .soft(async () => {
              await page.goto(`/financial-accounts/${account.id}`);
              await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(before + REFUND), { timeout: 2_000 });
            })
            .toPass({ timeout: 30_000 });
        });
        // What IS built for the goods sent again: the parcel exists, the row links it, its warehouse has it on its way.
        await test.step("regression: resent goods arrive as an inbound parcel", async () => {
          await page.goto(`/inventories/restock/${id}`);
          await page.getByTestId(`resolution-row-${sent.resolution}-parcel-link`).click();
          await expect.soft(page).toHaveURL(new RegExp(`/inventories/custom-shipments/in/${sent.parcel}$`));
          await expect.soft(page.getByTestId("inbound-restock")).toContainText(`#${id}`);
          await expect.soft(page.getByTestId(`inbound-line-${ground.product}`)).toBeVisible();

          await signIn(page, STAFF, ground.warehouse);
          await page.goto("/inventories/restock");
          await expect.soft(page.getByTestId(`inbound-row-${sent.parcel}`).getByTestId("inbound-status-on_the_way")).toBeVisible();
          await expect.soft(page.getByTestId(`inbound-for-${sent.parcel}`)).toContainText(`restock #${id}`);
          await expect.soft(page.getByTestId(`inbound-items-${sent.parcel}`)).toContainText(`${RESENT} pcs`);
        });
      });
    }

    // ⚠ CONFLICT — its own test (test.fail flips a whole test): the row expects a new restock for the 3 sent again; the
    // owner decided an inbound custom shipment. The then looks for the new restock on the team's list.
    test(`selling:owner resolve restock problem (${COND_BOTH}): resent goods arrive as new restock`, async ({ page }) => {
      test.fail(true, CONFLICT_RESTOCK);
      const id = ground.restocks["B-new"];
      await signIn(page, username("own"));
      const before = await restockCount(page, id);

      const sent = await recordReshipping(page, id, "B-new", `kirim ulang 3 new ${SUFFIX}`);
      await expect(page.getByTestId(`resolution-row-${sent.resolution}`)).toHaveAttribute("data-type", "RESHIPPING");

      await test.step("then: resent goods arrive as new restock", async () => {
        await expect(async () => {
          expect(await restockCount(page, id)).toBe(before + 1);
        }).toPass({ timeout: 15_000 });
      });
    });
  });

  // ── 37: 5 missing — 3 resent, 2 not settled yet ────────────────────────────────────────────────────────────────────
  test.describe(`selling:all wants to record the supplier's solution (${COND_OPEN})`, () => {
    for (const r of ROLES) {
      test(`${r.given} resolve restock problem (${COND_OPEN})`, async ({ page }) => {
        const k = `O-${r.key}`;
        const id = ground.restocks[k];
        const listed = page.getByTestId(`restock-row-${id}`);

        await signIn(page, username(r.key));
        // GIVEN — on the problem list (Barang kurang), 5 short, no resolution yet.
        await sellerList(page, problemList());
        await expect(listed.getByTestId(`restock-missing-${id}`)).toHaveText(`${MISSING} missing`);
        await expect(listed.getByTestId(`restock-resolutions-${id}`)).toHaveCount(0);

        // WHEN — as this role: 3 sent again.
        const sent = await recordReshipping(page, id, k, `kirim ulang 3 dari 5 ${r.key} ${SUFFIX}`);
        await expect(page.getByTestId(`resolution-row-${sent.resolution}`)).toHaveAttribute("data-type", "RESHIPPING");

        // What IS built (a resolution names no units): the restock stays a problem — its tag on, still on the problem
        // list with its resolution counted — until the seller marks it settled; its missing count is Terima's.
        await test.step("regression: restock stays in the problem list until Tandai Selesai", async () => {
          await sellerList(page, problemList());
          await expect.soft(listed).toBeVisible();
          await expect.soft(listed.getByTestId(`restock-tags-${id}`).locator("[data-tag-type]")).toHaveText(["Barang kurang"]);
          await expect.soft(listed.getByTestId(`restock-resolutions-${id}`)).toHaveAttribute("aria-label", "1 resolution");
          await expect.soft(listed.getByTestId(`restock-settled-${id}`)).toHaveCount(0);
          await expect.soft(listed.getByTestId(`restock-missing-${id}`)).toHaveText(`${MISSING} missing`);
          // …and its page still offers Tandai Selesai.
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(page.getByTestId("resolution-settle")).toBeVisible();
          await expect.soft(page.getByTestId("restock-detail-settled")).toHaveCount(0);
        });
      });
    }

    // ⚠ CONFLICT — its own test: the row expects the list to know 2 are left; a resolution names no units, so the row
    // keeps Terima's 5.
    test(`selling:owner resolve restock problem (${COND_OPEN}): restock stays listed with 2 missing left`, async ({ page }) => {
      test.fail(true, CONFLICT_UNITS);
      const id = ground.restocks["O-new"];
      const listed = page.getByTestId(`restock-row-${id}`);
      await signIn(page, username("own"));

      const sent = await recordReshipping(page, id, "O-new", `kirim ulang 3 dari 5 new ${SUFFIX}`);
      await expect(page.getByTestId(`resolution-row-${sent.resolution}`)).toHaveAttribute("data-type", "RESHIPPING");

      await test.step("then: restock stays listed with 2 missing left", async () => {
        await sellerList(page, problemList());
        await expect(listed).toBeVisible();
        await expect(listed.getByTestId(`restock-missing-${id}`)).toHaveText(`${MISSING - RESENT} missing`, { timeout: 5_000 });
      });
    });
  });

  // ── Tandai Selesai — a regression of a-restock-problem-is-settled-by-resolution-rows (no then of its own) ──────────
  test.describe("selling:owner marks a problem or lost restock settled", () => {
    test("selling:owner settle restock: problem tags off, off the problem list and the Hilang tab, Catat Resolusi stays open", async ({
      page,
    }) => {
      const id = ground.restocks[SETTLE];
      const lost = ground.restocks[LOST_KEY];
      const listed = (rid: string) => page.getByTestId(`restock-row-${rid}`);

      await signIn(page, username("own"));
      // GIVEN — on the problem list with its one resolution; both problem tags on its page.
      await sellerList(page, problemList());
      await expect(listed(id).getByTestId(`restock-resolutions-${id}`)).toHaveAttribute("aria-label", "1 resolution");
      await openResolutions(page, id);
      await expect(page.getByTestId(`restock-tag-${ground.kurang}`)).toBeVisible();
      await expect(page.getByTestId(`restock-tag-${ground.rusak}`)).toBeVisible();

      // WHEN — Tandai Selesai.
      await settle(page, false);

      await test.step("regression: Tandai Selesai takes the problem tags off", async () => {
        await page.goto(`/inventories/restock/${id}`);
        await expect.soft(page.getByTestId("resolution-settled")).toBeVisible();
        await expect.soft(page.getByTestId("restock-detail-settled")).toBeVisible();
        await expect.soft(page.getByTestId("resolution-settle")).toHaveCount(0);
        await expect.soft(page.getByTestId(`restock-tag-${ground.kurang}`)).toHaveCount(0);
        await expect.soft(page.getByTestId(`restock-tag-${ground.rusak}`)).toHaveCount(0);
        // Still Diterima — settling is no status.
        await expect.soft(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${ACCEPTED}`)).toBeVisible();
        await expect.soft(trail(page, "settled")).toHaveCount(1);
        await expect.soft(trail(page, "settled").first().locator("[data-testid$='-detail']")).toHaveText(
          "Barang kurang and Barang rusak came off.",
        );
      });
      await test.step("regression: a settled restock leaves the problem list and stays under Semua", async () => {
        await sellerList(page, problemList());
        await expect.soft(listed(id)).toHaveCount(0);
        await sellerList(page, "");
        await expect.soft(listed(id).getByTestId(`restock-settled-${id}`)).toBeVisible();
        await expect.soft(listed(id).getByTestId(`restock-status-${ACCEPTED}`)).toBeVisible();
      });
      await test.step("regression: Catat Resolusi stays open after Selesai", async () => {
        const late = await recordRefund(page, id, LATE_REFUND, ground.accounts[SETTLE], `refund susulan ${SUFFIX}`);
        await page.goto(`/inventories/restock/${id}`);
        await expect.soft(page.getByTestId(`resolution-row-${late}`)).toHaveAttribute("data-type", "REFUND");
        await expect.soft(resolutionRows(page)).toHaveCount(2);
        // …and it stays settled, its tags off.
        await expect.soft(page.getByTestId("resolution-settled")).toBeVisible();
        await expect.soft(page.getByTestId("restock-detail-settled")).toBeVisible();
        await expect.soft(page.getByTestId("resolution-settle")).toHaveCount(0);
        await expect.soft(page.getByTestId(`restock-tag-${ground.kurang}`)).toHaveCount(0);
        await expect.soft(trail(page, "resolution")).toHaveCount(2);
        await sellerList(page, "");
        await expect.soft(listed(id).getByTestId(`restock-settled-${id}`)).toBeVisible();
      });
      await test.step("regression: a settled lost restock leaves the Hilang tab and stays under Semua", async () => {
        await sellerList(page, "?status=lost");
        await expect.soft(listed(lost)).toBeVisible();
        await openResolutions(page, lost, LOST);
        await expect.soft(page.getByTestId("resolution-empty")).toBeVisible();
        await settle(page, true);
        await page.goto(`/inventories/restock/${lost}`);
        await expect.soft(page.getByTestId("resolution-settled")).toBeVisible();
        await expect.soft(trail(page, "settled").first().locator("[data-testid$='-detail']")).toHaveText("It left the Lost tab.");
        await sellerList(page, "?status=lost");
        await expect.soft(listed(lost)).toHaveCount(0);
        await sellerList(page, "");
        await expect.soft(listed(lost).getByTestId(`restock-settled-${lost}`)).toBeVisible();
        await expect.soft(listed(lost).getByTestId(`restock-status-${LOST}`)).toBeVisible();
      });
    });
  });
});

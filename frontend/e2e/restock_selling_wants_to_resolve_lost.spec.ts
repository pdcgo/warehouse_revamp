import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── selling:all wants to record the platform's solution — the checks behind docs/acceptances/inventory/restock.md ─────
//
// WHEN `resolve lost restock`, two givens: 10 × Rp 10.000 raised, paid from the team's operational account, given up as
// lost (Hilang) — and the platform settles it:
//   35 (status: lost · money refunded · operational account) — the whole Rp 100.000 comes back.
//   38 (status: lost · part refunded · rest resent · operational account) — Rp 40.000 comes back for 4 units, the other 6
//      are sent again.
//
// BUILT by backlog #101: a Hilang restock takes resolutions too (a-restock-problem-is-settled-by-resolution-rows, 🔄 *"a
// lost restock takes resolutions too"* — `refund` with its amount and account, `reshipping` as an inbound parcel, but no
// `return`: nothing arrived to send back). Its page has the Resolusi section; *Catat Resolusi* offers Refund and Kirim
// Ulang only; Kirim Ulang's page opens on every unit of the lost restock. A refund posts INTO its account through
// inventory's RestockRefunded (async — read polled).
//
// Each given runs as EVERY selling role, each role on its OWN restock and its OWN operational account. The WHEN is the
// screen's (Catat Resolusi → Refund, → Kirim Ulang); each then its own step, named as its row, read softly:
//   - `solution recorded on restock` / `both solutions recorded on restock` — the resolution rows on the restock's
//     Resolusi section: a refund's amount and account, a reshipping's parcel with its step and its units.
//   - `operational account balance increases by refund` — the paying account's balance on its page, + the refund.
//   - `resent goods arrive as new restock` — ⚠ CONFLICT with a-suppliers-reshipping-comes-in-as-a-custom-shipment (owner,
//     2026-11-20, "B" against the recommendation of a new linked restock): the goods sent again arrive as an INBOUND
//     CUSTOM SHIPMENT; the row comes from a 2026-11-16 discussion, not a decision. Its OWN test (selling:owner), its
//     then looking for the new restock and marked test.fail with the conflict; every role's test proves what IS built
//     as `regression: resent goods arrive as an inbound parcel` (the parcel exists, the resolution row links it, it is on
//     the warehouse's Restok Masuk on its way — its Tiba / Terima are custom_shipments_*'s to drive).
test.describe("resolve lost restock", () => {
  test.describe.configure({ timeout: 150_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const SERVICE = "inventory.v1.RestockRequestService";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  const COND_REFUND = "status: lost · money refunded · operational account";
  const COND_SPLIT = "status: lost · part refunded · rest resent · operational account";
  const CONFLICT =
    "conflict: a-suppliers-reshipping-comes-in-as-a-custom-shipment — resent goods arrive as an inbound parcel, not a new restock";

  const ORDERED = 10;
  const TOTAL = 100_000; // Rp 10.000 a unit, no shipping cost — the whole amount paid
  const UNIT = TOTAL / ORDERED;
  const PART_REFUNDED = 4;
  const RESENT = ORDERED - PART_REFUNDED;
  const PART_REFUND = UNIT * PART_REFUNDED; // Rp 40.000
  // RestockRequestStatus, as the badges' test ids carry it.
  const LOST = 5;
  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  // One restock (and one paying account) per role and given; `S-new` is the conflict test's own.
  const REFUND_KEYS = ROLES.map((r) => `R-${r.key}`);
  const SPLIT_KEYS = [...ROLES.map((r) => `S-${r.key}`), "S-new"];

  const username = (key: string) => `e2ervl${key}${SUFFIX}`;
  const STAFF = `e2ervlwh${SUFFIX}`;
  const code = `RVLP${SUFFIX}`;
  const resi = (k: string) => `E2E-RVL-${k}-${SUFFIX}`.toUpperCase();
  const resentResi = (k: string) => `E2E-RVLK-${k}-${SUFFIX}`.toUpperCase();

  const ground = {
    team: "",
    warehouse: "",
    product: "",
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

    ground.team = await team(`E2E RvL Seller ${SUFFIX}`, `RVLS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E RvL Warehouse ${SUFFIX}`, `RVLW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    for (const r of ROLES) await user(ground.team, username(r.key), r.role);
    await user(ground.warehouse, STAFF, "ROLE_WAREHOUSE_STAFF");

    // The reshipping's supplier is the server's pick — the one every restock line names.
    const supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E RvL Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E RvL Cat ${SUFFIX}` });
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

    for (const k of [...REFUND_KEYS, ...SPLIT_KEYS]) {
      // Its own operational account — the balance read is of this restock alone.
      const name = `E2E RvL ${k} ${SUFFIX}`;
      const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name,
        holderName: "E2E",
        accountNumber: `E2E-RVL-${k}-${SUFFIX}`,
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

      // GIVEN — raised for 10 × Rp 10.000 from that account, then given up as lost by the selling team.
      const raised = await api(page, `${SERVICE}/RestockRequestCreate`, {
        teamId: ground.team,
        warehouseId: ground.warehouse,
        financeAccountId: accountId,
        receipt: resi(k),
        shipmentCost: 0,
        items: [{ productId: ground.product, productCode: code, name: `E2E ${code}`, count: ORDERED, total: TOTAL, supplierId: supplier }],
      });
      ground.restocks[k] = String(raised.request.id);
      await api(page, `${SERVICE}/RestockRequestMarkLost`, {
        teamId: ground.team,
        requestId: raised.request.id,
        description: "paket hilang di kurir",
      });
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team = ground.team) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // The restock's page, its Resolusi section drawn — the GIVEN: lost.
  async function openResolutions(page: Page, id: string) {
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${LOST}`)).toBeVisible();
    await expect(page.getByTestId("restock-detail-resolutions-section").getByTestId("resolution-section")).toBeVisible();
  }

  // Catat Resolusi → one of its types.
  async function pick(page: Page, slug: "refund" | "reshipping") {
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

  // WHEN — Catat Resolusi → Kirim Ulang: the page opens on every unit of the lost restock; `count` typed over it, the
  // courier picked (JNE), a resi and a note typed, the warehouse left on the restock's; saved, it returns to the restock.
  // Returns the resolution's and its inbound parcel's ids.
  async function recordReshipping(page: Page, id: string, count: number, k: string, note: string) {
    const pid = ground.product;
    await openResolutions(page, id);
    await pick(page, "reshipping");
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}/reshipping$`));
    await expect(page.getByTestId("reshipping-form")).toBeVisible();
    await expect(page.getByTestId(`reshipping-line-${pid}`)).toBeVisible();
    await expect(page.getByTestId(`reshipping-count-${pid}`)).toHaveValue(String(ORDERED));
    if (count !== ORDERED) {
      await page.getByTestId(`reshipping-count-${pid}`).fill(String(count));
      await page.getByTestId(`reshipping-count-${pid}`).press("Tab");
      await expect(page.getByTestId(`reshipping-count-${pid}`)).toHaveValue(String(count));
    }
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
    expect(sent.reshipping.lines.map((l) => [String(l.productId), String(l.count)])).toEqual([[pid, String(count)]]);
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));
    const body = (await res.json()) as { resolution: { id: string }; customShipment: { id: string } };
    return { resolution: String(body.resolution.id), parcel: String(body.customShipment.id) };
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

  // The balance, re-read until the refund has landed on it.
  async function balanceReads(page: Page, accountId: string, expected: number) {
    await expect
      .soft(async () => {
        await page.goto(`/financial-accounts/${accountId}`);
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(expected), { timeout: 2_000 });
      })
      .toPass({ timeout: 30_000 });
  }

  // What IS built for the goods sent again: the parcel exists, the resolution row links it, its warehouse has it on its way.
  async function inboundParcelArrives(page: Page, id: string, sent: { resolution: string; parcel: string }, units: number) {
    await page.goto(`/inventories/restock/${id}`);
    await page.getByTestId(`resolution-row-${sent.resolution}-parcel-link`).click();
    await expect.soft(page).toHaveURL(new RegExp(`/inventories/custom-shipments/in/${sent.parcel}$`));
    await expect.soft(page.getByTestId("inbound-title")).toContainText(`#${sent.parcel}`);
    await expect.soft(page.getByTestId("inbound-restock")).toContainText(`#${id}`);
    await expect.soft(page.getByTestId(`inbound-line-${ground.product}`)).toBeVisible();

    await signIn(page, STAFF, ground.warehouse);
    await page.goto("/inventories/restock");
    const inbound = page.getByTestId(`inbound-row-${sent.parcel}`);
    await expect.soft(inbound).toBeVisible();
    await expect.soft(inbound.getByTestId("inbound-status-on_the_way")).toBeVisible();
    await expect.soft(page.getByTestId(`inbound-for-${sent.parcel}`)).toContainText(`restock #${id}`);
    await expect.soft(page.getByTestId(`inbound-items-${sent.parcel}`)).toContainText(`${units} pcs`);
  }

  const resolutionRows = (page: Page) => page.locator("[data-testid^='resolution-row-'][data-type]");

  // ── 35: lost, money refunded ───────────────────────────────────────────────────────────────────────────────────────
  test.describe(`selling:all wants to record the platform's solution (${COND_REFUND})`, () => {
    for (const r of ROLES) {
      test(`${r.given} resolve lost restock (${COND_REFUND})`, async ({ page }) => {
        const k = `R-${r.key}`;
        const id = ground.restocks[k];
        const account = ground.accounts[k];
        const note = `refund platform ${r.key} ${SUFFIX}`;

        await signIn(page, username(r.key));
        // GIVEN — the create's payment is on the account (the mark lost posted nothing); the restock is lost, no
        // resolution yet.
        const before = await balanceOnceRecorded(page, account.id, `Restock #${id}`);
        await openResolutions(page, id);
        await expect(page.getByTestId("resolution-empty")).toBeVisible();

        // A lost restock takes no return — nothing arrived to send back.
        await test.step("regression: a lost restock offers Refund and Kirim Ulang, no Retur", async () => {
          await page.getByTestId("resolution-record").click();
          await expect.soft(page.getByTestId("resolution-record-refund")).toBeVisible();
          await expect.soft(page.getByTestId("resolution-record-reshipping")).toBeVisible();
          await expect.soft(page.getByTestId("resolution-record-return")).toHaveCount(0);
          await page.keyboard.press("Escape");
        });

        // WHEN — as this role: the whole amount back.
        const resolution = await recordRefund(page, id, TOTAL, account, note);
        const prefix = `resolution-row-${resolution}`;

        await test.step("then: solution recorded on restock", async () => {
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(page.getByTestId(prefix)).toHaveAttribute("data-type", "REFUND");
          await expect.soft(page.getByTestId(prefix).getByTestId("resolution-type-refund")).toBeVisible();
          await expect.soft(page.getByTestId(`${prefix}-refund`)).toHaveText(`${rupiah(TOTAL)} into ${account.name}`);
          await expect.soft(page.getByTestId(`${prefix}-note`)).toHaveText(note);
          await expect.soft(page.getByTestId(`${prefix}-when`)).toContainText(username(r.key));
          await expect.soft(resolutionRows(page)).toHaveCount(1);
          // Still Hilang — a resolution changes no status.
          await expect.soft(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${LOST}`)).toBeVisible();
        });
        await test.step("then: operational account balance increases by refund", async () => {
          await balanceReads(page, account.id, before + TOTAL);
        });
      });
    }
  });

  // ── 38: lost, part refunded, the rest resent ───────────────────────────────────────────────────────────────────────
  test.describe(`selling:all wants to record the platform's solution (${COND_SPLIT})`, () => {
    for (const r of ROLES) {
      test(`${r.given} resolve lost restock (${COND_SPLIT})`, async ({ page }) => {
        const k = `S-${r.key}`;
        const id = ground.restocks[k];
        const account = ground.accounts[k];

        await signIn(page, username(r.key));
        // GIVEN — the payment is on the account; the restock is lost, no resolution yet.
        const before = await balanceOnceRecorded(page, account.id, `Restock #${id}`);
        await openResolutions(page, id);
        await expect(page.getByTestId("resolution-empty")).toBeVisible();

        // WHEN — as this role: Rp 40.000 back for 4 units, then the other 6 sent again.
        const refund = await recordRefund(page, id, PART_REFUND, account, `refund sebagian ${r.key} ${SUFFIX}`);
        const sent = await recordReshipping(page, id, RESENT, k, `kirim ulang sisanya ${r.key} ${SUFFIX}`);

        await test.step("then: both solutions recorded on restock", async () => {
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(resolutionRows(page)).toHaveCount(2);
          await expect.soft(page.getByTestId(`resolution-row-${refund}`)).toHaveAttribute("data-type", "REFUND");
          await expect.soft(page.getByTestId(`resolution-row-${refund}-refund`)).toHaveText(`${rupiah(PART_REFUND)} into ${account.name}`);
          const prefix = `resolution-row-${sent.resolution}`;
          await expect.soft(page.getByTestId(prefix)).toHaveAttribute("data-type", "RESHIPPING");
          await expect.soft(page.getByTestId(`${prefix}-parcel-link`)).toHaveText(`Reshipping #${sent.parcel}`);
          await expect.soft(page.getByTestId(`${prefix}-parcel`).getByTestId("inbound-status-on_the_way")).toBeVisible();
          await expect.soft(page.getByTestId(`${prefix}-parcel`)).toContainText(`${RESENT} pcs`);
          await expect.soft(page.getByTestId(`${prefix}-when`)).toContainText(username(r.key));
        });
        await test.step("then: operational account balance increases by refund", async () => {
          await balanceReads(page, account.id, before + PART_REFUND);
        });
        await test.step("regression: resent goods arrive as an inbound parcel", async () => {
          await inboundParcelArrives(page, id, sent, RESENT);
        });
      });
    }

    // ⚠ CONFLICT — its own test (test.fail flips a whole test): the row expects a new restock; the owner decided an
    // inbound custom shipment. The then looks for the new restock on the team's list.
    test(`selling:owner resolve lost restock (${COND_SPLIT}): resent goods arrive as new restock`, async ({ page }) => {
      test.fail(true, CONFLICT);
      const id = ground.restocks["S-new"];
      const rows = page.locator('[data-testid^="restock-row-"]');

      await signIn(page, username("own"));
      await page.goto("/inventories/restock");
      await expect(page.getByTestId(`restock-row-${id}`)).toBeVisible();
      const before = await rows.count();

      const sent = await recordReshipping(page, id, RESENT, "S-new", `kirim ulang sisanya new ${SUFFIX}`);
      await expect(page.getByTestId(`resolution-row-${sent.resolution}`)).toHaveAttribute("data-type", "RESHIPPING");

      await test.step("then: resent goods arrive as new restock", async () => {
        await expect(async () => {
          await page.goto("/inventories/restock");
          await expect(page.getByTestId(`restock-row-${id}`)).toBeVisible({ timeout: 3_000 });
          expect(await rows.count()).toBe(before + 1);
        }).toPass({ timeout: 15_000 });
      });
    });
  });
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── selling:all wants to record the supplier's solution — the checks behind docs/acceptances/inventory/restock.md ─────
//
// WHEN `resolve restock problem`, givens 33 and 34 here (36 and 37 in restock_selling_wants_to_resolve_more.spec.ts):
//   33 (status: accepted · missing items · money refunded · operational account) — 10 × Rp 10.000 ordered, 8 in the box:
//      2 missing, and the supplier pays the Rp 20.000 for them back.
//   34 (status: accepted · broken items · goods resent) — 10 in the box, 2 of them broken: the supplier sends 2 again.
//
// BUILT by backlog #101 (the-restock-resolutions-prototype-is-accepted, a-restock-problem-is-settled-by-resolution-rows
// and every 🔄 under it): the restock's page has a Resolusi section (a problem restock — Diterima with *Barang kurang* /
// *Barang rusak* — or a Hilang one); *Catat Resolusi* → Refund (amount, the account opening on the restock's paying
// account, a note) · Retur ke Supplier · Kirim Ulang (its own page: lines from the problem units, courier, resi,
// warehouse) — each a resolution row; a refund posts INTO its account through inventory's RestockRefunded
// (restock-is-never-typed-by-hand: financial_account writes *Restock #N refund*, async — read polled); each row is written
// into the restock's Riwayat as it happens (a `restock_logs` row of kind `resolution`).
//
// Each given runs as EVERY selling role, each role on its OWN restock and its OWN operational account, so no figure is
// moved by another test. The WHEN is the screen's: the restock's page → Catat Resolusi → Refund / Kirim Ulang. Each then
// is its own step, named exactly as its row and read SOFTLY where it lands, so one failing then does not hide the next:
//   - `solution recorded on restock` — the resolution row on the restock's Resolusi section: its type, a refund's amount
//     and account, a reshipping's parcel and its step, the note, who.
//   - `solution shown in restock timeline` — the Riwayat row of kind `resolution`, naming the same refund.
//   - `operational account balance increases by refund` — the paying account's balance on its page, + Rp 20.000.
//   - `refund recorded in operational account history` — that account's line *Restock #N refund*.
//   - `resent goods arrive as new restock` — ⚠ CONFLICT with a-suppliers-reshipping-comes-in-as-a-custom-shipment (owner,
//     2026-11-20, "B" against the recommendation of a new linked restock): a supplier's reshipping arrives as an INBOUND
//     CUSTOM SHIPMENT, not a new restock; the row comes from a 2026-11-16 discussion (restock.md's 📝 note), not a
//     decision. So it is its OWN test (selling:owner — one role is enough for a conflict check), whose then looks for
//     the new restock the row expects and is marked test.fail with the conflict; beside it every role's test proves
//     what IS built as `regression: resent goods arrive as an inbound parcel` — the Kirim Ulang parcel exists, is linked
//     from the resolution row, and is on the warehouse's Restok Masuk (on its way; its Tiba / Terima are
//     custom_shipments_*'s to drive).
test.describe("resolve restock problem", () => {
  test.describe.configure({ timeout: 150_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const SERVICE = "inventory.v1.RestockRequestService";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  const COND_REFUND = "status: accepted · missing items · money refunded · operational account";
  const COND_RESENT = "status: accepted · broken items · goods resent";
  const CONFLICT =
    "conflict: a-suppliers-reshipping-comes-in-as-a-custom-shipment — resent goods arrive as an inbound parcel, not a new restock";

  const ORDERED = 10;
  const TOTAL = 100_000; // Rp 10.000 a unit
  const MISSING = 2;
  const BROKEN = 2;
  const REFUND = (TOTAL / ORDERED) * MISSING; // Rp 20.000 — what the 2 missing units were paid
  // RestockRequestStatus, as the badges' test ids carry it.
  const ACCEPTED = 2;
  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  // One restock (and one paying account) per role and given; `B-new` is the conflict test's own.
  const REFUND_KEYS = ROLES.map((r) => `A-${r.key}`);
  const RESENT_KEYS = [...ROLES.map((r) => `B-${r.key}`), "B-new"];

  const username = (key: string) => `e2erv${key}${SUFFIX}`;
  const STAFF = `e2ervwh${SUFFIX}`;
  const code = `RVP${SUFFIX}`;
  const resi = (k: string) => `E2E-RV-${k}-${SUFFIX}`.toUpperCase();
  const resentResi = (k: string) => `E2E-RVK-${k}-${SUFFIX}`.toUpperCase();

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

    ground.team = await team(`E2E Rv Seller ${SUFFIX}`, `RVS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Rv Warehouse ${SUFFIX}`, `RVW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    for (const r of ROLES) await user(ground.team, username(r.key), r.role);
    await user(ground.warehouse, STAFF, "ROLE_WAREHOUSE_STAFF");
    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: "e2e-rv", name: "E2E resolve shelf" }))
        .rack.id,
    );

    // The reshipping's supplier is the server's pick — the one every restock line names.
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

    for (const k of [...REFUND_KEYS, ...RESENT_KEYS]) {
      // Its own operational account — the balance and history reads are of this restock alone.
      const name = `E2E Rv ${k} ${SUFFIX}`;
      const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name,
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
      ground.accounts[k] = { id: accountId, name };

      // GIVEN — raised for 10 × Rp 10.000 from that account, and counted in by the warehouse: 33 short by 2, 34 whole
      // with 2 broken (Terima puts Barang kurang / Barang rusak on).
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

  async function signIn(page: Page, user: string, team = ground.team) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // The restock's page, its Resolusi section drawn — the GIVEN: accepted, a problem restock.
  async function openResolutions(page: Page, id: string) {
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId("restock-detail-status").getByTestId(`restock-status-${ACCEPTED}`)).toBeVisible();
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

  // WHEN — Catat Resolusi → Kirim Ulang: the page opens on the problem units (`opens` of the product), the courier picked
  // (JNE), a resi and a note typed, the warehouse left on the restock's; saved, it returns to the restock. Returns the
  // resolution's and its inbound parcel's ids.
  async function recordReshipping(page: Page, id: string, opens: number, k: string, note: string) {
    const pid = ground.product;
    await openResolutions(page, id);
    await pick(page, "reshipping");
    await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}/reshipping$`));
    await expect(page.getByTestId("reshipping-form")).toBeVisible();
    await expect(page.getByTestId(`reshipping-line-${pid}`)).toBeVisible();
    await expect(page.getByTestId(`reshipping-count-${pid}`)).toHaveValue(String(opens));
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
      reshipping: { warehouseId: string; resi: string; lines: { productId: string; count: string }[] };
    };
    expect(String(sent.reshipping.warehouseId)).toBe(ground.warehouse);
    expect(sent.reshipping.lines.map((l) => [String(l.productId), String(l.count)])).toEqual([[pid, String(opens)]]);
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

  const resolutionRows = (page: Page) => page.locator("[data-testid^='resolution-row-'][data-type]");

  // ── 33: missing items, money refunded ──────────────────────────────────────────────────────────────────────────────
  test.describe(`selling:all wants to record the supplier's solution (${COND_REFUND})`, () => {
    for (const r of ROLES) {
      test(`${r.given} resolve restock problem (${COND_REFUND})`, async ({ page }) => {
        const k = `A-${r.key}`;
        const id = ground.restocks[k];
        const account = ground.accounts[k];
        const note = `supplier transfer balik ${r.key} ${SUFFIX}`;
        const row = (resolution: string) => page.getByTestId(`resolution-row-${resolution}`);

        await signIn(page, username(r.key));
        // GIVEN — the payment is on the account; the restock is accepted, 2 short, with no resolution yet.
        const before = await balanceOnceRecorded(page, account.id, `Restock #${id}`);
        await openResolutions(page, id);
        await expect(page.getByTestId("restock-detail-missing")).toContainText(String(MISSING));
        await expect(page.getByTestId("resolution-empty")).toBeVisible();

        // WHEN — as this role.
        const resolution = await recordRefund(page, id, REFUND, account, note);

        await test.step("then: solution recorded on restock", async () => {
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(row(resolution)).toHaveAttribute("data-type", "REFUND");
          await expect.soft(row(resolution).getByTestId("resolution-type-refund")).toBeVisible();
          await expect.soft(page.getByTestId(`resolution-row-${resolution}-refund`)).toHaveText(`${rupiah(REFUND)} into ${account.name}`);
          await expect.soft(page.getByTestId(`resolution-row-${resolution}-note`)).toHaveText(note);
          await expect.soft(page.getByTestId(`resolution-row-${resolution}-when`)).toContainText(username(r.key));
          await expect.soft(resolutionRows(page)).toHaveCount(1);
        });
        await test.step("then: solution shown in restock timeline", async () => {
          const rows = page.locator("[data-testid^='restock-timeline-'][data-kind='resolution']");
          await expect.soft(rows).toHaveCount(1);
          const detail = rows.first().locator("[data-testid$='-detail']");
          await expect.soft(detail.getByTestId("resolution-type-refund")).toBeVisible();
          await expect.soft(detail).toContainText(`${rupiah(REFUND)} into ${account.name}`);
          await expect.soft(rows.first().locator("[data-testid$='-note']")).toHaveText(note);
          await expect.soft(rows.first().locator("[data-testid$='-by']")).toContainText(username(r.key));
        });
        await test.step("then: operational account balance increases by refund", async () => {
          await expect
            .soft(async () => {
              await page.goto(`/financial-accounts/${account.id}`);
              await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(before + REFUND), { timeout: 2_000 });
            })
            .toPass({ timeout: 30_000 });
        });
        await test.step("then: refund recorded in operational account history", async () => {
          const lines = page.locator("[data-testid^='account-log-row-']").filter({ hasText: `Restock #${id} refund` });
          await expect
            .soft(async () => {
              await page.goto(`/financial-accounts/${account.id}`);
              await expect(lines).toHaveCount(1, { timeout: 2_000 });
            })
            .toPass({ timeout: 30_000 });
          await expect.soft(lines.first()).toContainText(rupiah(REFUND).replace("Rp ", ""));
        });
      });
    }
  });

  // ── 34: broken items, goods resent ─────────────────────────────────────────────────────────────────────────────────
  test.describe(`selling:all wants to record the supplier's solution (${COND_RESENT})`, () => {
    for (const r of ROLES) {
      test(`${r.given} resolve restock problem (${COND_RESENT})`, async ({ page }) => {
        const k = `B-${r.key}`;
        const id = ground.restocks[k];
        const note = `supplier kirim ulang ${r.key} ${SUFFIX}`;

        await signIn(page, username(r.key));
        // GIVEN — accepted, 2 broken (the Kirim Ulang page opens on them), no resolution yet.
        await openResolutions(page, id);
        await expect(page.getByTestId("resolution-empty")).toBeVisible();

        // WHEN — as this role.
        const sent = await recordReshipping(page, id, BROKEN, k, note);
        const prefix = `resolution-row-${sent.resolution}`;

        await test.step("then: solution recorded on restock", async () => {
          await page.goto(`/inventories/restock/${id}`);
          await expect.soft(page.getByTestId(prefix)).toHaveAttribute("data-type", "RESHIPPING");
          await expect.soft(page.getByTestId(prefix).getByTestId("resolution-type-reshipping")).toBeVisible();
          await expect.soft(page.getByTestId(`${prefix}-parcel-link`)).toHaveText(`Reshipping #${sent.parcel}`);
          await expect.soft(page.getByTestId(`${prefix}-parcel`).getByTestId("inbound-status-on_the_way")).toBeVisible();
          await expect.soft(page.getByTestId(`${prefix}-parcel`)).toContainText(`${BROKEN} pcs`);
          await expect.soft(page.getByTestId(`${prefix}-note`)).toHaveText(note);
          await expect.soft(page.getByTestId(`${prefix}-when`)).toContainText(username(r.key));
          await expect.soft(resolutionRows(page)).toHaveCount(1);
        });
        // What IS built for the goods sent again (a-suppliers-reshipping-comes-in-as-a-custom-shipment): the parcel exists,
        // the row links it, and its warehouse has it on its way.
        await test.step("regression: resent goods arrive as an inbound parcel", async () => {
          await page.getByTestId(`${prefix}-parcel-link`).click();
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
          await expect.soft(page.getByTestId(`inbound-items-${sent.parcel}`)).toContainText(`${BROKEN} pcs`);
        });
      });
    }

    // ⚠ CONFLICT — its own test (test.fail flips a whole test): the row expects a new restock; the owner decided an
    // inbound custom shipment. The then looks for the new restock on the team's list.
    test(`selling:owner resolve restock problem (${COND_RESENT}): resent goods arrive as new restock`, async ({ page }) => {
      test.fail(true, CONFLICT);
      const id = ground.restocks["B-new"];
      const rows = page.locator('[data-testid^="restock-row-"]');

      await signIn(page, username("own"));
      await page.goto("/inventories/restock");
      await expect(page.getByTestId(`restock-row-${id}`)).toBeVisible();
      const before = await rows.count();

      const sent = await recordReshipping(page, id, BROKEN, "B-new", `supplier kirim ulang new ${SUFFIX}`);
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

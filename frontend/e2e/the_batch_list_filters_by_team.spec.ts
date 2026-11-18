import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { pickTeam } from "./pickers";
import { SUFFIX, api, login } from "./restock_helpers";

// THE BATCH LIST FILTERS BY TEAM — the-batch-list-filters-by-team (docs/technical/frontend/batches_decision.md; owner:
// *"oke, kasih tim"*), on the real server and Postgres. A warehouse holds several selling teams' goods; its Batch list's
// team filter asks *whose*: the rows, the count and the summary cards narrow together to the batches that team owns
// (a-batch-carries-its-owner, docs/business/inventory/warehouse_transfer_decision.md). The pick is held in the URL
// (`?team=`), and Hapus Filter clears it.
//
// A warehouse of the test's own holding exactly three batches: Toko Satu's two (Rp 20.000 + Rp 30.000 ready) and Toko
// Dua's one (Rp 15.000); Toko Tiga holds nothing here.

async function asTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

test("Batch list: the team filter narrows the rows, the count and the cards to the goods that selling team owns", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const warehouse = await team(`E2E BatchTeam Gudang ${SUFFIX}`, `BG${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const sellers = {
    satu: { name: `E2E BatchTeam Satu ${SUFFIX}`, code: `BA${SUFFIX}`, id: "" },
    dua: { name: `E2E BatchTeam Dua ${SUFFIX}`, code: `BB${SUFFIX}`, id: "" },
    tiga: { name: `E2E BatchTeam Tiga ${SUFFIX}`, code: `BC${SUFFIX}`, id: "" },
  };
  for (const s of Object.values(sellers)) s.id = await team(s.name, s.code, "TEAM_TYPE_SELLING");

  const rack = String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `bt-${SUFFIX}`, name: "E2E batch shelf" })).rack.id);
  const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E BatchTeam Cat ${SUFFIX}` })).category.id;

  // A selling team's restock into the warehouse, counted in whole onto the rack — one batch per line. Returns the batch
  // id per product.
  async function stocked(seller: string, tag: string, lines: { part: string; count: number; total: number }[]) {
    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E BatchTeam Kas ${tag} ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `BT-${tag}-${SUFFIX}`,
          openingBalance: 1_000_000,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: seller, accountId: account, operational: true });

    const items = [];
    for (const l of lines) {
      const p = (
        await api(page, "product.v1.ProductService/ProductCreate", { teamId: seller, productCodePart: l.part, name: `E2E ${l.part}`, categoryId: category })
      ).product;
      items.push({ productId: String(p.id), productCode: String(p.productCode || l.part), name: `E2E ${l.part}`, count: l.count, total: l.total });
    }
    const raised = (
      await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: seller,
        warehouseId: warehouse,
        financeAccountId: account,
        receipt: `E2E-BT-${tag}-${SUFFIX}`,
        items,
      })
    ).request;
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: raised.id,
      lines: (raised.items as { id: string; count: string }[]).map((item) => ({
        itemId: item.id,
        receivedCount: Number(item.count),
        placements: [{ placementId: rack, quantity: Number(item.count) }],
      })),
    });

    const batches: string[] = [];
    for (const item of items) {
      const listed = await api(page, "inventory.v1.InventoryService/BatchList", {
        teamId: warehouse,
        filter: { productId: item.productId },
        page: { page: 1, limit: 5 },
      });
      expect(listed.ids).toHaveLength(1);
      batches.push(String(listed.ids[0]));
    }
    return batches;
  }

  // GIVEN — Toko Satu's two batches (2 × Rp 10.000, 3 × Rp 10.000), Toko Dua's one (1 × Rp 15.000), Toko Tiga's none.
  const [a, b] = await stocked(sellers.satu.id, "A", [
    { part: `BTA${SUFFIX}`, count: 2, total: 20_000 },
    { part: `BTB${SUFFIX}`, count: 3, total: 30_000 },
  ]);
  const [c] = await stocked(sellers.dua.id, "B", [{ part: `BTC${SUFFIX}`, count: 1, total: 15_000 }]);
  const row = (id: string) => page.getByTestId(`batches-row-${id}`);

  await test.step("the contract: owner_team_id keeps that team's batches and their ready value; 0 is every team", async () => {
    const list = (ownerTeamId: string) =>
      api(page, "inventory.v1.InventoryService/BatchList", { teamId: warehouse, filter: { ownerTeamId }, page: { page: 1, limit: 20 } });
    const satu = await list(sellers.satu.id);
    expect([...satu.ids].map(String).sort()).toEqual([a, b].sort());
    expect(Number(satu.readyValueTotal)).toBe(50_000);
    expect((await list(sellers.tiga.id)).ids ?? []).toEqual([]);
    expect((await list("0")).ids).toHaveLength(3);
  });

  // WHEN — the warehouse opens its Batch list with no team picked. THEN — every team's: three batches, Rp 65.000 ready.
  await asTeam(page, warehouse);
  await page.goto("/inventories/batches");
  await expect(page.getByTestId("batches-stat-count")).toHaveText("3");
  await expect(page.getByTestId("batches-stat-value")).toContainText("65.000");
  for (const id of [a, b, c]) await expect(row(id)).toBeVisible();

  const filter = page.getByTestId("batches-team-filter");

  await test.step("Toko Satu picked: its two batches, the count and the ready value narrowed with them, held in the URL", async () => {
    await pickTeam(page, filter, sellers.satu.code);
    await expect(page).toHaveURL(new RegExp(`[?&]team=${sellers.satu.id}(&|$)`));
    await expect(row(c)).toHaveCount(0);
    await expect(row(a)).toBeVisible();
    await expect(row(b)).toBeVisible();
    await expect(page.getByTestId("batches-stat-count")).toHaveText("2");
    await expect(page.getByTestId("batches-stat-value")).toContainText("50.000");
    await expect(page.getByTestId(`batches-team-${a}`)).toContainText(sellers.satu.name);

    // A reload keeps the pick: the field names the team, the list stays narrowed.
    await page.reload();
    await expect(page.getByTestId("batches-stat-count")).toHaveText("2");
    await expect(filter.getByTestId("team-select-selected")).toContainText(sellers.satu.name);
    await expect(row(c)).toHaveCount(0);
  });

  await test.step("Hapus Filter: every team's again", async () => {
    await page.getByTestId("batches-filter-clear").click();
    await expect(page).not.toHaveURL(/[?&]team=/);
    await expect(page.getByTestId("batches-stat-count")).toHaveText("3");
    await expect(row(c)).toBeVisible();
  });

  await test.step("Toko Dua picked: its one batch alone", async () => {
    await pickTeam(page, filter, sellers.dua.code);
    await expect(page).toHaveURL(new RegExp(`[?&]team=${sellers.dua.id}(&|$)`));
    await expect(page.getByTestId("batches-stat-count")).toHaveText("1");
    await expect(page.getByTestId("batches-stat-value")).toContainText("15.000");
    await expect(row(c)).toBeVisible();
    await expect(row(a)).toHaveCount(0);
    await expect(row(b)).toHaveCount(0);
    await page.getByTestId("batches-filter-clear").click();
    await expect(page.getByTestId("batches-stat-count")).toHaveText("3");
  });

  await test.step("Toko Tiga, holding nothing here: no rows, a count of 0", async () => {
    await pickTeam(page, filter, sellers.tiga.code);
    await expect(page).toHaveURL(new RegExp(`[?&]team=${sellers.tiga.id}(&|$)`));
    await expect(page.getByTestId("batches-stat-count")).toHaveText("0");
    await expect(page.getByTestId("batches-empty")).toBeVisible();
    for (const id of [a, b, c]) await expect(row(id)).toHaveCount(0);
  });
});

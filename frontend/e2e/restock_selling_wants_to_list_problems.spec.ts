import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── selling:all wants to follow up restock problems — the checks behind docs/acceptances/inventory/restock.md ────────
//
// One test for the GIVEN — (status: accepted · missing items · broken items) — run as EVERY selling role. The problem
// list IS the seller's restock list filtered by the app's two problem tags (a-restock-problem-is-a-system-tag and its
// 🔄 "A": Terima puts *Barang kurang* on when it records missing units and *Barang rusak* when it records broken ones;
// the-restock-tags-prototype-is-accepted: the Tag filter takes several tags, a restock shown when it carries ANY —
// *Barang kurang* + *Barang rusak* together is the problem list). WHEN: the role picks both tags in the list's Tag filter.
// THEN `restock listed with missing and broken count`: the restock is on the filtered list, its row reads its missing
// and broken counts beside the status (*kurang N · rusak N*; *N missing · N broken* in the suite's English) and carries
// both problem chips; a restock with no problem is not on it.
//
// The ground, shared by the three roles — they only READ it, so every count stays exact: one selling team and its
// warehouse; root raises four restocks of 10 pcs and its warehouse counts them in through the API (the accept page has
// its own coverage):
//
//   P  accepted  7 in the box, 2 of them broken → 3 missing · 2 broken  (Barang kurang + Barang rusak) — the given
//   M  accepted  8 in the box                   → 2 missing             (Barang kurang)
//   B  accepted  10 in the box, 1 broken        → 1 broken              (Barang rusak)
//   N  accepted  10 in the box, whole           → no problem, no tag
//   O  ongoing                                  → not counted yet, no tag
//
// M and B show the filter is ANY of the two tags; N and O are on the unfiltered list and must leave it.
//
// The counts are the list's own (backlog #89): RestockRequestList fills each line's missing and broken counts with one
// grouped read per page, and the row draws them as `restock-missing-<id>` / `restock-broken-<id>` — the-restock-tags-
// prototype-is-accepted (*on accepted rows kurang N · rusak N*), a-restock-problem-is-a-system-tag (the problem list is
// the restock "listed with missing and broken count"). A problem alone draws its own count and never the other's.
test.describe("selling:all wants to follow up restock problems", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  const COND = "status: accepted · missing items · broken items";
  const SERVICE = "inventory.v1.RestockRequestService";
  const ORDERED = 10;
  // Per restock: how many were in the box, and how many of those were broken.
  const COUNTS = {
    P: { received: 7, broken: 2 },
    M: { received: 8, broken: 0 },
    B: { received: 10, broken: 1 },
    N: { received: 10, broken: 0 },
  } as const;

  const username = (role: string) => `e2epb${role}${SUFFIX}`;
  const resi = (key: string) => `E2E-PB-${key}-${SUFFIX}`;

  const ground = {
    team: "",
    warehouse: "",
    rack: "",
    kurang: "",
    rusak: "",
    r: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Pb Seller ${SUFFIX}`, `PBS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Pb Warehouse ${SUFFIX}`, `PBW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    ground.rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: "e2e-pb", name: "E2E problem shelf" }))
        .rack.id,
    );
    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.team,
        username: username(r.key),
        password: PASSWORD,
        name: `Pb ${r.given} ${SUFFIX}`,
        role: r.role,
      });
    }

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Pb Cat ${SUFFIX}` });
    const code = `PBP${SUFFIX}`;
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
    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.team,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Pb BCA ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-PB-${SUFFIX}`,
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

    // GIVEN — the restocks, raised for the team, and all but O counted in by its warehouse.
    for (const key of ["P", "M", "B", "N", "O"]) {
      const raised = await api(page, `${SERVICE}/RestockRequestCreate`, {
        teamId: ground.team,
        warehouseId: ground.warehouse,
        financeAccountId: account,
        receipt: resi(key),
        items: [{ productId, productCode: code, name: `E2E ${code}`, count: ORDERED, total: 100_000 }],
      });
      ground.r[key] = String(raised.request.id);
      const counted = COUNTS[key as keyof typeof COUNTS];
      if (!counted) continue;

      await api(page, `${SERVICE}/RestockRequestAccept`, {
        teamId: ground.warehouse,
        requestId: raised.request.id,
        lines: [
          {
            itemId: raised.request.items[0].id,
            receivedCount: counted.received,
            ...(counted.broken > 0 ? { brokenCount: counted.broken, brokenNote: "penyok di jalan" } : {}),
            ...(counted.received < ORDERED ? { missingNote: "tidak ada di kardus" } : {}),
            placements: [{ placementId: ground.rack, quantity: counted.received - counted.broken }],
          },
        ],
      });
    }

    // The app's two problem tags (inventory migration 00055), by their task.
    const listed = await api(page, `${SERVICE}/RestockTagList`, { teamId: "1", q: "Barang", page: { page: 1, limit: 200 } });
    const tags = (listed.tags ?? []) as { id: string; appTask?: string }[];
    ground.kurang = String(tags.find((t) => t.appTask === "restock.problem.missing")?.id ?? "");
    ground.rusak = String(tags.find((t) => t.appTask === "restock.problem.broken")?.id ?? "");
    expect(ground.kurang && ground.rusak, JSON.stringify(tags)).toBeTruthy();

    await page.close();
  });

  async function signIn(page: Page, user: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team);
  }

  // WHEN — one tag picked in the list's Tag filter: the list opened, the name typed to narrow it, the option clicked.
  async function pickTag(page: Page, tagId: string, name: string) {
    const input = page.getByTestId("restock-tag-filter-input");
    const option = page.getByTestId(`restock-tag-filter-option-${tagId}`);
    await input.click();
    await expect(option).toBeVisible();
    await input.fill(name);
    await option.click();
    await expect(page.getByTestId(`restock-tag-filter-pick-${tagId}`)).toBeVisible();
  }

  for (const r of ROLES) {
    test(`${r.given} list problem restock (${COND})`, async ({ page }) => {
      const row = (key: string) => page.getByTestId(`restock-row-${ground.r[key]}`);
      const rows = page.locator('[data-testid^="restock-row-"]');

      await signIn(page, username(r.key));
      await page.goto("/inventories/restock");
      await expect(page.getByTestId("restock-selling-page")).toBeVisible();

      // GIVEN — unfiltered, the team's five restocks, the two with no problem among them.
      await expect(rows).toHaveCount(5);
      await expect(row("N")).toBeVisible();
      await expect(row("O")).toBeVisible();

      // WHEN — the problem list: Barang kurang + Barang rusak picked in the Tag filter.
      await pickTag(page, ground.kurang, "Barang kurang");
      await pickTag(page, ground.rusak, "Barang rusak");
      await page.keyboard.press("Escape");
      await expect.poll(() => new URL(page.url()).searchParams.get("tag")).toBe(`${ground.kurang},${ground.rusak}`);

      await test.step("then: restock listed with missing and broken count", async () => {
        // The given's restock: listed, its missing and broken counts on its row, both problem chips in its Tag cell.
        await expect.soft(row("P")).toBeVisible();
        await expect.soft(row("P").getByTestId(`restock-missing-${ground.r.P}`)).toHaveText("3 missing", { timeout: 5_000 });
        await expect.soft(row("P").getByTestId(`restock-broken-${ground.r.P}`)).toHaveText("2 broken", { timeout: 5_000 });
        await expect.soft(row("P").getByTestId(`restock-tags-${ground.r.P}`).locator("[data-tag-type]")).toHaveText([
          "Barang kurang",
          "Barang rusak",
        ]);

        // Either problem alone is on the list too, with its own count and no other.
        await expect.soft(row("M").getByTestId(`restock-missing-${ground.r.M}`)).toHaveText("2 missing", { timeout: 5_000 });
        await expect.soft(row("M").getByTestId(`restock-broken-${ground.r.M}`)).toHaveCount(0);
        await expect.soft(row("B").getByTestId(`restock-broken-${ground.r.B}`)).toHaveText("1 broken", { timeout: 5_000 });
        await expect.soft(row("B").getByTestId(`restock-missing-${ground.r.B}`)).toHaveCount(0);

        // A restock with no problem is not.
        await expect.soft(row("N")).toHaveCount(0);
        await expect.soft(row("O")).toHaveCount(0);
        await expect.soft(rows).toHaveCount(3);
      });
    });
  }
});

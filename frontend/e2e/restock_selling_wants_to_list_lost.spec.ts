import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── selling:all wants to follow up lost restocks — the checks behind docs/acceptances/inventory/restock.md ─────────────
//
// One test for the GIVEN — (status: lost) — run as EVERY selling role. The lost list IS the seller's restock list on its
// Lost tab (Hilang): every tab is the same list, only the `status` the RPC is sent differs (features/restock/statusTabs.ts),
// and the tab is kept in the URL (`?status=lost`). WHEN: the role opens its restock list and picks the Lost tab.
// THEN `restock listed in lost tab`: every restock of the team that is lost NOW is on it, each with its Lost badge, and
// nothing else is.
//
// `lost` means the parcel never came and is set by the selling team while the restock is ongoing
// (lost-is-set-only-before-the-box-arrives); a lost box that turns up after all is the SAME restock, signed for as
// arrived (a-late-lost-box-is-signed-for-as-arrived) — so it has left the Lost tab, though it was lost once.
//
// The ground, shared by the three roles — they only READ it: one selling team and its warehouse; root raises seven
// restocks of 10 pcs for the team and moves them through the API (each move has its own spec):
//
//   L   lost                         — the given
//   L2  lost                         — a second one: the tab lists every lost restock, not the newest
//   F   lost, then signed for        → arrived (a late box): lost once, not now
//   O   ongoing
//   A   arrived
//   C   accepted (counted in whole)
//   X   cancelled
//
// All seven are on the unfiltered list; on the Lost tab only L and L2 stay.
test.describe("selling:all wants to follow up lost restocks", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  const COND = "status: lost";
  const SERVICE = "inventory.v1.RestockRequestService";
  const ORDERED = 10;
  const LOST = 5; // RESTOCK_REQUEST_STATUS_LOST — the badge's `restock-status-<n>`
  const KEYS = ["L", "L2", "F", "O", "A", "C", "X"] as const;

  const username = (role: string) => `e2elt${role}${SUFFIX}`;
  const resi = (key: string) => `E2E-LT-${key}-${SUFFIX}`;

  const ground = {
    team: "",
    warehouse: "",
    rack: "",
    r: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Lt Seller ${SUFFIX}`, `LTS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Lt Warehouse ${SUFFIX}`, `LTW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    ground.rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: "e2e-lt", name: "E2E lost shelf" }))
        .rack.id,
    );
    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.team,
        username: username(r.key),
        password: PASSWORD,
        name: `Lt ${r.given} ${SUFFIX}`,
        role: r.role,
      });
    }

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Lt Cat ${SUFFIX}` });
    const code = `LTP${SUFFIX}`;
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
          name: `E2E Lt BCA ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-LT-${SUFFIX}`,
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

    // GIVEN — the restocks, raised for the team, then each moved to its status.
    for (const key of KEYS) {
      const raised = await api(page, `${SERVICE}/RestockRequestCreate`, {
        teamId: ground.team,
        warehouseId: ground.warehouse,
        financeAccountId: account,
        receipt: resi(key),
        items: [{ productId, productCode: code, name: `E2E ${code}`, count: ORDERED, total: 100_000 }],
      });
      const requestId = raised.request.id;
      ground.r[key] = String(requestId);

      switch (key) {
        case "L":
        case "L2":
          await api(page, `${SERVICE}/RestockRequestMarkLost`, { teamId: ground.team, requestId, description: "hilang di jalan" });
          break;
        case "F":
          // Given up as lost, then the box turns up and the warehouse signs for it.
          await api(page, `${SERVICE}/RestockRequestMarkLost`, { teamId: ground.team, requestId, description: "hilang di jalan" });
          await api(page, `${SERVICE}/RestockRequestArrive`, { teamId: ground.warehouse, requestId });
          break;
        case "A":
          await api(page, `${SERVICE}/RestockRequestArrive`, { teamId: ground.warehouse, requestId });
          break;
        case "C":
          await api(page, `${SERVICE}/RestockRequestAccept`, {
            teamId: ground.warehouse,
            requestId,
            lines: [
              { itemId: raised.request.items[0].id, receivedCount: ORDERED, placements: [{ placementId: ground.rack, quantity: ORDERED }] },
            ],
          });
          break;
        case "X":
          await api(page, `${SERVICE}/RestockRequestCancel`, { teamId: ground.team, requestId, moneyReturned: false });
          break;
        case "O":
          break;
      }
    }

    await page.close();
  });

  async function signIn(page: Page, user: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team);
  }

  for (const r of ROLES) {
    test(`${r.given} list lost restock (${COND})`, async ({ page }) => {
      const row = (key: string) => page.getByTestId(`restock-row-${ground.r[key]}`);
      const rows = page.locator('[data-testid^="restock-row-"]');

      await signIn(page, username(r.key));
      await page.goto("/inventories/restock");
      await expect(page.getByTestId("restock-selling-page")).toBeVisible();

      // GIVEN — on All Status, the team's seven restocks, the two lost ones and the five that are not.
      await expect(page.getByTestId("restock-tab-all")).toHaveAttribute("aria-selected", "true");
      await expect(rows).toHaveCount(KEYS.length);
      for (const key of KEYS) await expect(row(key)).toBeVisible();

      // WHEN — the Lost tab.
      await page.getByTestId("restock-tab-lost").click();
      await expect(page.getByTestId("restock-tab-lost")).toHaveAttribute("aria-selected", "true");
      await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("lost");

      await test.step("then: restock listed in lost tab", async () => {
        // The given's restock, and the other lost one: listed, each with its Lost badge.
        for (const key of ["L", "L2"]) {
          await expect.soft(row(key)).toBeVisible();
          await expect.soft(row(key).getByTestId(`restock-status-${LOST}`)).toBeVisible();
        }
        // Nothing that is not lost now — the late box signed for as arrived included.
        for (const key of ["F", "O", "A", "C", "X"]) await expect.soft(row(key)).toHaveCount(0);
        await expect.soft(rows).toHaveCount(2);
      });
    });
  }
});

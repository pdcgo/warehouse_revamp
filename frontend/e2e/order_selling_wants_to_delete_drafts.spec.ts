import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";
import { API_URL } from "./env";

// ── selling:all wants to clear drafts — the checks behind docs/acceptances/inventory/order.md (## draft) ───────────
//
// Two GIVENs, one WHEN (delete draft order), each run as EVERY selling role:
//
//   (1 draft)                the role's one draft, deleted from its row's menu   → `draft removed from drafts`
//   (multi drafts selected)  three drafts, two of them ticked, deleted together   → `every selected draft removed`
//
// Nothing expires a draft, so deleting is the only way the list is ever cleared (OrderDraftDelete, "several at once").
// "Removed" is read on three layers: the row leaves the list, it stays gone after a reload (the server's list, not the
// screen's memory), and the draft itself answers not_found to its own author (OrderDraftDetail).
//
// ⚠ A draft is its author's (OrderDraftList / OrderDraftDetail narrow to author_user_id) and there is no "New Draft"
// button — every draft comes in from a third-party app pushing with a person's own login. So each person pushes their
// drafts with THEIR OWN token. Each role × given is its own person, so every list holds exactly that given's drafts.
test.describe.configure({ timeout: 120_000 });

const PASSWORD = "e2e-acceptance-pass-1";
const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
] as const;
const SERVICE = "selling.v1.OrderDraftService";
const TEAM_NAME = `E2E Dd Seller ${SUFFIX}`;

// g = which given the person is for: 1 (1 draft) or m (multi drafts selected).
const username = (key: string, g: string) => `e2edd${key}${g}${SUFFIX}`;
const ref = (key: string, g: string, n: number) => `E2E-DD-${key}${g}-${n}-${SUFFIX}`;

const ground = {
  team: "",
  // The pushed drafts' ids, by `${key}${g}`.
  drafts: {} as Record<string, string[]>,
};

async function push(page: Page, key: string, g: string, count: number) {
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) {
    const res = await api(page, `${SERVICE}/OrderDraftPush`, {
      teamId: ground.team,
      source: "e2e-scraper",
      externalId: ref(key, g, n),
      customerName: "Budi",
      items: [{ externalSku: "MP-1", externalName: "Kaos Polos Hitam L", quantity: 1, unitPrice: "50000" }],
    });
    ids.push(String(res.draft.id));
  }
  ground.drafts[`${key}${g}`] = ids;
}

// The draft as its author asks for it — the HTTP status only (200 = still there, 404 = not_found).
async function detailStatus(page: Page, draftId: string) {
  return page.evaluate(
    async ([teamId, id, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.selling.v1.OrderDraftService/OrderDraftDetail`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamId, draftId: id }),
      });
      return res.status;
    },
    [ground.team, draftId, API_URL] as const,
  );
}

async function signIn(page: Page, user: string) {
  await login(page, user, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team);
}

async function openDrafts(page: Page) {
  await page.goto("/order-drafts");
  await expect(page.getByTestId("team-switcher")).toContainText(TEAM_NAME);
  await expect(page.getByTestId("order-drafts-table")).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const root = await browser.newPage();
  await login(root, ROOT_USERNAME, ROOT_PASSWORD);

  ground.team = String(
    (
      await api(root, "team.v1.TeamService/TeamCreate", {
        name: TEAM_NAME,
        teamCode: `DDR${SUFFIX}`,
        type: "TEAM_TYPE_SELLING",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  for (const r of ROLES) {
    for (const g of ["1", "m"]) {
      await api(root, "user.v1.UserService/CreateUser", {
        teamId: ground.team,
        username: username(r.key, g),
        password: PASSWORD,
        name: `Dd ${r.given} ${g} ${SUFFIX}`,
        role: r.role,
      });
    }
  }
  await root.close();

  // GIVEN — every person pushes their drafts with their own login, the way the app does: one for (1 draft), three for
  // (multi drafts selected).
  for (const r of ROLES) {
    for (const [g, count] of [
      ["1", 1],
      ["m", 3],
    ] as const) {
      const page = await browser.newPage();
      await login(page, username(r.key, g), PASSWORD);
      await push(page, r.key, g, count);
      await page.close();
    }
  }
});

test.describe("selling:all wants to clear drafts (1 draft)", () => {
  for (const r of ROLES) {
    test(`${r.given} delete draft order (1 draft)`, async ({ page }) => {
      const [id] = ground.drafts[`${r.key}1`];
      const draftRef = ref(r.key, "1", 1);
      const row = page.getByTestId(`draft-row-${id}`);
      const rows = page.locator('[data-testid^="draft-row-"]');

      // GIVEN — the role's one draft, on its list.
      await signIn(page, username(r.key, "1"));
      await openDrafts(page);
      await expect(row).toBeVisible();
      await expect(row).toContainText(draftRef);
      await expect(rows).toHaveCount(1);
      await expect(page.getByTestId("draft-summary-total-value")).toHaveText("1");

      // WHEN — the role deletes it from its row's menu, and confirms (destructive actions always confirm).
      await page.getByTestId(`draft-actions-${id}`).click();
      const del = page.getByTestId(`draft-delete-${id}`);
      await expect(del).toBeVisible();
      await del.click();
      await expect(page.getByText(`Delete draft ${draftRef}?`)).toBeVisible();
      await page.getByTestId("confirm-action").click();

      await test.step("then: draft removed from drafts", async () => {
        await expect.soft(page.getByText("1 draft(s) deleted")).toBeVisible();
        // The row leaves the list, and the list is empty — it was the role's only draft.
        await expect.soft(row).toHaveCount(0);
        await expect.soft(page.getByTestId("order-drafts-empty")).toBeVisible();
        await expect.soft(page.getByTestId("draft-summary-total-value")).toHaveText("0");
        // Still gone after a reload: the server's list, not the screen's memory.
        await page.reload();
        await expect(page.getByTestId("order-drafts-table")).toBeVisible();
        await expect.soft(page.getByTestId("order-drafts-empty")).toBeVisible();
        await expect.soft(rows).toHaveCount(0);
        await expect.soft(page.getByText(draftRef)).toHaveCount(0);
        // And the draft itself is gone — its author asking for it is answered not_found.
        expect.soft(await detailStatus(page, id)).toBe(404);
      });
    });
  }
});

test.describe("selling:all wants to clear drafts (multi drafts selected)", () => {
  for (const r of ROLES) {
    test(`${r.given} delete draft order (multi drafts selected)`, async ({ page }) => {
      const ids = ground.drafts[`${r.key}m`];
      const [a, b, kept] = ids;
      const row = (id: string) => page.getByTestId(`draft-row-${id}`);
      const rows = page.locator('[data-testid^="draft-row-"]');

      // GIVEN — the role's three drafts on its list; two of them ticked, the third left alone.
      await signIn(page, username(r.key, "m"));
      await openDrafts(page);
      for (const id of ids) await expect(row(id)).toBeVisible();
      await expect(rows).toHaveCount(3);
      await page.getByTestId(`select-draft-${a}`).click();
      await page.getByTestId(`select-draft-${b}`).click();
      const bulk = page.getByTestId("delete-selected-drafts");
      await expect(bulk).toHaveText(/Delete 2$/);

      // WHEN — the role deletes the selection, and confirms.
      await bulk.click();
      await expect(page.getByText("Delete Order Drafts")).toBeVisible();
      await expect(page.getByText(/^Delete 2 draft\(s\)\?/)).toBeVisible();
      await page.getByTestId("confirm-action").click();

      await test.step("then: every selected draft removed", async () => {
        await expect.soft(page.getByText("2 draft(s) deleted")).toBeVisible();
        // Both ticked drafts leave the list; the unticked one stays — only the selection was deleted.
        await expect.soft(row(a)).toHaveCount(0);
        await expect.soft(row(b)).toHaveCount(0);
        await expect.soft(row(kept)).toBeVisible();
        await expect.soft(row(kept)).toContainText(ref(r.key, "m", 3));
        await expect.soft(rows).toHaveCount(1);
        await expect.soft(page.getByTestId("draft-summary-total-value")).toHaveText("1");
        // The selection is spent: no Delete button is left offering the deleted drafts again.
        await expect.soft(bulk).toHaveCount(0);
        // Still so after a reload — the server's list.
        await page.reload();
        await expect(row(kept)).toBeVisible();
        await expect.soft(rows).toHaveCount(1);
        await expect.soft(page.getByText(ref(r.key, "m", 1))).toHaveCount(0);
        await expect.soft(page.getByText(ref(r.key, "m", 2))).toHaveCount(0);
        // And on the server: each deleted draft answers not_found to its author, the kept one is still there.
        expect.soft(await detailStatus(page, a)).toBe(404);
        expect.soft(await detailStatus(page, b)).toBe(404);
        expect.soft(await detailStatus(page, kept)).toBe(200);
      });
    });
  }
});

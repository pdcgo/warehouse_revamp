import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── selling:all wants to see their drafts — the checks behind docs/acceptances/inventory/order.md (## draft) ─────────
//
// One test for the GIVEN — (own drafts · colleague's drafts) — run as EVERY selling role. WHEN: the role opens its drafts
// list (/order-drafts). THEN `only own drafts shown`: every draft the role pushed is listed, and none a colleague pushed
// in the same team is. A draft is personal working state (docs/business/order — OrderDraftList narrows to the caller's
// author_user_id on top of the team scope): a draft belongs to the login the app pushed it with.
//
// ⚠ There is no "New Draft" button — every draft comes in from a third-party app (drafts-exist-only-for-the-third-party-app),
// which pushes it with a person's own login. So each person here pushes their drafts with THEIR OWN token, exactly as
// the app does; a draft root pushed would be root's, never the role's.
//
// The ground, shared by the three roles — they only READ it: one selling team (root its owner), and in it the three role
// users plus a fourth colleague. Each of the four pushes TWO drafts, and root one:
//
//   own        the role's two                      — listed
//   colleague  the other two roles' two each, the fourth colleague's two, root's one — not listed
//
// so each role's list holds exactly its own two, out of the team's nine.
test.describe("selling:all wants to see their drafts", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  // The fourth person — a colleague of every role above, and no role under test.
  const COLLEAGUE = { given: "selling:cs colleague", role: "ROLE_SELLING_CS", key: "col" } as const;
  const COND = "own drafts · colleague's drafts";
  const SERVICE = "selling.v1.OrderDraftService";
  const PER_PERSON = 2;

  const username = (key: string) => `e2edf${key}${SUFFIX}`;
  const person = (given: string) => `Df ${given} ${SUFFIX}`;
  const ref = (key: string, n: number) => `E2E-DF-${key}-${n}-${SUFFIX}`;

  const ground = {
    team: "",
    // The pushed drafts' ids, by who pushed them (a role's key, "col", or "root").
    drafts: {} as Record<string, string[]>,
  };

  async function push(page: Page, key: string) {
    const ids: string[] = [];
    for (let n = 1; n <= PER_PERSON; n++) {
      const res = await api(page, `${SERVICE}/OrderDraftPush`, {
        teamId: ground.team,
        source: "e2e-scraper",
        externalId: ref(key, n),
        customerName: "Budi",
        items: [{ externalSku: "MP-1", externalName: "Kaos Polos Hitam L", quantity: 1, unitPrice: "50000" }],
      });
      ids.push(String(res.draft.id));
      if (key === "root") break; // root pushes one
    }
    ground.drafts[key] = ids;
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const root = await browser.newPage();
    await login(root, ROOT_USERNAME, ROOT_PASSWORD);

    ground.team = String(
      (
        await api(root, "team.v1.TeamService/TeamCreate", {
          name: `E2E Df Seller ${SUFFIX}`,
          teamCode: `DFS${SUFFIX}`,
          type: "TEAM_TYPE_SELLING",
          ownerUserId: ROOT_USER_ID,
        })
      ).team.id,
    );
    for (const r of [...ROLES, COLLEAGUE]) {
      await api(root, "user.v1.UserService/CreateUser", {
        teamId: ground.team,
        username: username(r.key),
        password: PASSWORD,
        name: person(r.given),
        role: r.role,
      });
    }

    // GIVEN — every person pushes their drafts with their own login, the way the app does.
    await push(root, "root");
    await root.close();
    for (const r of [...ROLES, COLLEAGUE]) {
      const page = await browser.newPage();
      await login(page, username(r.key), PASSWORD);
      await push(page, r.key);
      await page.close();
    }
  });

  async function signIn(page: Page, user: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team);
  }

  for (const r of ROLES) {
    test(`${r.given} list draft order (${COND})`, async ({ page }) => {
      const row = (id: string) => page.getByTestId(`draft-row-${id}`);
      const rows = page.locator('[data-testid^="draft-row-"]');
      const own = ground.drafts[r.key];
      const colleagues = Object.entries(ground.drafts)
        .filter(([key]) => key !== r.key)
        .flatMap(([, ids]) => ids);

      // GIVEN — the role's own two drafts, and seven of its colleagues' in the same team.
      expect(own).toHaveLength(PER_PERSON);
      expect(colleagues).toHaveLength(3 * PER_PERSON + 1);

      // WHEN — the role opens its drafts list, in the team.
      await signIn(page, username(r.key));
      await page.goto("/order-drafts");
      await expect(page.getByTestId("team-switcher")).toContainText(`E2E Df Seller ${SUFFIX}`);
      await expect(page.getByTestId("order-drafts-table")).toBeVisible();

      await test.step("then: only own drafts shown", async () => {
        // Each of its own drafts, under its reference, naming the role's own person as who made it.
        for (const [i, id] of own.entries()) {
          await expect.soft(row(id)).toBeVisible();
          await expect.soft(row(id)).toContainText(ref(r.key, i + 1));
          await expect.soft(row(id)).toContainText(person(r.given));
        }
        // None of a colleague's — the other roles', the fourth colleague's, the owner root's.
        for (const id of colleagues) await expect.soft(row(id)).toHaveCount(0);
        for (const key of Object.keys(ground.drafts).filter((key) => key !== r.key)) {
          await expect.soft(page.getByText(ref(key, 1))).toHaveCount(0);
        }
        // Exactly its two — the list, and the Total card, which reads the server's whole set.
        await expect.soft(rows).toHaveCount(PER_PERSON);
        await expect.soft(page.getByTestId("draft-summary-total-value")).toHaveText(String(PER_PERSON));
      });
    });
  }
});

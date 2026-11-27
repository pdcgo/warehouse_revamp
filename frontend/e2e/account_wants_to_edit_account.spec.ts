import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";

// An owner or an admin of either team type wants to fix an account's details — the check behind
// docs/acceptances/financial_account/account.md, section *accounts*, when *edit account* (given 11).
// The given names selling:owner · selling:admin · warehouse:owner · warehouse:admin: one test per role, each signed in
// as a person of that role, in a team of its OWN holding one active BCA bank account whose holder is PT Melati
// (an-account-has-a-name-and-a-holder: the holder is the name on the real account, fixable later, while the type,
// provider and number stay as recorded).
//
//   11 (active bank BCA · holder changed from PT Melati to PT Melati Jaya) — the row's Account actions → Edit, the
//      dialog opens on the account's own holder, PT Melati Jaya typed over it, Save
//      then: PT Melati Jaya under the account's name, in the list and on its page — the list row's line under the
//            name reads PT Melati Jaya (read afresh after a reload, so it is the server's answer and not the dialog's
//            echo); the account's page draws it in the identity line under its heading
//
// The ground (root, once): a team per role, a person of that role made in it, and its BCA account opened at 0.

const PASSWORD = "e2e-acct-edit-pass-1";
type Side = "selling" | "warehouse";
type Role = { given: string; role: string; key: string; side: Side; n: number };
// n: the role's digit in its team code and its account number.
const MANAGERS: Role[] = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling", n: 1 },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling", n: 2 },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse", n: 3 },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse", n: 4 },
];

// The given's case text, verbatim from account.md — the marking script finds the tests by it.
const C11 = "active bank BCA · holder changed from PT Melati to PT Melati Jaya";

// A username is lowercase letters and digits only.
const username = (r: Role) => `e2eacedit${r.key}${SUFFIX}`;
const teamName = (r: Role) => `E2E Akun Ubah ${r.key} ${SUFFIX}`;
// At most 10 characters: "AJ", the role's digit, the 6-digit SUFFIX.
const teamCode = (r: Role) => `AJ${r.n}${SUFFIX}`;
// Ten digits, like a BCA number: "32", the SUFFIX, "1", the role's digit. Unique app-wide
// (a-real-account-is-recorded-once) — no other spec's numbers start "32".
const number = (r: Role) => `32${SUFFIX}1${r.n}`;

const NAME = "BCA Operasional";
const HOLDER = "PT Melati";
const NEW_HOLDER = "PT Melati Jaya";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const ground = {
  team: {} as Record<string, string>,
  account: {} as Record<string, string>,
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  for (const r of MANAGERS) {
    const team = await api(page, "team.v1.TeamService/TeamCreate", {
      name: teamName(r),
      teamCode: teamCode(r),
      type: r.side === "selling" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    const teamId = String(team.team.id);
    ground.team[r.key] = teamId;

    await api(page, "user.v1.UserService/CreateUser", {
      teamId,
      username: username(r),
      password: PASSWORD,
      name: `Akun Ubah ${r.given} ${SUFFIX}`,
      role: r.role,
    });

    // The given: an ACTIVE bank BCA account whose holder is PT Melati.
    const made = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: NAME,
      accountNumber: number(r),
      holderName: HOLDER,
      openingBalance: 0,
      openingOn: today(),
    });
    ground.account[r.key] = String(made.account.id);
  }

  await page.close();
});

// The role signs in, works in its own team (the active team is per tab, in sessionStorage — TeamContext), and opens
// the Akun list.
async function openAccounts(page: Page, r: Role) {
  await login(page, username(r), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.team[r.key]);
  await page.goto("/financial-accounts");
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(r));
  await expect(page.getByTestId("financial-accounts-table")).toBeVisible();
}

// The row's first cell: the account's name, and the line under it (its holder).
const nameCell = (page: Page, id: string) => page.getByTestId(`account-row-${id}`).locator("td").first();

test.describe(`acct wants to fix an account's details (${C11})`, () => {
  for (const r of MANAGERS) {
    test(`${r.given} edit account (${C11})`, async ({ page }) => {
      const id = ground.account[r.key];
      await openAccounts(page, r);

      // The given on screen: the active BCA account, PT Melati under its name.
      const cell = nameCell(page, id);
      await expect(cell.locator("p").first()).toHaveText(NAME);
      await expect(cell.locator("p").nth(1)).toHaveText(HOLDER);
      await expect(page.getByTestId(`account-archived-${id}`)).toHaveCount(0);

      // The WHEN: Account actions → Edit, the holder typed over.
      await page.getByTestId(`account-actions-${id}`).click();
      const edit = page.getByTestId(`account-edit-${id}`);
      await expect(edit).toBeVisible();
      await edit.click();
      const form = page.getByTestId("account-form");
      await expect(form).toBeVisible();
      await expect(form.getByTestId("account-holder")).toHaveValue(HOLDER);
      // An existing account keeps its type, provider and number — shown, not offered.
      await expect.soft(form.getByTestId("account-fixed-identity")).toContainText(number(r));
      await expect.soft(form.getByTestId("account-number")).toHaveCount(0);
      await form.getByTestId("account-holder").fill(NEW_HOLDER);

      const answered = page.waitForResponse((res: Response) =>
        res.url().endsWith("FinancialAccountService/FinancialAccountUpdate"),
      );
      await form.getByTestId("account-form-save").click();
      const answer = await answered;
      expect(answer.status()).toBe(200);
      await expect(form).toBeHidden();

      await test.step("then: PT Melati Jaya under the account's name, in the list and on its page", async () => {
        // In the list — read afresh, so it is what the server holds now.
        await page.reload();
        await expect(page.getByTestId("financial-accounts-table")).toBeVisible();
        const row = nameCell(page, id);
        await expect(row.locator("p").first()).toHaveText(NAME);
        await expect(row.locator("p").nth(1)).toHaveText(NEW_HOLDER);

        // On its page — the identity line under the heading ends with the new holder.
        await page.getByTestId(`account-row-${id}`).click();
        await expect(page).toHaveURL(new RegExp(`/financial-accounts/${id}(\\?|$)`));
        const heading = page.getByTestId("account-name-heading");
        const identity = page.getByTestId("account-identity");
        await expect(heading).toHaveText(NAME);
        await expect(identity).toHaveText(new RegExp(`${number(r)} · ${NEW_HOLDER}$`));
        const h = await heading.boundingBox();
        const i = await identity.boundingBox();
        expect(h && i && i.y >= h.y + h.height - 1).toBeTruthy();
      });
    });
  }
});

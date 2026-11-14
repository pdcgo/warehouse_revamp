import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE "BY ROOT TEAM" BADGE, END TO END (docs/business/user/context_decision.md — an-override-is-stamped-in-every-service,
// an-override-shows-a-platform-badge, the-override-badge-is-accepted-as-by-root-team) — against the real server and
// Postgres.
//
// A SELLING TEAM ROOT HOLDS NO ROLE IN, owned by Dewi. Root records an expense inside it (in by the root-team bypass, so
// the server stamps `expense_records.is_override`), and Dewi records one of her own. Dewi then opens Expenses: the
// Recorded by column names each person, and root's row — only root's — carries the "by Root team" badge, which explains
// itself on a hover. No order is placed and root's own team is never touched (financial_accounts.spec checks its
// totals); the file sorts after statement.spec.ts all the same.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-badge-pass-1";
// A username is lowercase letters and digits only.
const DEWI = `e2ebadgedewi${SUFFIX}`;
const DEWI_NAME = `Dewi Badge ${SUFFIX}`;

/** A Jakarta day `ago` days before today. */
const day = (ago: number) =>
  new Date(Date.now() - ago * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

async function login(page: Page, username = ROOT_USERNAME, password = ROOT_PASSWORD) {
  await signIn(page, username, password);
}

// The real contract under the signed-in token; a refusal fails here, by name.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
  ) as Promise<T>;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const state = { team: "", account: "", dewi: "", byRoot: "", byDewi: "" };

async function recordExpense(page: Page, note: string, amount: number): Promise<string> {
  return (
    await rpc<{ expense: { id: string } }>(page, "expense.v1.ExpenseService/ExpenseCreate", {
      teamId: state.team,
      kind: "EXPENSE_KIND_OPERATIONAL",
      amount,
      occurredAt: day(0),
      note,
      financeAccountId: state.account,
    })
  ).expense.id;
}

test.describe.configure({ mode: "serial" });

test("Setup: a selling team owned by Dewi, root not in it, with a paying account", async ({ page }) => {
  await login(page);

  // TeamCreate names an EXISTING person as the Owner (the-create-team-form-names-the-first-owner), so Dewi's account is
  // made first, in a scratch team of root's — the team under test is then hers, and root holds no role in it.
  const scratch = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Badge Scratch ${SUFFIX}`,
      teamCode: `BS${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  state.dewi = (
    await rpc<{ user: { id: string } }>(page, "user.v1.UserService/CreateUser", {
      teamId: scratch,
      username: DEWI,
      password: PASSWORD,
      name: DEWI_NAME,
      role: "ROLE_SELLING_ADMIN",
    })
  ).user.id;

  state.team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Badge Seller ${SUFFIX}`,
      teamCode: `BG${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: state.dewi,
    })
  ).team.id;

  state.account = (
    await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E Badge BCA ${SUFFIX}`,
      holderName: "PT E2E",
      accountNumber: `77${SUFFIX}01`,
      openingBalance: 5_000_000,
      openingOn: day(3),
    })
  ).account.id;
  // An expense is paid from an operational account (an-expense-must-name-the-account-that-paid).
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.team,
    accountId: state.account,
    operational: true,
  });
});

// Each person signs in on a fresh page of their own — one test each.
test("Root records an expense inside Dewi's team", async ({ page }) => {
  await login(page);
  state.byRoot = await recordExpense(page, "e2e badge — recorded by root", 125_000);
});

test("Dewi records one of her own, and the read says only root's is an override", async ({ page }) => {
  await login(page, DEWI, PASSWORD);
  state.byDewi = await recordExpense(page, "e2e badge — recorded by dewi", 80_000);

  // The read the screen draws from says it too: root's row is the override, Dewi's is not.
  const listed = await rpc<{ items: { expense?: { mapData: Record<string, { isOverride?: boolean; createdBy: string }> } }[] }>(
    page,
    "expense.v1.ExpenseService/ExpenseList",
    { teamId: state.team, filter: { from: day(0), to: day(0) }, page: { page: 1, limit: 10 } },
  );
  const rows = listed.items.find((item) => item.expense)?.expense?.mapData ?? {};
  expect(rows[state.byRoot]?.createdBy).toBe(ROOT_USER_ID);
  expect(rows[state.byRoot]?.isOverride).toBe(true);
  // proto3 JSON leaves a false out.
  expect(rows[state.byDewi]?.isOverride ?? false).toBe(false);
});

test("Dewi sees who recorded each expense, and the root team's badge on root's only", async ({ page }) => {
  await login(page, DEWI, PASSWORD);
  await useTeam(page, state.team);
  await page.goto("/expenses");

  const rootsBy = page.getByTestId(`expense-by-${state.byRoot}`);
  const dewisBy = page.getByTestId(`expense-by-${state.byDewi}`);

  // The Recorded by column names the person — root by name, Dewi by hers.
  await expect(rootsBy).toContainText(/root/i);
  await expect(dewisBy).toContainText(DEWI_NAME);

  // The badge sits on root's row, reads "by Root team", and on no other row.
  const badge = rootsBy.getByTestId("root-team-badge");
  await expect(badge).toHaveText("by Root team");
  await expect(dewisBy.getByTestId("root-team-badge")).toHaveCount(0);
  await expect(page.getByTestId("expenses-table").getByTestId("root-team-badge")).toHaveCount(1);

  // It explains itself on a hover. An Ark tooltip opens on pointer MOVES, so come in from outside the badge in steps.
  const box = (await badge.boundingBox())!;
  await page.mouse.move(box.x - 40, box.y - 40);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await expect(page.getByTestId("root-team-badge-hint")).toContainText(
    "Root or the System Administrator did this inside this team",
  );
});

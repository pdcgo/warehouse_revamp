import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { asRoot, call, root, login as tokenOf, signInAs, today } from "./metric_ground";

// selling owner · admin · warehouse owner want to move money between accounts — the checks behind
// docs/acceptances/financial_account/transfer.md, when *transfer* (givens 1–7, 9, 10) and *transfer out* (given 8 — the
// same dialog, opened from an unknown account's Transfer Out). An acceptance has no test file of its own
// (docs/acceptances/guide.md): one test.describe per given (its case in
// parentheses VERBATIM), per role a test, one test.step("then: …") per then, stored verbatim (acceptance_mark.py matches
// the literal text). A step that is no then is named `regression: …`.
//
// Business rules (docs/business/financial_account/context_decision.md):
// - opening-transfer-and-team-payment-join-the-types — a transfer is two rows in one act: `transfer` out of one of the
//   team's accounts and `transfer` into another; the team's total nets to zero.
// - below-zero-is-warned-never-refused — the dialog warns (transfer-below-zero) and saves; the page marks the balance.
// - the-log-keeps-the-day-the-money-moved — both rows carry the picked day; a day after today cannot be picked (the
//   DatePicker's max), and the server refuses one too (errFutureDay).
// - an archived account is out of every picker, and an unknown account is never a transfer's To
//   (a-shop-with-no-account-gets-an-unknown-one; FinancialAccountSelect leaves both out, the server refuses both).
// - the-warehouse-admin-equals-the-owner-except-money — a warehouse Admin keeps the accounts and reconciles (Match
//   Balance) but moves no money; selling CS and warehouse Staff only read (seeing-is-team-wide-moving-is-admin-and-up).
// - financial-accounts-serve-their-changes-and-their-types (analytic) — Account changes carries a `transfer` column per
//   account: Analytic writes the out leg −Rp …, the in leg bare Rp ….
//
// THE WHEN, as the person does it: on the From account's page (/financial-accounts/<id>), Transfer
// (account-transfer-button-<id>) → the dialog (`transfer`): To (`transfer-to` → `transfer-to-option-<id>`), the amount
// (`transfer-amount`), the day the money moved (`transfer-on`, today by default), the note (`transfer-note`), Transfer
// (`transfer-save`).
//
// GROUND (beforeAll, as root, through the API from the test runner): one selling team and one warehouse team, a person
// of every role in each. Per moving role and given, accounts of its own (the given's BCA and ShopeePay — names carry the
// given and the role), so each role's figures are exactly its given's; the givens with no balance open BCA at
// Rp 500.000. Given 6's ShopeePay opens at Rp 0 and is archived. Given 7's unknown account is the side's: the selling
// team's comes from a withdrawal of its shop Melati, which names no account (pushed to the withdrawal listener's route
// as Pub/Sub would deliver it). ⚠ A WAREHOUSE owns no shop: its unknown account comes from a withdrawal of a shop id no
// shop has, pushed the same way (account_wants_to_read_an_accounts_rows.spec.ts's door) — named in the report for the
// owner. Givens 9 and 10: a BCA of Rp 1.000.000 per refused role.
//
// GIVEN 8 (*transfer out*, an-unknown-account-is-filled-in-or-moved-in — "an unknown account only from the listener,
// transfer out only"): per moving role an unknown account of its OWN — a shop names one account, so each role's
// Rp 300.000 comes from a Melati of its own (the warehouse's: a shop id of its own, the ⚠ above) — and an active BCA
// TikTok at Rp 500.000 (the given names no balance). THE WHEN: on the unknown account's page, Transfer Out
// (account-transfer-button-<id>, labelled *Transfer Out*) → the same dialog → To BCA TikTok, the whole Rp 300.000.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-acct-transfer-pass-1";

type Side = "selling" | "warehouse";
type Role = { given: string; role: string; key: string; side: Side };

const MOVERS: Role[] = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling" },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse" },
];
const WADMIN: Role = { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse" };
const LOOKERS: Role[] = [
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "scs", side: "selling" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "wstf", side: "warehouse" },
];
const EVERYONE: Role[] = [...MOVERS, WADMIN, ...LOOKERS];
const SIDES: Side[] = ["selling", "warehouse"];

// The givens' cases, verbatim from transfer.md — the marking script finds the tests by them.
const C1 = `active bank BCA Rp 1.000.000 · active wallet ShopeePay Rp 0 · Rp 200.000 from BCA to ShopeePay · today · note "ShopeePay top-up"`;
const C2 = "active bank BCA Rp 100.000 · active wallet ShopeePay · Rp 300.000 from BCA to ShopeePay";
const C3 = "active bank BCA · active wallet ShopeePay · from BCA to ShopeePay · money moved yesterday";
const C4 = "active bank BCA · active wallet ShopeePay · from BCA to ShopeePay · day tomorrow";
const C5 = "active bank BCA · active wallet ShopeePay · from BCA to ShopeePay · amount Rp 0";
const C6 = "transfer from active bank BCA · wallet ShopeePay already archived";
const C7 = "transfer from active bank BCA · an unknown account made by Melati's withdrawal";
const C8 = "unknown account Rp 300.000 from Melati · active bank BCA TikTok · from the unknown account to BCA TikTok";
// Givens 9 and 10 share this case; their roles and thens tell them apart.
const C9 = "active bank BCA Rp 1.000.000";

const NOTE = "ShopeePay top-up";
const OPENING = 500_000; // a BCA whose given names no balance
const MOVED = 50_000; // givens 3–5's amount
const MELATI_WITHDRAWAL = 300_000;

const TRANSFER_RPC = "financial_account.v1.FinancialAccountService/FinancialAccountTransfer";
const CHANGES = "metrics/financial_accounts";

// A username is lowercase letters and digits only.
const username = (key: string) => `e2eftrf${key}${SUFFIX}`;
const teamName = (s: Side) => `E2E Transfer Akun ${s} ${SUFFIX}`;
// At most 10 characters: "FT", the side's letter, the 6-digit SUFFIX.
const tag = (s: Side) => (s === "selling" ? "S" : "W");
const bcaName = (g: number, key: string) => `E2E BCA ${g} ${key} ${SUFFIX}`;
const spName = (g: number, key: string) => `E2E ShopeePay ${g} ${key} ${SUFFIX}`;
const MELATI = `E2E Melati Transfer ${SUFFIX}`;
// The warehouse's shop: a shop id no shop has (the ⚠ above). Its own base, clear of the other account specs' ids.
const ORPHAN_SHOP = String(42_000_000 + Number(SUFFIX.slice(-5)) * 10 + 1);
// Given 8: each moving role's own Melati — a shop on the selling side, the next free id of the base on the warehouse's.
const melati8 = (r: Role) => `E2E Melati 8 ${r.key} ${SUFFIX}`;
const orphanShop8 = (r: Role) => String(Number(ORPHAN_SHOP) + 1 + MOVERS.indexOf(r));
const tiktokName = (key: string) => `E2E BCA TikTok 8 ${key} ${SUFFIX}`;
// How the page heads an unknown account (the-unknown-account-reads-lainnya): by its shop's name, or — for a shop id the
// team does not have — its stored name with the prefix dropped.
const shownUnknown8 = (r: Role) => (r.side === "selling" ? melati8(r) : `shop #${orphanShop8(r)}`);

// The business's day (Jakarta), `n` days from today.
const dayFrom = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// Rupiah as the app prints it: "Rp 1.400.000", "−Rp 200.000".
const rp = (n: number) => `${n < 0 ? "−" : ""}Rp ${Math.abs(n).toLocaleString("id-ID")}`;

const ground = {
  team: {} as Record<Side, string>,
  // `${given}-${key}` → the given's accounts for that role
  bca: {} as Record<string, string>,
  sp: {} as Record<string, string>,
  unknown: {} as Record<Side, string>,
  // given 8, per moving role's key: its own unknown account and BCA TikTok
  out: {} as Record<string, { unknown: string; tiktok: string }>,
};
const slot = (g: number, r: Role) => `${g}-${r.key}`;

// ── the API ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An RPC that may be refused: its HTTP status and body, never a throw. */
async function send(token: string, method: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${API_URL}/warehouse.${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  return { status: res.status, text: await res.text() };
}

type LogRow = { id: string; changeType?: string; change?: number; balanceAfter?: number; description?: string; occurredAt?: string };

/** Every row of an account's statement, newest entry first, asked as `token`. */
async function rowsOf(token: string, teamId: string, accountId: string): Promise<LogRow[]> {
  const res = await call<{ items?: { log?: { mapData?: Record<string, LogRow> } }[] }>(
    token,
    "financial_account.v1.FinancialAccountService/FinancialAccountLogList",
    { teamId, filter: { accountId }, dataRequest: ["FINANCIAL_ACCOUNT_LOG_LIST_DATA_TYPE_LOG"], page: { page: 1, limit: 50 } },
  );
  const rows: LogRow[] = [];
  for (const item of res.items ?? []) rows.push(...Object.values(item.log?.mapData ?? {}));

  return rows.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0));
}

const transfersOf = async (token: string, teamId: string, accountId: string) =>
  (await rowsOf(token, teamId, accountId)).filter((r) => r.changeType === "FINANCIAL_ACCOUNT_CHANGE_TYPE_TRANSFER");

/** The account ids of the team's list, filtered as `filter`, asked as `token`. */
async function listIds(token: string, teamId: string, filter: Record<string, unknown>): Promise<string[]> {
  const res = await call<{ ids?: string[] }>(token, "financial_account.v1.FinancialAccountService/FinancialAccountList", {
    teamId,
    filter,
    dataRequest: ["FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT"],
    page: { page: 1, limit: 200 },
  });

  return (res.ids ?? []).map(String);
}

const KIND = {
  bank: { type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT", provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA" },
  wallet: { type: "FINANCIAL_ACCOUNT_TYPE_WALLET", provider: "FINANCIAL_ACCOUNT_PROVIDER_SHOPEEPAY" },
} as const;

/** An account of the team's, opened today at `opening`. */
async function account(teamId: string, name: string, number: string, opening: number, kind: keyof typeof KIND) {
  const res = await asRoot<{ account: { id: string } }>("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId,
    ...KIND[kind],
    name,
    holderName: "E2E",
    accountNumber: number,
    openingBalance: opening,
    openingOn: today(),
  });

  return String(res.account.id);
}

// A Pub/Sub push as the broker delivers it to a listener's route.
function pushBody(eventType: string, subscription: string, event: Record<string, unknown>) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString("base64"),
      attributes: { event_type: `warehouse.events.v1.${eventType}` },
      messageId: `${String(event.eventId)}-${Date.now()}`,
    },
    subscription: `projects/warehouse-dev/subscriptions/${subscription}`,
  };
}

// Settlement's withdrawal row for `shopId` (negative there: money arriving at the account the shop withdraws into —
// here none, so an unknown one is made).
async function pushWithdrawal(eventId: string, teamId: string, shopId: string, change: number) {
  const res = await fetch(`${API_URL}/event/financial-account-withdrawal/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      pushBody("SettlementLogPosted", "financial-account-withdrawal", {
        eventId,
        occurredAt: new Date().toISOString(),
        aggregateId: `settlement-log:${eventId}`,
        settlementLogPosted: {
          teamId,
          shopId,
          settlementType: "SETTLEMENT_TYPE_WITHDRAWAL",
          sourceType: "SOURCE_TYPE_IMPORTER",
          change: String(change),
          postedOn: today(),
          occurredOn: today(),
        },
      }),
    ),
  });
  expect(res.status, `withdrawal push ${eventId}`).toBe(200);
}

// ── the ground ───────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);

  for (const s of SIDES) {
    const team = await asRoot<{ team: { id: string } }>("team.v1.TeamService/TeamCreate", {
      name: teamName(s),
      teamCode: `FT${tag(s)}${SUFFIX}`,
      type: s === "selling" ? "TEAM_TYPE_SELLING" : "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    });
    const teamId = String(team.team.id);
    ground.team[s] = teamId;

    for (const r of EVERYONE.filter((x) => x.side === s)) {
      await asRoot("user.v1.UserService/CreateUser", {
        teamId,
        username: username(r.key),
        password: PASSWORD,
        name: `Transfer ${r.given} ${SUFFIX}`,
        role: r.role,
      });
    }

    // Given 7's unknown account: a withdrawal of a shop that names no account (the ⚠ above for the warehouse).
    let shop = ORPHAN_SHOP;
    if (s === "selling") {
      shop = String(
        (
          await asRoot<{ shop: { id: string } }>("selling.v1.ShopService/ShopCreate", {
            teamId,
            name: MELATI,
            shopCode: `FTM${SUFFIX}`,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
    }
    await pushWithdrawal(`e2e-ftrf-melati-${tag(s)}-${SUFFIX}`, teamId, shop, -MELATI_WITHDRAWAL);
    await expect
      .poll(async () => (await listIds(await root(), teamId, { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] }))[0] ?? "", {
        timeout: 30_000,
        message: `${s}'s unknown account`,
      })
      .not.toBe("");
    ground.unknown[s] = (await listIds(await root(), teamId, { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] }))[0]!;

    // Given 8: per moving role of this side, an unknown account of its own — Rp 300.000 withdrawn by its own Melati
    // (one at a time, so the new unknown account is the one not seen before).
    const known = new Set([ground.unknown[s]]);
    for (const r of MOVERS.filter((x) => x.side === s)) {
      let shop8 = orphanShop8(r);
      if (s === "selling") {
        shop8 = String(
          (
            await asRoot<{ shop: { id: string } }>("selling.v1.ShopService/ShopCreate", {
              teamId,
              name: melati8(r),
              shopCode: `F8${r.key.toUpperCase()}${SUFFIX}`,
              marketplace: "MARKETPLACE_SHOPEE",
            })
          ).shop.id,
        );
      }
      await pushWithdrawal(`e2e-ftrf-out-${r.key}-${SUFFIX}`, teamId, shop8, -MELATI_WITHDRAWAL);
      let unknown = "";
      await expect
        .poll(
          async () => {
            const ids = await listIds(await root(), teamId, { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] });
            unknown = ids.find((id) => !known.has(id)) ?? "";

            return unknown;
          },
          { timeout: 30_000, message: `${r.given}'s unknown account (given 8)` },
        )
        .not.toBe("");
      known.add(unknown);
      ground.out[r.key] = { unknown, tiktok: "" };
    }
  }

  // Per moving role, each given's own BCA and ShopeePay.
  const openings: Record<number, [number, number]> = {
    1: [1_000_000, 0],
    2: [100_000, 0],
    3: [OPENING, 0],
    4: [OPENING, 0],
    5: [OPENING, 0],
    6: [OPENING, 0],
  };
  for (const r of MOVERS) {
    const teamId = ground.team[r.side];
    for (const g of [1, 2, 3, 4, 5, 6, 7]) {
      const k = slot(g, r);
      ground.bca[k] = await account(teamId, bcaName(g, r.key), `E2E-FTRF-${g}B-${r.key}-${SUFFIX}`, openings[g]?.[0] ?? OPENING, "bank");
      if (g === 7) continue; // given 7's other side is the unknown account
      ground.sp[k] = await account(teamId, spName(g, r.key), `E2E-FTRF-${g}P-${r.key}-${SUFFIX}`, openings[g]![1], "wallet");
    }
    // Given 6: ShopeePay already archived (archived only at zero — it opened at Rp 0).
    await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountArchive", {
      teamId,
      accountId: ground.sp[slot(6, r)],
    });
    // Given 8: BCA TikTok, active.
    ground.out[r.key]!.tiktok = await account(teamId, tiktokName(r.key), `E2E-FTRF-8T-${r.key}-${SUFFIX}`, OPENING, "bank");
  }

  // Givens 9 and 10: a BCA of Rp 1.000.000 per refused role.
  for (const r of [WADMIN, ...LOOKERS]) {
    const g = r === WADMIN ? 9 : 10;
    ground.bca[slot(g, r)] = await account(
      ground.team[r.side],
      bcaName(g, r.key),
      `E2E-FTRF-${g}B-${r.key}-${SUFFIX}`,
      1_000_000,
      "bank",
    );
  }
});

// ── the screen ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Signed in as the role, in its side's team, on the account's page. */
async function openAccount(page: Page, r: Role, accountId: string, name: string) {
  await signInAs(page, username(r.key), PASSWORD, ground.team[r.side]);
  await page.goto(`/financial-accounts/${accountId}`);
  await expect(page.getByTestId("team-switcher")).toContainText(teamName(r.side));
  await expect(page.getByTestId("account-name-heading")).toHaveText(name);
}

/** The account's page again, as the signed-in role. */
async function revisit(page: Page, accountId: string, name: string) {
  await page.goto(`/financial-accounts/${accountId}`);
  await expect(page.getByTestId("account-name-heading")).toHaveText(name);
}

/** THE WHEN's door: Transfer on the From account's page, the dialog open. */
async function openTransfer(page: Page, from: string): Promise<Locator> {
  await page.getByTestId(`account-transfer-button-${from}`).click();
  const dialog = page.getByTestId("transfer");
  await expect(dialog).toBeVisible();

  return dialog;
}

/** The To picker opened — its options are inline in the dialog. */
async function openTo(page: Page) {
  await page.getByTestId("transfer-to").click();
}

async function pickTo(page: Page, to: string) {
  await openTo(page);
  const option = page.getByTestId(`transfer-to-option-${to}`);
  await expect(option).toBeVisible();
  await option.click();
  await expect(option).toBeHidden();
}

/** Transfer pressed — the answer awaited (200) and the dialog closed. */
async function save(page: Page) {
  const answered = page.waitForResponse((res) => res.url().endsWith(`/warehouse.${TRANSFER_RPC}`));
  await page.getByTestId("transfer-save").click();
  expect((await answered).status()).toBe(200);
  await expect(page.getByTestId("transfer")).toBeHidden();
}

/** The day picker opened on the dialog's day. */
async function openCalendar(page: Page): Promise<Locator> {
  await page.getByTestId("transfer-on").click();
  const content = page.getByTestId("transfer-on-content");
  await expect(content).toBeVisible();

  return content;
}

const dayCell = (content: Locator, iso: string) =>
  content.locator(`[data-part="table-cell-trigger"][data-value="${iso}"]:not([data-outside-range])`).filter({ visible: true });

/** A statement row's cells: Date · Type · Description · Change · Balance. */
const cellsOf = (page: Page, logId: string) => page.getByTestId(`account-log-row-${logId}`).locator("td");

/** The team's total on the Akun list, once it has answered. */
async function teamTotal(page: Page): Promise<string> {
  await page.goto("/financial-accounts");
  await expect(page.getByTestId("financial-accounts-page")).toBeVisible();
  const value = page.getByTestId("account-total-team-value");
  await expect(value).toHaveText(/Rp/);

  return (await value.innerText()).trim();
}

// ── 1 · Rp 200.000 from BCA (Rp 1.000.000) to ShopeePay (Rp 0), today, note "ShopeePay top-up" ───────────────────────

test.describe(`selling owner · admin · warehouse owner wants to move money between accounts (${C1})`, () => {
  for (const r of MOVERS) {
    test(`${r.given} transfer (${C1})`, async ({ page }) => {
      const k = slot(1, r);
      const [bca, sp] = [ground.bca[k]!, ground.sp[k]!];
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      // The given: ShopeePay at Rp 0, BCA at Rp 1.000.000 — and the team's total before.
      await openAccount(page, r, sp, spName(1, r.key));
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(0));
      const totalBefore = await teamTotal(page);
      await revisit(page, bca, bcaName(1, r.key));
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(1_000_000));

      // The WHEN: Rp 200.000 to ShopeePay, today (the dialog's default day), with the note.
      await openTransfer(page, bca);
      await pickTo(page, sp);
      await page.getByTestId("transfer-amount").fill("200000");
      await page.getByTestId("transfer-note").fill(NOTE);
      await save(page);

      await test.step("then: BCA Rp 800.000, ShopeePay Rp 200.000", async () => {
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(800_000));
        await revisit(page, sp, spName(1, r.key));
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(200_000));
      });

      await test.step("then: a transfer row in each account, with the note", async () => {
        const [outLeg] = await transfersOf(token, teamId, bca);
        const [inLeg] = await transfersOf(token, teamId, sp);
        expect(outLeg, "BCA's transfer row").toBeTruthy();
        expect(inLeg, "ShopeePay's transfer row").toBeTruthy();
        expect((await transfersOf(token, teamId, bca)).length).toBe(1);
        expect((await transfersOf(token, teamId, sp)).length).toBe(1);

        // On ShopeePay's page (open now): Transfer, +Rp 200.000, the note.
        const inCells = cellsOf(page, inLeg!.id);
        await expect(inCells.nth(1)).toHaveText("Transfer");
        await expect(inCells.nth(2)).toContainText(NOTE);
        await expect(inCells.nth(3)).toHaveText(`+${rp(200_000)}`);

        // On BCA's page: Transfer, −Rp 200.000, the note.
        await revisit(page, bca, bcaName(1, r.key));
        const outCells = cellsOf(page, outLeg!.id);
        await expect(outCells.nth(1)).toHaveText("Transfer");
        await expect(outCells.nth(2)).toContainText(NOTE);
        await expect(outCells.nth(3)).toHaveText(rp(-200_000));
      });

      await test.step("then: total balance unchanged", async () => {
        expect(await teamTotal(page)).toBe(totalBefore);
      });

      await test.step("then: recorded in finance analytic metric", async () => {
        // Analytic › Account changes by account over the last 7 days, narrowed to the two accounts: the out leg on BCA,
        // the in leg on ShopeePay (re-read until the figures land).
        await expect(async () => {
          await page.goto(`/analytic?g=account&m=${CHANGES}&r=7d&acc=${bca},${sp}`);
          await expect(page.getByTestId(`analytic-cell-${bca}-transfer`)).toHaveText(rp(-200_000), { timeout: 3_000 });
          await expect(page.getByTestId(`analytic-cell-${sp}-transfer`)).toHaveText(rp(200_000), { timeout: 3_000 });
        }).toPass({ timeout: 40_000 });
        await expect(page.getByTestId(`analytic-row-${sp}`)).toContainText(spName(1, r.key));
      });
    });
  }
});

// ── 2 · Rp 300.000 from BCA (Rp 100.000) — below zero, warned, saved ─────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner wants to move money between accounts (${C2})`, () => {
  for (const r of MOVERS) {
    test(`${r.given} transfer (${C2})`, async ({ page }) => {
      const k = slot(2, r);
      const [bca, sp] = [ground.bca[k]!, ground.sp[k]!];
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      await openAccount(page, r, bca, bcaName(2, r.key));
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(100_000));

      // The WHEN: Rp 300.000 to ShopeePay.
      await openTransfer(page, bca);
      await pickTo(page, sp);
      await page.getByTestId("transfer-amount").fill("300000");

      await test.step("then: warned before saving that BCA will be below zero", async () => {
        await expect(page.getByTestId("transfer-below-zero")).toBeVisible();
        await expect(page.getByTestId("transfer-below-zero")).toContainText(`${bcaName(2, r.key)} will be below zero`);
        await expect(page.getByTestId("transfer-after")).toHaveText(`${bcaName(2, r.key)} after: ${rp(-200_000)}`);
        // Warned, never refused: Transfer stays enabled — and nothing is posted before it is pressed.
        await expect(page.getByTestId("transfer-save")).toBeEnabled();
        expect(await transfersOf(token, teamId, bca)).toHaveLength(0);
      });

      await save(page);

      await test.step("then: saved, BCA −Rp 200.000 marked below zero", async () => {
        const balance = page.getByTestId("account-detail-balance");
        await expect(balance).toHaveText(rp(-200_000));
        await expect(balance).toHaveAttribute("data-below-zero", "true");
        await expect(page.getByTestId("account-detail-balance-below-zero")).toBeVisible();
        await expect(page.getByTestId("account-detail-below-zero")).toBeVisible();
        const [outLeg] = await transfersOf(token, teamId, bca);
        expect(outLeg?.change).toBe(-300_000);
        expect(outLeg?.balanceAfter).toBe(-200_000);
      });
    });
  }
});

// ── 3 · the money moved yesterday ────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner wants to move money between accounts (${C3})`, () => {
  for (const r of MOVERS) {
    test(`${r.given} transfer (${C3})`, async ({ page }) => {
      const k = slot(3, r);
      const [bca, sp] = [ground.bca[k]!, ground.sp[k]!];
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);
      const yesterday = dayFrom(-1);

      await openAccount(page, r, bca, bcaName(3, r.key));

      // The WHEN: Rp 50.000 to ShopeePay, yesterday picked on the calendar.
      await openTransfer(page, bca);
      await pickTo(page, sp);
      await page.getByTestId("transfer-amount").fill(String(MOVED));
      const trigger = page.getByTestId("transfer-on");
      const todayLabel = (await trigger.innerText()).trim();
      const content = await openCalendar(page);
      if (yesterday.slice(0, 7) !== today().slice(0, 7)) {
        await content.locator('[data-part="prev-trigger"]').filter({ visible: true }).click();
      }
      await dayCell(content, yesterday).click();
      await expect(content).toBeHidden();
      await expect(trigger).not.toHaveText(todayLabel);
      const yesterdayLabel = (await trigger.innerText()).trim();
      await save(page);

      await test.step("then: both rows on yesterday's date", async () => {
        const [outLeg] = await transfersOf(token, teamId, bca);
        const [inLeg] = await transfersOf(token, teamId, sp);
        const jakartaDay = (stamp?: string) => (stamp ? new Date(stamp).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) : "");
        expect(jakartaDay(outLeg?.occurredAt), "BCA's row's day").toBe(yesterday);
        expect(jakartaDay(inLeg?.occurredAt), "ShopeePay's row's day").toBe(yesterday);

        // On each page the row's date is yesterday's, as the picker wrote it.
        await revisit(page, bca, bcaName(3, r.key));
        await expect(cellsOf(page, outLeg!.id).nth(0).locator("p").first()).toHaveText(yesterdayLabel);
        await expect(cellsOf(page, outLeg!.id).nth(1)).toHaveText("Transfer");
        await revisit(page, sp, spName(3, r.key));
        await expect(cellsOf(page, inLeg!.id).nth(0).locator("p").first()).toHaveText(yesterdayLabel);
        await expect(cellsOf(page, inLeg!.id).nth(1)).toHaveText("Transfer");
      });
    });
  }
});

// ── 4 · tomorrow ─────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner wants to move money between accounts (${C4})`, () => {
  for (const r of MOVERS) {
    test(`${r.given} transfer (${C4})`, async ({ page }) => {
      const k = slot(4, r);
      const [bca, sp] = [ground.bca[k]!, ground.sp[k]!];
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);
      const tomorrow = dayFrom(1);

      await openAccount(page, r, bca, bcaName(4, r.key));

      // The WHEN: to ShopeePay, tomorrow tried on the calendar.
      await openTransfer(page, bca);
      await pickTo(page, sp);
      await page.getByTestId("transfer-amount").fill(String(MOVED));
      const trigger = page.getByTestId("transfer-on");
      const todayLabel = (await trigger.innerText()).trim();
      const content = await openCalendar(page);

      await test.step("then: cannot pick a day after today", async () => {
        if (tomorrow.slice(0, 7) !== today().slice(0, 7)) {
          // Today is the month's last day: the calendar cannot page into next month.
          await expect(content.locator('[data-part="next-trigger"]').filter({ visible: true })).toBeDisabled();
        } else {
          const cell = dayCell(content, tomorrow);
          await expect(cell).toHaveCount(1);
          expect(await cell.evaluate((el) => el.hasAttribute("data-disabled") || el.getAttribute("aria-disabled") === "true")).toBe(true);
          await cell.click({ force: true });
          await expect(trigger).toHaveText(todayLabel);
        }
        // The server refuses the day too, under the role's own token — and nothing is posted.
        const refused = await send(token, TRANSFER_RPC, { teamId, fromAccountId: bca, toAccountId: sp, amount: MOVED, occurredOn: tomorrow, note: "" });
        expect(refused.status, refused.text).toBe(400);
        expect(refused.text).toContain("future");
        expect(await transfersOf(token, teamId, bca)).toHaveLength(0);
      });
    });
  }
});

// ── 5 · Rp 0 ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner wants to move money between accounts (${C5})`, () => {
  for (const r of MOVERS) {
    test(`${r.given} transfer (${C5})`, async ({ page }) => {
      const k = slot(5, r);
      const [bca, sp] = [ground.bca[k]!, ground.sp[k]!];
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      await openAccount(page, r, bca, bcaName(5, r.key));

      // The WHEN: to ShopeePay, Rp 0.
      await openTransfer(page, bca);
      await pickTo(page, sp);
      await page.getByTestId("transfer-amount").fill("0");

      await test.step("then: cannot transfer", async () => {
        await expect(page.getByTestId("transfer-save")).toBeDisabled();
        // Typed past the form, the server refuses it under the role's own token — and nothing is posted.
        const refused = await send(token, TRANSFER_RPC, { teamId, fromAccountId: bca, toAccountId: sp, amount: 0, occurredOn: today(), note: "" });
        expect(refused.status, refused.text).toBe(400);
        expect(await transfersOf(token, teamId, bca)).toHaveLength(0);
        expect(await transfersOf(token, teamId, sp)).toHaveLength(0);
      });
    });
  }
});

// ── 6 · ShopeePay archived ───────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner wants to move money between accounts (${C6})`, () => {
  for (const r of MOVERS) {
    test(`${r.given} transfer (${C6})`, async ({ page }) => {
      const k = slot(6, r);
      const [bca, sp] = [ground.bca[k]!, ground.sp[k]!];
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      // The given: ShopeePay is archived.
      expect(await listIds(token, teamId, { archivedOnly: true })).toContain(sp);

      await openAccount(page, r, bca, bcaName(6, r.key));

      // The WHEN: Transfer from BCA, the To picker opened.
      await openTransfer(page, bca);
      await openTo(page);

      await test.step("then: ShopeePay cannot be picked as the account to transfer to", async () => {
        // The picker has answered: the team's active accounts are offered (given 5's ShopeePay among them).
        await expect(page.getByTestId(`transfer-to-option-${ground.sp[slot(5, r)]}`)).toBeVisible();
        await expect(page.getByTestId(`transfer-to-option-${sp}`)).toHaveCount(0);
        // Sent anyway, under the role's own token, the server refuses it.
        const refused = await send(token, TRANSFER_RPC, { teamId, fromAccountId: bca, toAccountId: sp, amount: MOVED, occurredOn: today(), note: "" });
        expect(refused.status, refused.text).toBe(400);
        expect(refused.text).toContain("archived");
        expect(await transfersOf(token, teamId, bca)).toHaveLength(0);
      });
    });
  }
});

// ── 7 · an unknown account (Melati's withdrawal) ─────────────────────────────────────────────────────────────────────

test.describe(`selling owner · admin · warehouse owner wants to move money between accounts (${C7})`, () => {
  for (const r of MOVERS) {
    test(`${r.given} transfer (${C7})`, async ({ page }) => {
      const bca = ground.bca[slot(7, r)]!;
      const unknown = ground.unknown[r.side];
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      // The given: the team's unknown account, made by the withdrawal (Rp 300.000 in it).
      expect(await listIds(token, teamId, { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] })).toContain(unknown);

      await openAccount(page, r, bca, bcaName(7, r.key));

      // The WHEN: Transfer from BCA, the To picker opened.
      await openTransfer(page, bca);
      await openTo(page);

      await test.step("then: the unknown account cannot be picked as the account to transfer to", async () => {
        await expect(page.getByTestId(`transfer-to-option-${ground.sp[slot(5, r)]}`)).toBeVisible();
        await expect(page.getByTestId(`transfer-to-option-${unknown}`)).toHaveCount(0);
        const refused = await send(token, TRANSFER_RPC, { teamId, fromAccountId: bca, toAccountId: unknown, amount: MOVED, occurredOn: today(), note: "" });
        expect(refused.status, refused.text).toBe(400);
        expect(refused.text).toContain("unknown");
        expect(await transfersOf(token, teamId, bca)).toHaveLength(0);
      });
    });
  }
});

// ── 8 · transfer out of an unknown account (Rp 300.000 from Melati) into BCA TikTok ──────────────────────────────────

test.describe(`selling owner · admin · warehouse owner wants to move money between accounts (${C8})`, () => {
  for (const r of MOVERS) {
    test(`${r.given} transfer out (${C8})`, async ({ page }) => {
      const { unknown, tiktok } = ground.out[r.key]!;
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      // The given: BCA TikTok active (Rp 500.000), and the role's unknown account holding Melati's Rp 300.000.
      expect(await listIds(token, teamId, { types: ["FINANCIAL_ACCOUNT_TYPE_UNKNOWN"] })).toContain(unknown);
      await openAccount(page, r, tiktok, tiktokName(r.key));
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(OPENING));
      await revisit(page, unknown, shownUnknown8(r));
      await expect(page.getByTestId("account-unknown-explained")).toBeVisible();
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(MELATI_WITHDRAWAL));

      // The WHEN: Transfer Out on the unknown account's page → To BCA TikTok, the whole Rp 300.000, today.
      await expect(page.getByTestId(`account-transfer-button-${unknown}`)).toHaveText(/Transfer Out/);
      await openTransfer(page, unknown);
      await pickTo(page, tiktok);
      await page.getByTestId("transfer-amount").fill(String(MELATI_WITHDRAWAL));
      await save(page);

      await test.step("then: unknown account Rp 0", async () => {
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(0));
        // Its out leg: one transfer row, −Rp 300.000, nothing left after it.
        const out = await transfersOf(token, teamId, unknown);
        expect(out).toHaveLength(1);
        expect(out[0]!.change).toBe(-MELATI_WITHDRAWAL);
        expect(out[0]!.balanceAfter ?? 0).toBe(0); // proto3 JSON drops a zero
        const cells = cellsOf(page, out[0]!.id);
        await expect(cells.nth(1)).toHaveText("Transfer");
        await expect(cells.nth(3)).toHaveText(rp(-MELATI_WITHDRAWAL));
      });

      await test.step("then: BCA TikTok +Rp 300.000", async () => {
        await revisit(page, tiktok, tiktokName(r.key));
        await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(OPENING + MELATI_WITHDRAWAL));
        // Its in leg: one transfer row, +Rp 300.000.
        const inLeg = await transfersOf(token, teamId, tiktok);
        expect(inLeg).toHaveLength(1);
        expect(inLeg[0]!.change).toBe(MELATI_WITHDRAWAL);
        expect(inLeg[0]!.balanceAfter).toBe(OPENING + MELATI_WITHDRAWAL);
        const cells = cellsOf(page, inLeg[0]!.id);
        await expect(cells.nth(1)).toHaveText("Transfer");
        await expect(cells.nth(3)).toHaveText(`+${rp(MELATI_WITHDRAWAL)}`);
      });
    });
  }
});

// ── 9 · the warehouse Admin keeps the accounts, moves no money ───────────────────────────────────────────────────────

test.describe(`warehouse admin wants to move money between accounts (${C9})`, () => {
  test(`${WADMIN.given} transfer (${C9})`, async ({ page }) => {
    const bca = ground.bca[slot(9, WADMIN)]!;
    const teamId = ground.team.warehouse;
    const token = await tokenOf(username(WADMIN.key), PASSWORD);

    // The given: the account's page, BCA at Rp 1.000.000.
    await openAccount(page, WADMIN, bca, bcaName(9, WADMIN.key));
    await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(1_000_000));

    await test.step("then: no Transfer button on the account, Match Balance still there", async () => {
      await expect(page.getByTestId(`account-reconcile-button-${bca}`)).toBeVisible();
      await expect(page.getByTestId(`account-reconcile-button-${bca}`)).toHaveText(/Match Balance/);
      await expect(page.getByTestId(`account-transfer-button-${bca}`)).toHaveCount(0);
      // Nor in the row's menu (it holds Edit — the accounts are still kept), nor Capital.
      await page.getByTestId(`account-actions-${bca}`).click();
      await expect(page.getByTestId(`account-edit-${bca}`)).toBeVisible();
      await expect(page.getByTestId(`account-transfer-${bca}`)).toHaveCount(0);
      await expect(page.getByTestId(`account-capital-${bca}`)).toHaveCount(0);
      await page.keyboard.press("Escape");
    });

    await test.step("regression: the server refuses the warehouse admin's transfer", async () => {
      const other = ground.bca[slot(10, LOOKERS[1]!)]!; // the warehouse staff's BCA, in the same team
      const refused = await send(token, TRANSFER_RPC, { teamId, fromAccountId: bca, toAccountId: other, amount: MOVED, occurredOn: today(), note: "" });
      expect(refused.status, refused.text).toBe(403);
    });
  });
});

// ── 10 · selling CS and warehouse Staff only read ────────────────────────────────────────────────────────────────────

test.describe(`selling cs · warehouse staff wants to move money between accounts (${C9})`, () => {
  for (const r of LOOKERS) {
    test(`${r.given} transfer (${C9})`, async ({ page }) => {
      const bca = ground.bca[slot(10, r)]!;
      const teamId = ground.team[r.side];
      const token = await tokenOf(username(r.key), PASSWORD);

      await openAccount(page, r, bca, bcaName(10, r.key));
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rp(1_000_000));

      await test.step("then: no Transfer button on the account", async () => {
        await expect(page.getByTestId(`account-transfer-button-${bca}`)).toHaveCount(0);
        // No actions at all — not behind a menu either.
        await expect(page.getByTestId(`account-actions-${bca}`)).toHaveCount(0);
        await expect(page.getByTestId(`account-reconcile-button-${bca}`)).toHaveCount(0);
      });

      await test.step(`regression: the server refuses the ${r.given.replace(":", " ")}'s transfer`, async () => {
        const other = r.side === "selling" ? ground.bca[slot(1, MOVERS[0]!)]! : ground.bca[slot(9, WADMIN)]!;
        const refused = await send(token, TRANSFER_RPC, { teamId, fromAccountId: bca, toAccountId: other, amount: MOVED, occurredOn: today(), note: "" });
        expect(refused.status, refused.text).toBe(403);
      });
    });
  }
});

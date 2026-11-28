import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { API_URL } from "./env";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";

// warehouse:all wants to count a rack — the checks behind docs/acceptances/inventory/opname.md, section *count*, givens
// 7–9 (when *count row*). One test per role of each given — warehouse:owner, warehouse:admin, warehouse:staff — each
// signed in as a person of that role in a WAREHOUSE OF ITS OWN (one active count per warehouse,
// one-active-count-per-warehouse): rack A holding product X, 5 in the system, and a count of every rack that root
// started, still active. The role counts as a person does — Stock Opname → the active count's *Count* → rack A's tile →
// the product's card: the quantity box, *Submit Count* (opname-count-input / -submit).
//
//   7 (rack A · product X 5 in system · counted 5)
//     then: system figure shown only after the count is in — before the count the card reads *hidden* and *Count
//           first*, draws no expected figure and no difference, and the rack's own answer (OpnameRackCount, the one
//           the page read) carries no book figure for the row; once 5 is submitted, Expected 5, Counted 5
//           (a-count-is-blind-then-revealed);
//     then: says it matches the system, nothing to explain — *Matches the book — nothing to explain.*, difference 0,
//           no reason line to fill, Mark Counted enabled, and the count's answer holds no draft.
//   8 (rack A · product X 5 in system · counted 3)
//     then: system figure and difference −2 shown — Expected 5, Counted 3, Difference −2, on the screen and in the
//           count's answer;
//     then: a lost draft of 2 from the system, waiting for its reason — the Difference panel's *Lost 2* line with an
//           empty reason, Mark Counted disabled with *Write a reason for every draft …*; the answer's one draft is LOST 2
//           with no note (a-short-rack-gets-a-lost-draft-from-the-system, a-difference-needs-its-reason-on-the-draft);
//     then: can count again one more time (recount once) — *Recount Once* opens the Recount box, *Submit Recount* is
//           taken (the answer marks the row recounted) (a-row-keeps-only-its-latest-count).
//   9 (rack A · product X 5 in system · counted 7)
//     then: a surplus draft of 2, waiting for its reason — Difference +2, the *Surplus 2* line with an empty reason, no
//           broken box (nothing is short), Mark Counted disabled; the answer's one draft is SURPLUS 2 with no note
//           (a-surplus-draft-is-counted-by-the-system).
//
// The same card's second when, *recount row* — given 10 (section *count* too), one test per role likewise:
//
//   10 (rack A · product X 5 in system · counted 3 · recounted 4)
//     then: the recount replaces the count, difference −1 — after *Recount Once* → 4, Counted 4, Expected 5,
//           Difference −1, and the lost draft follows the count that stands: ONE draft, Lost 1 (not 2) — on the screen,
//           in the recount's answer and in a fresh read of the rack (a-row-keeps-only-its-latest-count);
//     then: cannot count a third time, recount once no longer shown — no Recount Once, no box, no Submit, also after the
//           rack is opened again; a third OpnameRowCount under the role's own token is refused (failed_precondition,
//           *the one recount is used*) and the row still reads 4.
//
// And the card's last step, *mark row counted* — givens 11–14 (section *count*), one test per role likewise
// (a-row-is-marked-counted-after-its-drafts, a-counted-row-is-read-only-until-sent-back):
//
//   11 (rack A · product X 5 in system · counted 3 · 1 broken · reasons for broken and lost)
//     then: row counted — the Mark Counted answer and a fresh OpnameRackCount hold the row COUNTED, the card's state badge
//           reads *Counted*;
//     then: drafts broken 1 and lost 1, each with its reason — *Of the missing, how many are broken?* 1 turns the Lost 2
//           into Broken 1 + Lost 1 (broken-posts-as-written-the-rest-nets); both reasons typed, the answer's drafts are
//           BROKEN 1 and LOST 1 with those words, and the counted card lists both with their reasons;
//     then: read-only to the counter — no count box, Submit, Recount Once, broken box, reason boxes or Mark Counted, the
//           lock line *Counted — the admin can send it back to count again*, also after the rack is opened again; a count
//           and a second Mark Counted sent anyway under the counter's own token are refused (failed_precondition, *the row
//           is counted*) and the row keeps its count and drafts;
//     then: the admin sees it counted, with who counted it — ANOTHER person, a warehouse admin of the same warehouse, on
//           the count's watch page (/inventories/opname/sessions/<id>): the row's state *Counted* with the counter's name
//           under it, its drafts and reasons, the row on the *Counted* tab, and OpnameRowList's countedById = the counter.
//   12 (rack A · product X 5 in system · counted 3 · no reason for lost)
//     then: cannot mark counted, says every draft needs a reason — Mark Counted disabled with *Write a reason for every
//           draft to mark it counted.* (spaces are no reason); sent anyway under the role's token, OpnameRowMarkCounted is
//           refused (invalid_argument, *every draft needs its reason*) — also with a broken unit and its reason but none
//           for the lost rest — and the row stays not counted, its Lost 2 draft still without a reason.
//   13 (rack A · product X 5 in system · counted 7 · reason for surplus)
//     then: surplus draft 2 with its reason — the answer's one draft is SURPLUS 2 with the typed words, the row COUNTED,
//           and the counted card lists *Surplus 2* with the reason, nothing broken or lost.
//   14 (rack A · product X 5 in system · counted 5)
//     then: row counted, no drafts — Mark Counted straight away: the answer holds the row COUNTED with no draft, and the
//           card says it matches, with no draft list, under the lock line.
//
// And the rack's *Add a Product Found Here*, when *add found product* — givens 15–16 (section *count*), one test per
// role likewise (a-counter-may-add-a-product-found-here, a-rack-plan-counts-its-products-everywhere,
// a-unit-never-stocked-here-comes-in-by-restock, a-warehouse-picks-only-what-it-has-held):
//
//   15 (rack A · product Y not in rack A's list · product Y on rack B in system) — a count of rack A, so rack A lists
//      product X alone and rack B is not in the count; the role adds Y found on rack A through the dialog's picker.
//     then: product Y added on rack A at 0 in system — the answer's found row is (Y, rack A), *found here*; rack A's card
//           list and a fresh read hold X and Y; the 3 units counted where they lie reveal Expected 0, Difference +3;
//     then: product Y on rack B joins the count — the answer's second row is (Y, rack B); rack B's tile is now on the
//           count's rack list, its card lists Y blind, a move of Y off rack B under the role's token is refused (*being
//           counted*), and counted 0 there it reveals Expected 3, Difference −3 — the move nets out at finalize.
//   16 (rack A · product Z · its team never had it in this warehouse) — Z is the seller's (the team of X), received only
//      in ANOTHER warehouse; this warehouse holds X (rack A), Y (rack B) and has held H (emptied to 0 by a sample).
//     then: product Z not offered to pick, only products this warehouse has held — the dialog's picker opened lists
//           exactly X, Y and H (WarehouseProductSearch's answer and the options); the stem Y, H and Z share finds Y and
//           H, never Z; Z's name and its code find nothing (*No products found*), Add Product stays disabled; sent anyway
//           under the role's token OpnameRowAddFound is refused (failed_precondition) and rack A still lists X alone.
//
// The ground (root, once): a selling team with an operational account and a category. Per (given, role) a warehouse
// with its fee, rack A, product X restocked onto it (5), a person of that role, and root's count of every rack — and for
// given 11 a second person, a warehouse admin, who watches the count. Givens 15–16 seed their own ground in their
// describe's beforeAll (racks B and C, the products Y, H and Z, and the plan above).

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-opname-count-1";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "o" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "a" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "s" },
] as const;
type Key = (typeof ROLES)[number]["key"];

// Each given's case text, verbatim from opname.md — the marking script finds the tests by it.
const GIVEN = "warehouse:all wants to count a rack";
const WHEN = "count row";
const C7 = "rack A · product X 5 in system · counted 5";
const C8 = "rack A · product X 5 in system · counted 3";
const C9 = "rack A · product X 5 in system · counted 7";
const RECOUNT = "recount row";
const C10 = "rack A · product X 5 in system · counted 3 · recounted 4";
const MARK = "mark row counted";
const C11 = "rack A · product X 5 in system · counted 3 · 1 broken · reasons for broken and lost";
const C12 = "rack A · product X 5 in system · counted 3 · no reason for lost";
const C13 = "rack A · product X 5 in system · counted 7 · reason for surplus";
const C14 = "rack A · product X 5 in system · counted 5";

type Given = 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
const GIVENS: Given[] = [7, 8, 9, 10, 11, 12, 13, 14];
// A team code is at most 10 characters: QC + the tag + the 6-digit SUFFIX leaves 2 — one character a given.
const GIVEN_TAG: Record<Given, string> = { 7: "7", 8: "8", 9: "9", 10: "R", 11: "K", 12: "L", 13: "M", 14: "N" };

interface Ground {
  warehouse: string;
  user: string;
  userId: string;
  name: string;
  watcher: string;
  rack: { id: string; code: string };
  product: { id: string; code: string; name: string };
  session: string;
}

const ground = {
  seller: "",
  account: "",
  category: "",
  g: {} as Record<Given, Record<Key, Ground>>,
};

async function api(page: Page, method: string, body: unknown): Promise<Record<string, any>> {
  const res = await page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const r = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
    },
    [method, body, API_URL] as const,
  );
  if (res.status !== 200) throw new Error(`${method}: ${res.status} ${JSON.stringify(res.json)}`);

  return res.json;
}

// The same call with the page's token, answering the status and body instead of throwing — a refusal is the point.
async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, any> }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const r = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
    },
    [method, body, API_URL] as const,
  );
}

interface Row {
  id: string;
  productId: string;
  placementId?: string;
  foundHere?: boolean;
  status?: string;
  countedById?: string;
  revealed?: boolean;
  systemStockCount?: string;
  recountedStockCount?: string;
  recounted?: boolean;
  drafts?: { type: string; stockCount?: string; note?: string }[];
}

// Signed in as the role, in its warehouse: Stock Opname → the active count → rack A's tile. Returns the product's row
// as the rack's own answer (OpnameRackCount — the read the page made) carried it.
async function openRackA(page: Page, b: Ground): Promise<Row> {
  await signIn(page, b.user, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), b.warehouse);

  return toRackA(page, b);
}

// Already signed in: the same way again, from the Stock Opname list — what the server says about the row now.
async function toRackA(page: Page, b: Ground): Promise<Row> {
  await page.goto("/inventories/opname/sessions");
  await expect(page.getByTestId("opname-active-session")).toContainText(`#${b.session}`);
  await page.getByTestId("opname-active-count").click();
  await expect(page).toHaveURL(new RegExp(`/inventories/opname/sessions/${b.session}/count`));
  const tile = page.getByTestId(`opname-count-rack-${b.rack.id}`);
  await expect(tile).toContainText(b.rack.code);
  const answer = page.waitForResponse((r) => r.url().includes("OpnameService/OpnameRackCount"));
  await tile.click();
  const json = (await (await answer).json()) as { rows?: Row[] };
  await expect(page.getByTestId("opname-count-rack-code")).toHaveText(b.rack.code);
  const rows = json.rows ?? [];
  expect(rows.map((r) => r.productId)).toEqual([b.product.id]);
  await expect(page.getByTestId(`opname-count-row-${rows[0]!.id}`)).toContainText(b.product.name);

  return rows[0]!;
}

// Type what was counted and submit it; returns the row the count's answer (OpnameRowCount) revealed.
async function submitCount(page: Page, row: string, n: number): Promise<Row> {
  await page.getByTestId(`opname-count-input-${row}`).fill(String(n));
  const answer = page.waitForResponse((r) => r.url().includes("OpnameService/OpnameRowCount"));
  await page.getByTestId(`opname-count-submit-${row}`).click();
  const res = await answer;
  const json = (await res.json().catch(() => ({}))) as { row?: Row };
  expect(res.ok(), JSON.stringify(json)).toBe(true);

  return json.row!;
}

// The figures the card shows once revealed.
async function expectFigures(page: Page, row: string, f: { expected: string; counted: string; difference: string }) {
  await expect(page.getByTestId(`opname-count-expected-${row}`)).toHaveText(f.expected);
  await expect(page.getByTestId(`opname-count-counted-${row}`)).toHaveText(f.counted);
  await expect(page.getByTestId(`opname-count-difference-${row}`)).toHaveText(f.difference);
  await expect(page.getByTestId(`opname-count-hidden-${row}`)).toHaveCount(0);
}

// A system draft waiting for its reason: its line in the Difference panel reads the kind and the units, the reason box
// is empty, and the row cannot be marked counted yet.
async function expectDraftWaiting(page: Page, row: string, type: 2 | 3, kind: string, units: number) {
  const drafts = page.getByTestId(`opname-count-drafts-${row}`);
  await expect(drafts).toBeVisible();
  const line = drafts.locator("label", { has: page.getByTestId(`opname-draft-${type}`) });
  await expect(line).toHaveCount(1);
  await expect(line).toHaveText(new RegExp(`^${kind}\\s*${units}\\s*\\*?$`));
  const note = page.getByTestId(`opname-count-${kind.toLowerCase()}-note-${row}`);
  await expect(note).toBeVisible();
  await expect(note).toHaveValue("");
  await expect(page.getByTestId(`opname-count-mark-${row}`)).toBeDisabled();
  await expect(page.getByTestId(`opname-count-needs-reason-${row}`)).toHaveText(
    "Write a reason for every draft to mark it counted.",
  );
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  try {
    await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

    ground.seller = await team(`E2E Hitung Seller ${SUFFIX}`, `QCM${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E hitung ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-QC-${SUFFIX}`,
          openingBalance: 0,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    // A restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account).
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: ground.seller,
      accountId: ground.account,
      operational: true,
    });
    ground.category = String(
      (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Hitung ${SUFFIX}` })).category.id,
    );

    for (const g of GIVENS) {
      ground.g[g] = {} as Record<Key, Ground>;
      for (const r of ROLES) {
        const tag = `${GIVEN_TAG[g]}${r.key.toUpperCase()}`;
        const warehouse = await team(`E2E Hitung ${tag} ${SUFFIX}`, `QC${tag}${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
        await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });
        const user = `e2eqc${g}${r.key}${SUFFIX}`;
        const personName = `Hitung ${r.given} ${g} ${SUFFIX}`;
        const createdUser = await api(page, "user.v1.UserService/CreateUser", {
          teamId: warehouse,
          username: user,
          password: PASSWORD,
          name: personName,
          role: r.role,
        });
        const userId = String(createdUser.user.id);
        // given 11's watcher: another person, a warehouse admin of the same warehouse, who reads the count's watch page
        let watcher = "";
        if (g === 11) {
          watcher = `e2eqcw${g}${r.key}${SUFFIX}`;
          await api(page, "user.v1.UserService/CreateUser", {
            teamId: warehouse,
            username: watcher,
            password: PASSWORD,
            name: `Pengawas ${g}${r.key} ${SUFFIX}`,
            role: "ROLE_WAREHOUSE_ADMIN",
          });
        }
        const code = `qc${tag.toLowerCase()}-a-${SUFFIX}`;
        const rack = { id: String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id), code };

        const name = `Kaos X ${tag} ${SUFFIX}`;
        const created = await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.seller,
          productCodePart: `QC${tag}X${SUFFIX}`,
          name,
          categoryId: ground.category,
        });
        const product = { id: String(created.product.id), code: String(created.product.productCode), name };

        // GIVEN — rack A · product X 5 in system: 5 received onto A.
        const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: ground.seller,
          warehouseId: warehouse,
          financeAccountId: ground.account,
          items: [{ productId: product.id, productCode: product.code, name, count: 5, total: 50_000 }],
        });
        const item = (restock.request.items as { id: string }[])[0]!;
        await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
          teamId: warehouse,
          requestId: restock.request.id,
          lines: [{ itemId: item.id, receivedCount: 5, placements: [{ placementId: rack.id, quantity: 5 }] }],
        });

        // The count the role works in — every rack, started by root (the given is the counting, not the start).
        const session = String(
          (await api(page, "inventory.v1.OpnameService/OpnameSessionCreate", { teamId: warehouse, plan: "OPNAME_PLAN_ALL" })).session.id,
        );
        ground.g[g][r.key] = { warehouse, user, userId, name: personName, watcher, rack, product, session };
      }
    }
  } finally {
    await page.close();
  }
});

test.describe(`${GIVEN} (${C7})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${C7})`, async ({ page }) => {
      const b = ground.g[7][r.key];
      const before = await openRackA(page, b);
      const row = before.id;

      await test.step("then: system figure shown only after the count is in", async () => {
        // BEFORE — blind: the card hides the book and the difference, and so does the answer that filled it.
        expect(before.revealed ?? false).toBe(false);
        expect(before.systemStockCount ?? "0").toBe("0");
        await expect(page.getByTestId(`opname-count-hidden-${row}`)).toHaveText("hidden");
        await expect(page.getByTestId(`opname-count-count-first-${row}`)).toHaveText("Count first");
        await expect(page.getByTestId(`opname-count-expected-${row}`)).toHaveCount(0);
        await expect(page.getByTestId(`opname-count-difference-${row}`)).toHaveCount(0);
        await expect(page.getByTestId(`opname-count-drafts-${row}`)).toHaveCount(0);
        await expect(page.getByTestId(`opname-count-row-${row}`)).not.toContainText("Expected5");

        // WHEN — counted 5. The book shows now.
        const revealed = await submitCount(page, row, 5);
        expect(revealed.revealed).toBe(true);
        expect(revealed.systemStockCount).toBe("5");
        expect(revealed.recountedStockCount).toBe("5");
        await expectFigures(page, row, { expected: "5", counted: "5", difference: "0" });
        await expect(page.getByTestId(`opname-count-count-first-${row}`)).toHaveCount(0);
      });

      await test.step("then: says it matches the system, nothing to explain", async () => {
        await expect(page.getByTestId(`opname-count-matches-${row}`)).toHaveText("Matches the book — nothing to explain.");
        // nothing to explain: no draft, no reason line, no broken box — the row can be marked counted as it is
        const reread = await api(page, "inventory.v1.OpnameService/OpnameRackCount", {
          teamId: b.warehouse,
          sessionId: b.session,
          placementId: b.rack.id,
        });
        const now = ((reread.rows ?? []) as Row[]).find((x) => x.id === row)!;
        expect(now.drafts ?? []).toEqual([]);
        for (const id of ["lost-note", "surplus-note", "broken", "broken-note", "needs-reason"]) {
          await expect(page.getByTestId(`opname-count-${id}-${row}`)).toHaveCount(0);
        }
        await expect(page.getByTestId(`opname-count-drafts-${row}`).locator('[data-testid^="opname-draft-"]')).toHaveCount(0);
        await expect(page.getByTestId(`opname-count-mark-${row}`)).toBeEnabled();
      });
    });
  }
});

test.describe(`${GIVEN} (${C8})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${C8})`, async ({ page }) => {
      const b = ground.g[8][r.key];
      const row = (await openRackA(page, b)).id;
      await expect(page.getByTestId(`opname-count-hidden-${row}`)).toBeVisible();

      // WHEN — counted 3.
      const revealed = await submitCount(page, row, 3);

      await test.step("then: system figure and difference −2 shown", async () => {
        expect(revealed.revealed).toBe(true);
        expect(revealed.systemStockCount).toBe("5");
        expect(revealed.recountedStockCount).toBe("3");
        await expectFigures(page, row, { expected: "5", counted: "3", difference: "−2" });
      });

      await test.step("then: a lost draft of 2 from the system, waiting for its reason", async () => {
        expect(revealed.drafts ?? []).toHaveLength(1);
        expect(revealed.drafts![0]).toMatchObject({ type: "OPNAME_DRAFT_TYPE_LOST", stockCount: "2" });
        expect(revealed.drafts![0]!.note ?? "").toBe("");
        await expectDraftWaiting(page, row, 2, "Lost", 2);
        // short, so the counter may say how many are broken; nothing is over
        await expect(page.getByTestId(`opname-count-broken-${row}`)).toBeVisible();
        await expect(page.getByTestId(`opname-count-surplus-note-${row}`)).toHaveCount(0);
      });

      await test.step("then: can count again one more time (recount once)", async () => {
        const recount = page.getByTestId(`opname-count-recount-${row}`);
        await expect(recount).toHaveText("Recount Once");
        await recount.click();
        await expect(page.getByTestId(`opname-count-input-${row}`)).toBeVisible();
        await expect(page.getByTestId(`opname-count-submit-${row}`)).toHaveText("Submit Recount");
        const again = await submitCount(page, row, 3);
        expect(again.recounted).toBe(true);
        expect(again.recountedStockCount).toBe("3");
        await expectFigures(page, row, { expected: "5", counted: "3", difference: "−2" });
        await expect(page.getByTestId(`opname-count-input-${row}`)).toHaveCount(0);
      });
    });
  }
});

test.describe(`${GIVEN} (${C9})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${C9})`, async ({ page }) => {
      const b = ground.g[9][r.key];
      const row = (await openRackA(page, b)).id;
      await expect(page.getByTestId(`opname-count-hidden-${row}`)).toBeVisible();

      // WHEN — counted 7.
      const revealed = await submitCount(page, row, 7);

      await test.step("then: a surplus draft of 2, waiting for its reason", async () => {
        expect(revealed.systemStockCount).toBe("5");
        expect(revealed.recountedStockCount).toBe("7");
        await expectFigures(page, row, { expected: "5", counted: "7", difference: "+2" });
        expect(revealed.drafts ?? []).toHaveLength(1);
        expect(revealed.drafts![0]).toMatchObject({ type: "OPNAME_DRAFT_TYPE_SURPLUS", stockCount: "2" });
        expect(revealed.drafts![0]!.note ?? "").toBe("");
        await expectDraftWaiting(page, row, 3, "Surplus", 2);
        // over, not short: no broken box, no lost line
        await expect(page.getByTestId(`opname-count-broken-${row}`)).toHaveCount(0);
        await expect(page.getByTestId(`opname-count-lost-note-${row}`)).toHaveCount(0);
      });
    });
  }
});

// recount row — the row's one recount replaces its count (a-row-keeps-only-its-latest-count), and then no more.
test.describe(`${GIVEN} (${C10})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${RECOUNT} (${C10})`, async ({ page }) => {
      const b = ground.g[10][r.key];
      const row = (await openRackA(page, b)).id;
      await expect(page.getByTestId(`opname-count-hidden-${row}`)).toBeVisible();

      // GIVEN — counted 3: revealed, 2 short, the lost draft of 2 waiting for its reason.
      const first = await submitCount(page, row, 3);
      expect(first.recounted ?? false).toBe(false);
      expect(first.recountedStockCount).toBe("3");
      await expectFigures(page, row, { expected: "5", counted: "3", difference: "−2" });
      await expectDraftWaiting(page, row, 2, "Lost", 2);

      // WHEN — Recount Once, recounted 4.
      const recount = page.getByTestId(`opname-count-recount-${row}`);
      await expect(recount).toHaveText("Recount Once");
      await recount.click();
      await expect(page.getByTestId(`opname-count-submit-${row}`)).toHaveText("Submit Recount");
      const again = await submitCount(page, row, 4);

      await test.step("then: the recount replaces the count, difference −1", async () => {
        expect(again.recounted).toBe(true);
        expect(again.systemStockCount).toBe("5");
        expect(again.recountedStockCount).toBe("4");
        // the draft follows the count that stands: one lost draft of 1, the first count's 2 gone
        expect((again.drafts ?? []).map((d) => [d.type, d.stockCount])).toEqual([["OPNAME_DRAFT_TYPE_LOST", "1"]]);
        await expectFigures(page, row, { expected: "5", counted: "4", difference: "−1" });
        await expectDraftWaiting(page, row, 2, "Lost", 1);
        await expect(page.getByTestId(`opname-count-surplus-note-${row}`)).toHaveCount(0);

        // and so does a fresh read of the rack: the row keeps 4, nothing of the 3
        const reread = await api(page, "inventory.v1.OpnameService/OpnameRackCount", {
          teamId: b.warehouse,
          sessionId: b.session,
          placementId: b.rack.id,
        });
        const now = ((reread.rows ?? []) as Row[]).find((x) => x.id === row)!;
        expect(now.recountedStockCount).toBe("4");
        expect(now.recounted).toBe(true);
        expect((now.drafts ?? []).map((d) => [d.type, d.stockCount])).toEqual([["OPNAME_DRAFT_TYPE_LOST", "1"]]);
      });

      await test.step("then: cannot count a third time, recount once no longer shown", async () => {
        for (const id of ["recount", "input", "submit"]) {
          await expect(page.getByTestId(`opname-count-${id}-${row}`)).toHaveCount(0);
        }

        // opened again, from what the server holds: still no Recount Once and no box
        const reopened = await toRackA(page, b);
        expect(reopened.recounted).toBe(true);
        await expectFigures(page, row, { expected: "5", counted: "4", difference: "−1" });
        for (const id of ["recount", "input", "submit"]) {
          await expect(page.getByTestId(`opname-count-${id}-${row}`)).toHaveCount(0);
        }

        // and a third count sent anyway, under the role's own token, is refused — the row still reads 4
        const third = await send(page, "inventory.v1.OpnameService/OpnameRowCount", { teamId: b.warehouse, rowId: row, count: 5 });
        expect(third.status, JSON.stringify(third.json)).not.toBe(200);
        expect(third.json.code).toBe("failed_precondition");
        expect(String(third.json.message)).toContain("the one recount is used");
        const after = await api(page, "inventory.v1.OpnameService/OpnameRackCount", {
          teamId: b.warehouse,
          sessionId: b.session,
          placementId: b.rack.id,
        });
        expect(((after.rows ?? []) as Row[]).find((x) => x.id === row)!.recountedStockCount).toBe("4");
      });
    });
  }
});

// mark row counted — the row is closed with its drafts, each with its reason, and then read-only to its counter until
// the admin sends it back (a-row-is-marked-counted-after-its-drafts, a-counted-row-is-read-only-until-sent-back).

// Mark Counted on the card; returns the row its answer (OpnameRowMarkCounted) holds.
async function markCounted(page: Page, row: string): Promise<Row> {
  const mark = page.getByTestId(`opname-count-mark-${row}`);
  await expect(mark).toBeEnabled();
  const answer = page.waitForResponse((r) => r.url().includes("OpnameService/OpnameRowMarkCounted"));
  await mark.click();
  const res = await answer;
  const json = (await res.json().catch(() => ({}))) as { row?: Row };
  expect(res.ok(), JSON.stringify(json)).toBe(true);

  return json.row!;
}

// What the rack's own read (OpnameRackCount) says about the row now, under the page's token.
async function rowNow(page: Page, b: Ground, row: string): Promise<Row> {
  const reread = await api(page, "inventory.v1.OpnameService/OpnameRackCount", {
    teamId: b.warehouse,
    sessionId: b.session,
    placementId: b.rack.id,
  });

  return ((reread.rows ?? []) as Row[]).find((x) => x.id === row)!;
}

// A row's drafts as [type, units, reason] — proto3 JSON drops an empty reason.
const draftsOf = (r: Row) => (r.drafts ?? []).map((d) => [d.type, d.stockCount, d.note ?? ""]);

const READ_ONLY = "Counted — the admin can send it back to count again";

// The counted card: nothing left to type or press — no count box, recount, broken box, reason box or Mark Counted —
// and the lock line in their place.
async function expectReadOnly(page: Page, row: string) {
  const card = page.getByTestId(`opname-count-row-${row}`);
  await expect(card.getByTestId("opname-row-state-counted")).toHaveText("Counted");
  for (const id of ["input", "submit", "recount", "broken", "broken-note", "lost-note", "surplus-note", "mark", "needs-reason", "drafts"]) {
    await expect(page.getByTestId(`opname-count-${id}-${row}`)).toHaveCount(0);
  }
  await expect(card.locator('input:not([type="hidden"]), textarea')).toHaveCount(0);
  await expect(card).toContainText(READ_ONLY);
}

test.describe(`${GIVEN} (${C11})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${MARK} (${C11})`, async ({ page, browser }) => {
      const b = ground.g[11][r.key];
      const row = (await openRackA(page, b)).id;
      await expect(page.getByTestId(`opname-count-hidden-${row}`)).toBeVisible();

      // GIVEN — counted 3 (2 short), 1 of them broken, and a reason typed for the broken and for the lost.
      await submitCount(page, row, 3);
      await expectFigures(page, row, { expected: "5", counted: "3", difference: "−2" });
      await expectDraftWaiting(page, row, 2, "Lost", 2);
      await page.getByTestId(`opname-count-broken-${row}`).fill("1");
      const drafts = page.getByTestId(`opname-count-drafts-${row}`);
      await expect(drafts.locator("label", { has: page.getByTestId("opname-draft-1") })).toHaveText(/^Broken\s*1\s*\*?$/);
      await expect(drafts.locator("label", { has: page.getByTestId("opname-draft-2") })).toHaveText(/^Lost\s*1\s*\*?$/);
      const brokenNote = `sack torn and thrown away ${r.key}${SUFFIX}`;
      const lostNote = `not found under the rack ${r.key}${SUFFIX}`;
      await page.getByTestId(`opname-count-broken-note-${row}`).fill(brokenNote);
      // the lost still has none
      await expect(page.getByTestId(`opname-count-mark-${row}`)).toBeDisabled();
      await page.getByTestId(`opname-count-lost-note-${row}`).fill(lostNote);
      await expect(page.getByTestId(`opname-count-needs-reason-${row}`)).toHaveCount(0);

      // WHEN — Mark Counted.
      const marked = await markCounted(page, row);
      const want = [
        ["OPNAME_DRAFT_TYPE_BROKEN", "1", brokenNote],
        ["OPNAME_DRAFT_TYPE_LOST", "1", lostNote],
      ];
      const finalText = new RegExp(`^Broken\\s*1\\s*“${brokenNote}”\\s*Lost\\s*1\\s*“${lostNote}”$`);

      await test.step("then: row counted", async () => {
        expect(marked.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        expect(marked.recountedStockCount).toBe("3");
        await expect(page.getByTestId(`opname-count-row-${row}`).getByTestId("opname-row-state-counted")).toHaveText("Counted");
        expect((await rowNow(page, b, row)).status).toBe("OPNAME_ROW_STATUS_COUNTED");
      });

      await test.step("then: drafts broken 1 and lost 1, each with its reason", async () => {
        expect(draftsOf(marked)).toEqual(want);
        expect(draftsOf(await rowNow(page, b, row))).toEqual(want);
        const final = page.getByTestId(`opname-count-final-drafts-${row}`);
        await expect(final.getByTestId("opname-draft-1")).toHaveText("Broken");
        await expect(final.getByTestId("opname-draft-2")).toHaveText("Lost");
        await expect(final.getByTestId("opname-draft-3")).toHaveCount(0);
        await expect(final).toHaveText(finalText);
      });

      await test.step("then: read-only to the counter", async () => {
        await expectReadOnly(page, row);

        // opened again, from what the server holds: still read-only, the same figures and drafts
        const reopened = await toRackA(page, b);
        expect(reopened.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        await expectReadOnly(page, row);
        await expectFigures(page, row, { expected: "5", counted: "3", difference: "−2" });
        await expect(page.getByTestId(`opname-count-final-drafts-${row}`)).toHaveText(finalText);

        // sent anyway under the counter's own token: a count, and a second Mark Counted, are refused
        const recount = await send(page, "inventory.v1.OpnameService/OpnameRowCount", { teamId: b.warehouse, rowId: row, count: 5 });
        expect(recount.status, JSON.stringify(recount.json)).not.toBe(200);
        expect(recount.json.code).toBe("failed_precondition");
        expect(String(recount.json.message)).toContain("the row is counted");
        const again = await send(page, "inventory.v1.OpnameService/OpnameRowMarkCounted", {
          teamId: b.warehouse,
          rowId: row,
          brokenCount: 0,
          lostNote: `changed my mind ${SUFFIX}`,
        });
        expect(again.status, JSON.stringify(again.json)).not.toBe(200);
        expect(again.json.code).toBe("failed_precondition");
        expect(String(again.json.message)).toContain("the row is counted");
        const after = await rowNow(page, b, row);
        expect(after.recountedStockCount).toBe("3");
        expect(draftsOf(after)).toEqual(want);
      });

      await test.step("then: the admin sees it counted, with who counted it", async () => {
        // another person — a warehouse admin of the same warehouse — on the count's watch page
        const watch = await browser.newPage();
        try {
          await signIn(watch, b.watcher, PASSWORD);
          await watch.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), b.warehouse);
          const listed = watch.waitForResponse((res) => res.url().includes("OpnameService/OpnameRowList"));
          await watch.goto(`/inventories/opname/sessions/${b.session}`);
          await expect(watch.getByTestId("opname-detail-page")).toBeVisible();
          const json = (await (await listed).json()) as { items?: { row?: { mapData?: Record<string, Row> } }[] };
          const listedRow = (json.items ?? []).map((it) => it.row?.mapData?.[row]).find((x) => !!x)!;
          expect(listedRow.status).toBe("OPNAME_ROW_STATUS_COUNTED");
          expect(listedRow.countedById).toBe(b.userId);

          const line = watch.getByTestId(`opname-row-${row}`);
          await expect(line.getByTestId("opname-row-state-counted")).toHaveText("Counted");
          await expect(line).toContainText(b.name);
          await expect(line).toContainText(b.product.name);
          await expect(watch.getByTestId(`opname-row-book-${row}`)).toHaveText("5");
          await expect(watch.getByTestId(`opname-row-difference-${row}`)).toHaveText("−2");
          await expect(watch.getByTestId(`opname-row-drafts-${row}`)).toHaveText(finalText);

          // and on the Counted tab
          const countedTab = watch.waitForResponse(
            (res) => res.url().includes("OpnameService/OpnameRowList") && (res.request().postData() ?? "").includes("COUNTED"),
          );
          await watch.getByTestId("opname-detail-tab-counted").click();
          await countedTab;
          await expect(watch.getByTestId(`opname-row-${row}`).getByTestId("opname-row-state-counted")).toHaveText("Counted");
          await expect(watch.getByTestId(`opname-row-${row}`)).toContainText(b.name);
        } finally {
          await watch.close();
        }
      });
    });
  }
});

test.describe(`${GIVEN} (${C12})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${MARK} (${C12})`, async ({ page }) => {
      const b = ground.g[12][r.key];
      const row = (await openRackA(page, b)).id;
      await expect(page.getByTestId(`opname-count-hidden-${row}`)).toBeVisible();

      // GIVEN — counted 3: 2 short, and no reason typed for the lost.
      await submitCount(page, row, 3);
      await expectFigures(page, row, { expected: "5", counted: "3", difference: "−2" });

      await test.step("then: cannot mark counted, says every draft needs a reason", async () => {
        // WHEN — Mark Counted cannot be pressed: disabled, and the card says why
        await expectDraftWaiting(page, row, 2, "Lost", 2);
        // spaces are no reason
        await page.getByTestId(`opname-count-lost-note-${row}`).fill("   ");
        await expect(page.getByTestId(`opname-count-mark-${row}`)).toBeDisabled();
        await expect(page.getByTestId(`opname-count-needs-reason-${row}`)).toHaveText(
          "Write a reason for every draft to mark it counted.",
        );

        // sent anyway under the role's own token: refused — and so is a broken unit with its reason but none for the
        // lost rest
        for (const body of [
          { teamId: b.warehouse, rowId: row, brokenCount: 0, lostNote: "   " },
          { teamId: b.warehouse, rowId: row, brokenCount: 1, brokenNote: `sack torn ${SUFFIX}`, lostNote: "" },
        ]) {
          const res = await send(page, "inventory.v1.OpnameService/OpnameRowMarkCounted", body);
          expect(res.status, JSON.stringify(res.json)).not.toBe(200);
          expect(res.json.code).toBe("invalid_argument");
          expect(String(res.json.message)).toContain("every draft needs its reason");
          expect(String(res.json.message)).toContain("the lost draft has none");
        }

        // the row stays not counted, its Lost 2 still waiting for a reason — on the server and on the card opened again
        const now = await rowNow(page, b, row);
        expect(now.status).toBe("OPNAME_ROW_STATUS_CREATED");
        expect(draftsOf(now)).toEqual([["OPNAME_DRAFT_TYPE_LOST", "2", ""]]);
        const reopened = await toRackA(page, b);
        expect(reopened.status).toBe("OPNAME_ROW_STATUS_CREATED");
        await expect(page.getByTestId(`opname-count-row-${row}`).getByTestId("opname-row-state-revealed")).toHaveText("Revealed");
        await expect(page.getByTestId(`opname-count-row-${row}`).getByTestId("opname-row-state-counted")).toHaveCount(0);
        await expectDraftWaiting(page, row, 2, "Lost", 2);
      });
    });
  }
});

test.describe(`${GIVEN} (${C13})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${MARK} (${C13})`, async ({ page }) => {
      const b = ground.g[13][r.key];
      const row = (await openRackA(page, b)).id;
      await expect(page.getByTestId(`opname-count-hidden-${row}`)).toBeVisible();

      // GIVEN — counted 7: 2 over, and a reason typed for the surplus.
      await submitCount(page, row, 7);
      await expectFigures(page, row, { expected: "5", counted: "7", difference: "+2" });
      await expectDraftWaiting(page, row, 3, "Surplus", 2);
      const note = `tucked behind the next box ${r.key}${SUFFIX}`;
      await page.getByTestId(`opname-count-surplus-note-${row}`).fill(note);

      // WHEN — Mark Counted.
      const marked = await markCounted(page, row);

      await test.step("then: surplus draft 2 with its reason", async () => {
        const want = [["OPNAME_DRAFT_TYPE_SURPLUS", "2", note]];
        expect(marked.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        expect(draftsOf(marked)).toEqual(want);
        const now = await rowNow(page, b, row);
        expect(now.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        expect(draftsOf(now)).toEqual(want);
        const final = page.getByTestId(`opname-count-final-drafts-${row}`);
        await expect(final.getByTestId("opname-draft-3")).toHaveText("Surplus");
        await expect(final.getByTestId("opname-draft-1")).toHaveCount(0);
        await expect(final.getByTestId("opname-draft-2")).toHaveCount(0);
        await expect(final).toHaveText(new RegExp(`^Surplus\\s*2\\s*“${note}”$`));
        await expectReadOnly(page, row);
      });
    });
  }
});

test.describe(`${GIVEN} (${C14})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${MARK} (${C14})`, async ({ page }) => {
      const b = ground.g[14][r.key];
      const row = (await openRackA(page, b)).id;
      await expect(page.getByTestId(`opname-count-hidden-${row}`)).toBeVisible();

      // GIVEN — counted 5: it matches, nothing to explain.
      await submitCount(page, row, 5);
      await expectFigures(page, row, { expected: "5", counted: "5", difference: "0" });
      await expect(page.getByTestId(`opname-count-matches-${row}`)).toHaveText("Matches the book — nothing to explain.");

      // WHEN — Mark Counted, straight away.
      const marked = await markCounted(page, row);

      await test.step("then: row counted, no drafts", async () => {
        expect(marked.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        expect(marked.drafts ?? []).toEqual([]);
        const now = await rowNow(page, b, row);
        expect(now.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        expect(now.drafts ?? []).toEqual([]);
        const card = page.getByTestId(`opname-count-row-${row}`);
        await expect(card.getByTestId("opname-row-state-counted")).toHaveText("Counted");
        await expect(page.getByTestId(`opname-count-final-drafts-${row}`)).toHaveCount(0);
        await expect(card.locator('[data-testid^="opname-draft-"]')).toHaveCount(0);
        await expect(card).toContainText("Matches the book — nothing to explain.");
        await expectReadOnly(page, row);
      });
    });
  }
});

// add found product — a product on the rack the list does not name joins the count at 0 there, with its other racks
// (a-counter-may-add-a-product-found-here); one its team never had in this warehouse is not offered at all
// (a-warehouse-picks-only-what-it-has-held, a-unit-never-stocked-here-comes-in-by-restock).

const FOUND = "add found product";
const C15 = "rack A · product Y not in rack A's list · product Y on rack B in system";
const C16 = "rack A · product Z · its team never had it in this warehouse";

type Rack = { id: string; code: string };
type Product = { id: string; code: string; name: string };

interface FoundGround {
  warehouse: string;
  user: string;
  session: string;
  racks: Record<string, Rack>;
  products: Record<string, Product>;
  stem: string;
}

const found: Record<15 | 16, Record<Key, FoundGround>> = { 15: {} as Record<Key, FoundGround>, 16: {} as Record<Key, FoundGround> };

// Root's seeds, on a page signed in as root.
async function newTeam(page: Page, name: string, teamCode: string, type: string): Promise<string> {
  return String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
}

async function newRack(page: Page, warehouse: string, code: string): Promise<Rack> {
  return { id: String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id), code };
}

async function newProduct(page: Page, codePart: string, name: string): Promise<Product> {
  const created = await api(page, "product.v1.ProductService/ProductCreate", {
    teamId: ground.seller,
    productCodePart: codePart,
    name,
    categoryId: ground.category,
  });

  return { id: String(created.product.id), code: String(created.product.productCode), name };
}

// The seller's restock of n units of p into the warehouse, received onto the rack.
async function receive(page: Page, warehouse: string, p: Product, n: number, rack: Rack) {
  const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.seller,
    warehouseId: warehouse,
    financeAccountId: ground.account,
    items: [{ productId: p.id, productCode: p.code, name: p.name, count: n, total: n * 10_000 }],
  });
  const item = (restock.request.items as { id: string }[])[0]!;
  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: item.id, receivedCount: n, placements: [{ placementId: rack.id, quantity: n }] }],
  });
}

// What this warehouse holds or has held, as the picker reads it (WarehouseProductSearch) — the product ids.
async function heldIds(page: Page, warehouse: string, q: string): Promise<string[]> {
  const res = await api(page, "inventory.v1.InventoryService/WarehouseProductSearch", {
    warehouseId: warehouse,
    filter: { q },
    dataRequest: ["WAREHOUSE_PRODUCT_SEARCH_DATA_TYPE_PRODUCT"],
    page: { page: 1, limit: 10 },
  });

  return ((res.ids ?? []) as string[]).map(String).sort();
}

async function seedFound(browser: import("@playwright/test").Browser, g: 15 | 16) {
  const page = await browser.newPage();
  try {
    await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

    // given 16's elsewhere: another warehouse, the only one that ever received the Z products
    let elsewhere = { warehouse: "", rack: { id: "", code: "" } as Rack };
    if (g === 16) {
      const w = await newTeam(page, `E2E Hitung ZW ${SUFFIX}`, `QCZW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
      await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: w, feePercent: 10, minFee: 0 });
      elsewhere = { warehouse: w, rack: await newRack(page, w, `qczw-a-${SUFFIX}`) };
    }

    for (const r of ROLES) {
      // A team code is at most 10 characters: QC + the two-letter tag + the 6-digit SUFFIX.
      const tag = `${g === 15 ? "F" : "Z"}${r.key.toUpperCase()}`;
      const warehouse = await newTeam(page, `E2E Hitung ${tag} ${SUFFIX}`, `QC${tag}${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
      await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });
      const user = `e2eqc${tag.toLowerCase()}${SUFFIX}`;
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: warehouse,
        username: user,
        password: PASSWORD,
        name: `Hitung ${r.given} ${g} ${SUFFIX}`,
        role: r.role,
      });
      const racks: Record<string, Rack> = {};
      for (const k of g === 15 ? ["a", "b", "c"] : ["a", "b"]) {
        racks[k] = await newRack(page, warehouse, `qc${tag.toLowerCase()}-${k}-${SUFFIX}`);
      }
      const stem = `Temuan ${tag} ${SUFFIX}`;
      const products: Record<string, Product> = {
        x: await newProduct(page, `QC${tag}X${SUFFIX}`, `Kaos X ${tag} ${SUFFIX}`),
        y: await newProduct(page, `QC${tag}Y${SUFFIX}`, `Kaos ${stem} Y`),
      };
      // GIVEN — rack A holds product X (5): rack A's list
      await receive(page, warehouse, products.x!, 5, racks.a!);
      // GIVEN 15 — product Y on rack B in system (3); given 16 — Y on rack B (2), held here
      await receive(page, warehouse, products.y!, g === 15 ? 3 : 2, racks.b!);

      let plan: Record<string, unknown> = { teamId: warehouse, plan: "OPNAME_PLAN_ALL" };
      if (g === 15) {
        // a count of rack A: its list is X alone, and rack B is not in the count until Y is found on A
        plan = { teamId: warehouse, plan: "OPNAME_PLAN_PLACEMENT", filterPlacementId: racks.a!.id };
      } else {
        // H — held here once: 1 received onto rack B, then given away as a sample, so it is at 0 today
        products.h = await newProduct(page, `QC${tag}H${SUFFIX}`, `Kaos ${stem} H`);
        await receive(page, warehouse, products.h, 1, racks.b!);
        await api(page, "inventory.v1.RackService/RackSample", {
          teamId: warehouse,
          rackId: racks.b!.id,
          lines: [{ productId: products.h.id, quantity: 1 }],
          recipient: `E2E ${SUFFIX}`,
          description: `emptied for the found picker ${SUFFIX}`,
        });
        // Z — the same seller's, received ONLY in the other warehouse: its team never had it in this one
        products.z = await newProduct(page, `QC${tag}Z${SUFFIX}`, `Kaos ${stem} Z`);
        await receive(page, elsewhere.warehouse, products.z, 1, elsewhere.rack);
        // the ground as the server holds it: Z is held elsewhere, and this warehouse has held X, Y and H only
        expect(await heldIds(page, elsewhere.warehouse, products.z.name)).toEqual([products.z.id]);
        expect(await heldIds(page, warehouse, "")).toEqual([products.x!.id, products.y!.id, products.h.id].sort());
      }
      const session = String((await api(page, "inventory.v1.OpnameService/OpnameSessionCreate", plan)).session.id);
      found[g][r.key] = { warehouse, user, session, racks, products, stem };
    }
  } finally {
    await page.close();
  }
}

// Signed in as the role, in its warehouse: Stock Opname → the active count → the count's rack list.
async function toCount(page: Page, f: FoundGround) {
  await signIn(page, f.user, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), f.warehouse);
  await page.goto("/inventories/opname/sessions");
  await expect(page.getByTestId("opname-active-session")).toContainText(`#${f.session}`);
  await page.getByTestId("opname-active-count").click();
  await expect(page).toHaveURL(new RegExp(`/inventories/opname/sessions/${f.session}/count`));
}

// A rack's tile on the count's rack list; returns its rows as the rack's own answer (OpnameRackCount) carried them.
async function openTile(page: Page, rack: Rack): Promise<Row[]> {
  const tile = page.getByTestId(`opname-count-rack-${rack.id}`);
  await expect(tile).toContainText(rack.code);
  const answer = page.waitForResponse(
    (r) =>
      r.url().includes("OpnameService/OpnameRackCount") &&
      new RegExp(`"placementId":"?${rack.id}"?[,}]`).test(r.request().postData() ?? ""),
  );
  await tile.click();
  const json = (await (await answer).json()) as { rows?: Row[] };
  await expect(page.getByTestId("opname-count-rack-code")).toHaveText(rack.code);

  return json.rows ?? [];
}

// The picker's search answer for exactly what is typed (proto3 JSON leaves an empty q out: `"filter":{}`).
function searched(page: Page, q: string) {
  const body = q === "" ? `"filter":{}` : `"q":${JSON.stringify(q)}`;

  return page.waitForResponse(
    (r) => r.url().includes("InventoryService/WarehouseProductSearch") && (r.request().postData() ?? "").includes(body),
  );
}

const idsOf = async (res: import("@playwright/test").Response) =>
  (((await res.json()) as { ids?: string[] }).ids ?? []).map(String).sort();

test.describe(`${GIVEN} (${C15})`, () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await seedFound(browser, 15);
  });

  for (const r of ROLES) {
    test(`${r.given} ${FOUND} (${C15})`, async ({ page }) => {
      const f = found[15][r.key];
      const { x, y } = f.products as Record<"x" | "y", Product>;
      const { a, b, c } = f.racks as Record<"a" | "b" | "c", Rack>;
      await toCount(page, f);

      // GIVEN — a count of rack A: its tile is there, rack B's is not; rack A lists X alone, Y is not in its list
      await expect(page.getByTestId(`opname-count-rack-${a.id}`)).toContainText(a.code);
      await expect(page.getByTestId(`opname-count-rack-${b.id}`)).toHaveCount(0);
      expect((await openTile(page, a)).map((row) => row.productId)).toEqual([x.id]);

      // WHEN — Add a Product Found Here: Y, picked by its name
      await page.getByTestId("opname-count-add-found").click();
      const dialog = page.getByTestId("opname-found-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`Product Found on ${a.code}`);
      await expect(dialog.getByTestId("opname-found-submit")).toBeDisabled();
      const input = dialog.getByRole("combobox");
      const byName = searched(page, y.name);
      await input.click();
      await input.pressSequentially(y.name, { delay: 30 });
      expect(await idsOf(await byName)).toEqual([y.id]);
      const option = dialog.getByTestId(`product-select-option-${y.code}`);
      await expect(option).toBeVisible();
      await option.click();
      await expect(dialog.getByTestId("opname-found-submit")).toBeEnabled();
      const answer = page.waitForResponse((res) => res.url().includes("OpnameService/OpnameRowAddFound"));
      await dialog.getByTestId("opname-found-submit").click();
      const res = await answer;
      const json = (await res.json().catch(() => ({}))) as { rows?: Row[] };
      expect(res.ok(), JSON.stringify(json)).toBe(true);
      await expect(dialog).toBeHidden();
      const rows = json.rows ?? [];
      const onA = rows.find((row) => row.placementId === a.id);
      const onB = rows.find((row) => row.placementId === b.id);

      await test.step("then: product Y added on rack A at 0 in system", async () => {
        expect(rows).toHaveLength(2);
        expect(onA).toMatchObject({ productId: y.id, foundHere: true, status: "OPNAME_ROW_STATUS_CREATED" });
        // its card on rack A, marked found here, beside X's
        const card = page.getByTestId(`opname-count-row-${onA!.id}`);
        await expect(card).toContainText(y.name);
        await expect(page.getByTestId(`opname-count-found-here-${onA!.id}`)).toHaveText("found here");
        const reread = await api(page, "inventory.v1.OpnameService/OpnameRackCount", {
          teamId: f.warehouse,
          sessionId: f.session,
          placementId: a.id,
        });
        expect(((reread.rows ?? []) as Row[]).map((row) => row.productId).sort()).toEqual([x.id, y.id].sort());
        // at 0 in the system here: the 3 units counted where they lie reveal a book of 0 on rack A — 3 over
        const counted = await submitCount(page, onA!.id, 3);
        expect(counted.revealed).toBe(true);
        expect(counted.systemStockCount ?? "0").toBe("0");
        await expectFigures(page, onA!.id, { expected: "0", counted: "3", difference: "+3" });
      });

      await test.step("then: product Y on rack B joins the count", async () => {
        expect(onB).toMatchObject({ productId: y.id, status: "OPNAME_ROW_STATUS_CREATED" });
        expect(onB!.foundHere ?? false).toBe(false);
        // rack B is on the count's rack list now, and lists Y — blind, to be counted
        await page.getByTestId("opname-count-back").click();
        await expect(page.getByTestId(`opname-count-rack-${b.id}`)).toContainText(b.code);
        const listB = await openTile(page, b);
        expect(listB.map((row) => [row.id, row.productId])).toEqual([[onB!.id, y.id]]);
        await expect(page.getByTestId(`opname-count-row-${onB!.id}`)).toContainText(y.name);
        await expect(page.getByTestId(`opname-count-hidden-${onB!.id}`)).toHaveText("hidden");
        // held by the count as every counted row is: Y cannot move off rack B now (a-count-locks-the-product-on-the-rack)
        const move = await send(page, "inventory.v1.RackService/RackMove", {
          teamId: f.warehouse,
          fromRackId: b.id,
          lines: [{ productId: y.id, quantity: 1, toRackId: c.id }],
        });
        expect(move.status, JSON.stringify(move.json)).not.toBe(200);
        expect(String(move.json.message)).toContain("being counted");
        expect(String(move.json.message)).toContain(`#${f.session}`);
        // counted there: none left on B — its book of 3 shows, 3 short, so the move nets out (A +3, B −3)
        const countedB = await submitCount(page, onB!.id, 0);
        expect(countedB.systemStockCount).toBe("3");
        await expectFigures(page, onB!.id, { expected: "3", counted: "0", difference: "−3" });
      });
    });
  }
});

test.describe(`${GIVEN} (${C16})`, () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await seedFound(browser, 16);
  });

  for (const r of ROLES) {
    test(`${r.given} ${FOUND} (${C16})`, async ({ page }) => {
      const f = found[16][r.key];
      const { x, y, h, z } = f.products as Record<"x" | "y" | "h" | "z", Product>;
      const a = f.racks.a!;
      await toCount(page, f);
      expect((await openTile(page, a)).map((row) => row.productId)).toEqual([x.id]);

      await test.step("then: product Z not offered to pick, only products this warehouse has held", async () => {
        // opened, the picker lists what this warehouse holds or has held — X, Y and H (at 0 today) — and nothing else
        const opened = searched(page, "");
        await page.getByTestId("opname-count-add-found").click();
        const dialog = page.getByTestId("opname-found-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("Only products this warehouse holds or has held.");
        expect(await idsOf(await opened)).toEqual([x.id, y.id, h.id].sort());
        const input = dialog.getByRole("combobox");
        await input.click();
        for (const p of [x, y, h]) await expect(dialog.getByTestId(`product-select-option-${p.code}`)).toBeVisible();
        await expect(dialog.getByTestId(`product-select-option-${z.code}`)).toHaveCount(0);

        // the stem Y, H and Z share: Y and H, never Z
        const byStem = searched(page, f.stem);
        await input.pressSequentially(f.stem, { delay: 30 });
        expect(await idsOf(await byStem)).toEqual([y.id, h.id].sort());
        await expect(dialog.getByTestId(`product-select-option-${y.code}`)).toBeVisible();
        await expect(dialog.getByTestId(`product-select-option-${h.code}`)).toBeVisible();
        await expect(dialog.getByTestId(`product-select-option-${z.code}`)).toHaveCount(0);

        // Z by its own name, and by its code: nothing to pick
        for (const q of [z.name, z.code]) {
          await input.fill("");
          const byZ = searched(page, q);
          await input.pressSequentially(q, { delay: 20 });
          expect(await idsOf(await byZ)).toEqual([]);
          await expect(dialog.getByTestId("product-select-none")).toBeVisible();
          await expect(dialog.getByTestId(`product-select-option-${z.code}`)).toHaveCount(0);
        }
        await expect(dialog.getByTestId("opname-found-submit")).toBeDisabled();

        // the same search under the role's own token, and Z sent anyway: refused, its team never had it here — rack A
        // still lists X alone
        expect(await heldIds(page, f.warehouse, f.stem)).toEqual([y.id, h.id].sort());
        const add = await send(page, "inventory.v1.OpnameService/OpnameRowAddFound", {
          teamId: f.warehouse,
          sessionId: f.session,
          placementId: a.id,
          productId: z.id,
        });
        expect(add.status, JSON.stringify(add.json)).not.toBe(200);
        expect(add.json.code).toBe("failed_precondition");
        const after = await api(page, "inventory.v1.OpnameService/OpnameRackCount", {
          teamId: f.warehouse,
          sessionId: f.session,
          placementId: a.id,
        });
        expect(((after.rows ?? []) as Row[]).map((row) => row.productId)).toEqual([x.id]);
      });
    });
  }
});

// send back row — the admin's "recount Rak A" on the count's watch page (/inventories/opname/sessions/<id>): a counted
// row goes back to not counted, its count, its counter and its drafts cleared, and it is counted again blind, with its
// one recount (a-counted-row-is-read-only-until-sent-back, a-row-keeps-only-its-latest-count) — givens 17–18 (section
// *count*). They name warehouse:owner and warehouse:admin, the roles OpnameRowSendBack serves: one test per role, each in
// a warehouse of its own — rack A holding product X (5), root's count of every rack, and a COUNTER, a warehouse staff of
// that warehouse, who counts the row (through the API, under the counter's own token — the counting itself is givens
// 7–14's) and, once it is sent back, counts it again on the count page.
//
//   17 (rack A · product X counted · drafts written) — counted 3 of 5, 1 of the 2 short broken, a reason for each, marked
//      counted: drafts Broken 1 and Lost 1; the role reads it Counted by the counter on the watch page and sends it back
//      (*Send Back to Count* → the confirm *Send Back to Count?*).
//     then: row back to not counted — the answer's row is CREATED; the toast *Sent back to counting on <rack>*; the row's
//           state *Not counted* with no Send Back button; the summary 0 / 1 counted, Finalize disabled and the *rows left*
//           line back; the row on the *Not counted* tab and not on *Counted*;
//     then: its count and drafts cleared — the answer carries no count, no recount, no counter and no draft; the row's
//           Count and Difference read —, no drafts, no counter's name (the book 5 still shows to the admin); the page's
//           own row list read again and rack A as the counter reads it say the same;
//     then: product X needs to be counted again — the counter's rack A tile reads 0 of 1 counted, the card is blind again
//           (*hidden*, no book figure in the rack's answer) with its box and *Submit Count*, no lock line and no drafts;
//           counted 5 it reveals Expected 5, Counted 5, 0 and marks counted again.
//   18 (rack A · product X counted 3 · recounted 4 · no third count left · marked counted) — a third count refused (*the
//      one recount is used*) before it is marked counted with a reason for the Lost 1.
//     then: row back to not counted — as in 17;
//     then: product X needs to be counted again, with one recount — the counter's card blind again with its box; counted
//           3 it reveals −2 and offers *Recount Once* again; recounted 4 the answer marks it recounted, −1, and no third
//           count is offered or taken.

const SEND_BACK = "send back row";
// A given naming two roles is written with neither token in the describe — the marker reads the role from each test.
const SB_GIVEN = "warehouse owner · admin wants a row counted again";
const C17 = "rack A · product X counted · drafts written";
const C18 = "rack A · product X counted 3 · recounted 4 · no third count left · marked counted";
const SB_ROLES = ROLES.filter((r) => r.key !== "s");
type SbKey = "o" | "a";

interface SendBackGround extends Ground {
  counter: string;
  counterName: string;
}

const sentBack: Record<17 | 18, Record<SbKey, SendBackGround>> = {
  17: {} as Record<SbKey, SendBackGround>,
  18: {} as Record<SbKey, SendBackGround>,
};

async function seedSendBack(browser: import("@playwright/test").Browser, g: 17 | 18) {
  const page = await browser.newPage();
  try {
    await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
    for (const r of SB_ROLES) {
      // A team code is at most 10 characters: QC + the two-letter tag + the 6-digit SUFFIX.
      const tag = `${g === 17 ? "S" : "T"}${r.key.toUpperCase()}`;
      const warehouse = await newTeam(page, `E2E Hitung ${tag} ${SUFFIX}`, `QC${tag}${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
      await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouse, feePercent: 10, minFee: 0 });
      const user = `e2eqc${tag.toLowerCase()}${SUFFIX}`;
      const name = `Hitung ${r.given} ${g} ${SUFFIX}`;
      const created = await api(page, "user.v1.UserService/CreateUser", { teamId: warehouse, username: user, password: PASSWORD, name, role: r.role });
      const counter = `e2eqcc${tag.toLowerCase()}${SUFFIX}`;
      const counterName = `Penghitung ${tag} ${SUFFIX}`;
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: warehouse,
        username: counter,
        password: PASSWORD,
        name: counterName,
        role: "ROLE_WAREHOUSE_STAFF",
      });
      const rack = await newRack(page, warehouse, `qc${tag.toLowerCase()}-a-${SUFFIX}`);
      // GIVEN — rack A · product X: 5 received onto A
      const product = await newProduct(page, `QC${tag}X${SUFFIX}`, `Kaos X ${tag} ${SUFFIX}`);
      await receive(page, warehouse, product, 5, rack);
      const session = String(
        (await api(page, "inventory.v1.OpnameService/OpnameSessionCreate", { teamId: warehouse, plan: "OPNAME_PLAN_ALL" })).session.id,
      );
      sentBack[g][r.key as SbKey] = {
        warehouse,
        user,
        userId: String(created.user.id),
        name,
        watcher: "",
        rack,
        product,
        session,
        counter,
        counterName,
      };
    }
  } finally {
    await page.close();
  }
}

// The counter, signed in on a page of their own in the warehouse; returns rack A's one row id, as the rack's read has it.
async function counterOn(browser: import("@playwright/test").Browser, b: SendBackGround): Promise<{ counter: Page; row: string }> {
  const counter = await browser.newPage();
  await signIn(counter, b.counter, PASSWORD);
  await counter.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), b.warehouse);
  const read = await api(counter, "inventory.v1.OpnameService/OpnameRackCount", {
    teamId: b.warehouse,
    sessionId: b.session,
    placementId: b.rack.id,
  });
  const rows = (read.rows ?? []) as Row[];
  expect(rows.map((x) => x.productId)).toEqual([b.product.id]);

  return { counter, row: rows[0]!.id };
}

// The role on the count's watch page; returns the row as the page's own row list (OpnameRowList) carried it.
async function watchRow(page: Page, b: SendBackGround, row: string): Promise<Row> {
  if (page.url() === "about:blank") {
    await signIn(page, b.user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), b.warehouse);
  }
  const listed = page.waitForResponse((res) => res.url().includes("OpnameService/OpnameRowList"));
  await page.goto(`/inventories/opname/sessions/${b.session}`);
  await expect(page.getByTestId("opname-detail-page")).toBeVisible();
  const json = (await (await listed).json()) as { items?: { row?: { mapData?: Record<string, Row> } }[] };
  const listedRow = (json.items ?? []).map((it) => it.row?.mapData?.[row]).find((x) => !!x)!;
  expect(listedRow).toBeTruthy();
  await expect(page.getByTestId(`opname-row-${row}`)).toContainText(b.product.name);

  return listedRow;
}

// WHEN — Send Back to Count on the row, confirmed; returns the row its answer (OpnameRowSendBack) holds.
async function sendBackRow(page: Page, b: SendBackGround, row: string): Promise<Row> {
  await page.getByTestId(`opname-row-send-back-${row}`).click();
  const dialog = page.getByRole("alertdialog", { name: "Send Back to Count?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    `${b.product.name} on ${b.rack.code} goes back to counting: its count and its drafts are cleared, and staff count it again.`,
  );
  const answer = page.waitForResponse((res) => res.url().includes("OpnameService/OpnameRowSendBack"));
  await dialog.getByTestId("confirm-action").click();
  const res = await answer;
  const json = (await res.json().catch(() => ({}))) as { row?: Row };
  expect(res.ok(), JSON.stringify(json)).toBe(true);
  await expect(dialog).toBeHidden();

  return json.row!;
}

// then: row back to not counted — on the answer, the toast, the row, the summary, Finalize and the two tabs.
async function expectBackToNotCounted(page: Page, b: SendBackGround, row: string, back: Row) {
  expect(back.id).toBe(row);
  expect(back.status).toBe("OPNAME_ROW_STATUS_CREATED");
  await expect(
    page.locator('[data-scope="toast"][data-part="root"]').filter({ hasText: `Sent back to counting on ${b.rack.code}` }),
  ).toBeVisible();
  const line = page.getByTestId(`opname-row-${row}`);
  await expect(line.getByTestId("opname-row-state-created")).toHaveText("Not counted");
  await expect(line.getByTestId("opname-row-state-counted")).toHaveCount(0);
  await expect(page.getByTestId(`opname-row-send-back-${row}`)).toHaveCount(0);
  await expect(page.getByTestId("opname-summary-counted")).toContainText("0 / 1");
  await expect(page.getByTestId("opname-detail-finalize")).toBeDisabled();
  await expect(page.getByTestId("opname-detail-finalize-wait")).toBeVisible();

  const notCounted = page.waitForResponse(
    (res) => res.url().includes("OpnameService/OpnameRowList") && (res.request().postData() ?? "").includes("OPNAME_ROW_STATUS_CREATED"),
  );
  await page.getByTestId("opname-detail-tab-created").click();
  await notCounted;
  await expect(page.getByTestId(`opname-row-${row}`).getByTestId("opname-row-state-created")).toHaveText("Not counted");
  const counted = page.waitForResponse(
    (res) => res.url().includes("OpnameService/OpnameRowList") && (res.request().postData() ?? "").includes("OPNAME_ROW_STATUS_COUNTED"),
  );
  await page.getByTestId("opname-detail-tab-counted").click();
  await counted;
  await expect(page.getByTestId("opname-detail-empty")).toBeVisible();
  await expect(page.getByTestId(`opname-row-${row}`)).toHaveCount(0);
}

// The counter on the count page again: rack A's tile 0 of 1 counted, and the card blind, with its box — to be counted.
async function expectToCountAgain(counter: Page, b: SendBackGround, row: string) {
  await counter.goto(`/inventories/opname/sessions/${b.session}/count`);
  await expect(counter.getByTestId(`opname-count-rack-progress-${b.rack.id}`)).toHaveText("0 of 1 counted");
  const reopened = await toRackA(counter, b);
  expect(reopened.id).toBe(row);
  expect(reopened.status).toBe("OPNAME_ROW_STATUS_CREATED");
  expect(reopened.revealed ?? false).toBe(false);
  expect(reopened.recounted ?? false).toBe(false);
  // blind again: the rack's answer carries no book figure for the row
  expect(reopened.systemStockCount ?? "0").toBe("0");
  const card = counter.getByTestId(`opname-count-row-${row}`);
  await expect(card.getByTestId("opname-row-state-created")).toHaveText("Not counted");
  await expect(counter.getByTestId(`opname-count-hidden-${row}`)).toBeVisible();
  await expect(counter.getByTestId(`opname-count-expected-${row}`)).toHaveCount(0);
  await expect(counter.getByTestId(`opname-count-input-${row}`)).toBeVisible();
  await expect(counter.getByTestId(`opname-count-submit-${row}`)).toHaveText("Submit Count");
  await expect(counter.getByTestId(`opname-count-recount-${row}`)).toHaveCount(0);
  await expect(counter.getByTestId(`opname-count-final-drafts-${row}`)).toHaveCount(0);
  await expect(card).not.toContainText(READ_ONLY);
}

test.describe(`${SB_GIVEN} (${C17})`, () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await seedSendBack(browser, 17);
  });

  for (const r of SB_ROLES) {
    test(`${r.given} ${SEND_BACK} (${C17})`, async ({ page, browser }) => {
      const b = sentBack[17][r.key as SbKey];
      const { counter, row } = await counterOn(browser, b);
      try {
        // GIVEN — product X counted: 3 of the 5, 1 of the 2 short broken, a reason for each, marked counted — the
        // drafts Broken 1 and Lost 1 written.
        const brokenNote = `sack torn ${r.key}${SUFFIX}`;
        const lostNote = `not under the rack ${r.key}${SUFFIX}`;
        await api(counter, "inventory.v1.OpnameService/OpnameRowCount", { teamId: b.warehouse, rowId: row, count: 3 });
        const marked = (
          await api(counter, "inventory.v1.OpnameService/OpnameRowMarkCounted", {
            teamId: b.warehouse,
            rowId: row,
            brokenCount: 1,
            brokenNote,
            lostNote,
          })
        ).row as Row;
        expect(marked.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        expect(draftsOf(marked)).toEqual([
          ["OPNAME_DRAFT_TYPE_BROKEN", "1", brokenNote],
          ["OPNAME_DRAFT_TYPE_LOST", "1", lostNote],
        ]);

        // the role reads it on the watch page: Counted, by the counter, 3 against the book's 5, with both drafts —
        // every row counted, so Finalize is open
        const before = await watchRow(page, b, row);
        expect(before.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        const line = page.getByTestId(`opname-row-${row}`);
        await expect(line.getByTestId("opname-row-state-counted")).toHaveText("Counted");
        await expect(line).toContainText(b.counterName);
        await expect(page.getByTestId(`opname-row-difference-${row}`)).toHaveText("−2");
        await expect(page.getByTestId(`opname-row-drafts-${row}`)).toHaveText(
          new RegExp(`^Broken\\s*1\\s*“${brokenNote}”\\s*Lost\\s*1\\s*“${lostNote}”$`),
        );
        await expect(page.getByTestId("opname-summary-counted")).toContainText("1 / 1");
        await expect(page.getByTestId("opname-detail-finalize")).toBeEnabled();

        // WHEN — Send Back to Count.
        const back = await sendBackRow(page, b, row);

        await test.step("then: row back to not counted", async () => {
          await expectBackToNotCounted(page, b, row, back);
        });

        await test.step("then: its count and drafts cleared", async () => {
          // the answer: no count, no recount, no counter, no draft
          expect(back.recountedStockCount ?? "0").toBe("0");
          expect(back.revealed ?? false).toBe(false);
          expect(back.recounted ?? false).toBe(false);
          expect(back.countedById ?? "0").toBe("0");
          expect(back.drafts ?? []).toEqual([]);

          // the page's own row list, read again: the same, and the row draws no count, no difference, no draft and no
          // counter — only the book, which the admin always reads
          const listed = await watchRow(page, b, row);
          expect(listed.status).toBe("OPNAME_ROW_STATUS_CREATED");
          expect(listed.recountedStockCount ?? "0").toBe("0");
          expect(listed.countedById ?? "0").toBe("0");
          expect(listed.drafts ?? []).toEqual([]);
          const cells = page.getByTestId(`opname-row-${row}`).locator(":scope > td");
          await expect(page.getByTestId(`opname-row-book-${row}`)).toHaveText("5");
          await expect(cells.nth(4)).toHaveText("—");
          await expect(cells.nth(5)).toHaveText("—");
          await expect(page.getByTestId(`opname-row-difference-${row}`)).toHaveCount(0);
          await expect(page.getByTestId(`opname-row-drafts-${row}`)).toHaveCount(0);
          await expect(page.getByTestId(`opname-row-${row}`)).not.toContainText(b.counterName);

          // and rack A as the counter reads it
          const now = await rowNow(counter, b, row);
          expect(now.status).toBe("OPNAME_ROW_STATUS_CREATED");
          expect(now.recountedStockCount ?? "0").toBe("0");
          expect(now.countedById ?? "0").toBe("0");
          expect(now.drafts ?? []).toEqual([]);
        });

        await test.step("then: product X needs to be counted again", async () => {
          await expectToCountAgain(counter, b, row);
          // and it is: 5 this time — revealed against the book, a match, marked counted again
          const again = await submitCount(counter, row, 5);
          expect(again.revealed).toBe(true);
          await expectFigures(counter, row, { expected: "5", counted: "5", difference: "0" });
          const remarked = await markCounted(counter, row);
          expect(remarked.status).toBe("OPNAME_ROW_STATUS_COUNTED");
          expect(remarked.drafts ?? []).toEqual([]);
        });
      } finally {
        await counter.close();
      }
    });
  }
});

test.describe(`${SB_GIVEN} (${C18})`, () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await seedSendBack(browser, 18);
  });

  for (const r of SB_ROLES) {
    test(`${r.given} ${SEND_BACK} (${C18})`, async ({ page, browser }) => {
      const b = sentBack[18][r.key as SbKey];
      const { counter, row } = await counterOn(browser, b);
      try {
        // GIVEN — counted 3, recounted 4, no third count left (refused), marked counted with the reason for Lost 1.
        await api(counter, "inventory.v1.OpnameService/OpnameRowCount", { teamId: b.warehouse, rowId: row, count: 3 });
        const recounted = (await api(counter, "inventory.v1.OpnameService/OpnameRowCount", { teamId: b.warehouse, rowId: row, count: 4 }))
          .row as Row;
        expect(recounted.recounted).toBe(true);
        expect(recounted.recountedStockCount).toBe("4");
        const third = await send(counter, "inventory.v1.OpnameService/OpnameRowCount", { teamId: b.warehouse, rowId: row, count: 5 });
        expect(third.status, JSON.stringify(third.json)).not.toBe(200);
        expect(String(third.json.message)).toContain("the one recount is used");
        const lostNote = `one short after the recount ${r.key}${SUFFIX}`;
        const marked = (
          await api(counter, "inventory.v1.OpnameService/OpnameRowMarkCounted", { teamId: b.warehouse, rowId: row, brokenCount: 0, lostNote })
        ).row as Row;
        expect(marked.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        expect(draftsOf(marked)).toEqual([["OPNAME_DRAFT_TYPE_LOST", "1", lostNote]]);

        // the role reads it on the watch page: Counted by the counter, 4 against 5
        const before = await watchRow(page, b, row);
        expect(before.status).toBe("OPNAME_ROW_STATUS_COUNTED");
        expect(before.recounted).toBe(true);
        await expect(page.getByTestId(`opname-row-${row}`).getByTestId("opname-row-state-counted")).toHaveText("Counted");
        await expect(page.getByTestId(`opname-row-${row}`)).toContainText(b.counterName);
        await expect(page.getByTestId(`opname-row-difference-${row}`)).toHaveText("−1");

        // WHEN — Send Back to Count.
        const back = await sendBackRow(page, b, row);

        await test.step("then: row back to not counted", async () => {
          await expectBackToNotCounted(page, b, row, back);
          expect(back.recounted ?? false).toBe(false);
        });

        await test.step("then: product X needs to be counted again, with one recount", async () => {
          await expectToCountAgain(counter, b, row);
          // counted 3: revealed 2 short — and the one recount is offered again
          const first = await submitCount(counter, row, 3);
          expect(first.recounted ?? false).toBe(false);
          await expectFigures(counter, row, { expected: "5", counted: "3", difference: "−2" });
          const recount = counter.getByTestId(`opname-count-recount-${row}`);
          await expect(recount).toHaveText("Recount Once");
          await recount.click();
          await expect(counter.getByTestId(`opname-count-submit-${row}`)).toHaveText("Submit Recount");
          const again = await submitCount(counter, row, 4);
          expect(again.recounted).toBe(true);
          expect(again.recountedStockCount).toBe("4");
          await expectFigures(counter, row, { expected: "5", counted: "4", difference: "−1" });
          // one recount only: none offered now, and a third count is refused again
          for (const id of ["recount", "input", "submit"]) {
            await expect(counter.getByTestId(`opname-count-${id}-${row}`)).toHaveCount(0);
          }
          const more = await send(counter, "inventory.v1.OpnameService/OpnameRowCount", { teamId: b.warehouse, rowId: row, count: 5 });
          expect(more.status, JSON.stringify(more.json)).not.toBe(200);
          expect(String(more.json.message)).toContain("the one recount is used");
        });
      } finally {
        await counter.close();
      }
    });
  }
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #185 — the Liability screens: the position list and one counterparty's history.
//
// THE FIRST THING THE OWNER CAN LOOK AT, and it reads REAL COD obligations (#184) rather than seeded
// ledger rows: the spec creates a restock request and accepts it with a fee paid at the door, which
// is the only way a debt exists in this system today. If the screen is wrong, it is wrong while
// there are two tables and one writer.
//
// Root is a ROOT team, so the Liability menu item is not offered (it is a selling/warehouse surface),
// but root holds ROLE_ROOT and the RPCs are authorised in team 1 — the route is reached directly, as
// orders.spec.ts and expenses.spec.ts do. The menu gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);
const SKU = `SET${SUFFIX}`;
const COD_FEE = 25000;

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
}

// call makes a Connect JSON call with the logged-in token, and fails loudly on a non-200 — a fixture
// that half-worked would produce an empty screen and a confusing assertion.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body] as const,
  );
}

// A COD restock, accepted — the one obligation this system creates today. Team 1 (root) plays the
// requesting team; team 1 cannot owe itself, so the warehouse is a separate id.
const WAREHOUSE_TEAM = 1;

// Shared across the two SERIAL tests below: the second reads the same debt from the other side, so
// it needs the id the first one created.
let warehouseId = "";

test.describe.configure({ mode: "serial" });

test("Liability: a COD acceptance creates the debt every test below reads (#185)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // A warehouse team for the goods to arrive at — the debt is between two DIFFERENT teams, since a
  // team cannot owe itself.
  const wh = await call(page, "team.v1.TeamService/TeamCreate", {
    name: `E2E Settle WH ${SUFFIX}`,
    teamCode: `SW${SUFFIX}`.slice(0, 10),
    type: "TEAM_TYPE_WAREHOUSE",
  });
  expect(wh.status).toBe(200);

  warehouseId = String(wh.body.team.id);

  const created = await call(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: String(WAREHOUSE_TEAM),
    warehouseId,
    shippingCode: "jne",
    items: [{ productId: "100", sku: SKU, name: "Widget", quantity: 10, totalPrice: "500000" }],
  });
  expect(created.status).toBe(200);

  const request = created.body.request;

  // The warehouse accepts, paying the courier at the door. THIS is what creates the obligation.
  const accepted = await call(page, "inventory.v1.RestockRequestService/RestockRequestFulfill", {
    teamId: warehouseId,
    requestId: String(request.id),
    costLines: [{ kind: "RESTOCK_COST_KIND_COD_SHIPPING", amount: String(COD_FEE) }],
    lines: request.items.map((item: { id: string; quantity: number }) => ({
      itemId: item.id,
      receivedQuantity: item.quantity,
      // "unplaced" is a REAL PLACE in this system (#135), not a rack id of zero — the contract makes
      // that a oneof so an empty row cannot masquerade as a partial put-away.
      placements: [{ unplaced: true, quantity: String(item.quantity) }],
    })),
  });
  expect(accepted.status).toBe(200);

  // ⚠ NO SCREEN ASSERTION HERE ANY MORE. This test used to read the debt off `/settlement`, which is
  // deleted — the word now means the MARKETPLACE PAYOUT, and this ledger reads at `/liability`. What
  // it still does is the part the later tests cannot do for themselves: CREATE the obligation. A COD
  // acceptance is the only way a debt exists in this system today, so every assertion below depends
  // on this having run, which is what `mode: "serial"` is for.
  expect(warehouseId).not.toBe("");
});

// THE SAME DEBT FROM THE OTHER SIDE. One signed number, one query, one convention — neither team has
// to know which way round the pair was stored.
//
// ⚠ RETARGETED from the deleted `/settlement` page rather than deleted with it. The rule is unchanged,
// but the redesign shows direction as TWO COLUMNS instead of a sentence, so what read `"They owe you"`
// is now "the amount sits in RECEIVABLE and PAYABLE is a dash". Nothing else in this file reads the
// ledger from the creditor's side.
test("Liability: the warehouse sees the same debt as money owed TO it (#185)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/liability");
  await expect(page.getByTestId("liability-list-page")).toBeVisible();

  // Root holds a role in every team, so the switcher is how the other side is reached. Selected by
  // TESTID, not by text: the switcher shows the current team AND the option list, so the name is on
  // screen twice.
  await page.getByTestId("team-switcher").click();
  await page.getByTestId(`team-option-${warehouseId}`).click();

  await page.goto("/liability");
  await expect(page.getByTestId("liability-table")).toBeVisible();

  // Team 1 owes THIS team, so from here the money is RECEIVABLE — the second of the two money cells.
  const cells = page.getByTestId(`liability-row-${WAREHOUSE_TEAM}`).locator("td");
  await expect(cells.nth(1)).toHaveText("—");
  await expect(cells.nth(2)).toHaveText("Rp 25.000");
});

// #221 — the Chakra redesign at /liability. Same real debt as above (root owes the warehouse), but the
// direction is TWO COLUMNS now, never a sign: the amount lands in Payable, and the age is its own cell.
// Reuses the serial seed's warehouseId.
test("Liability redesign: the position reads in two columns on /liability (#221)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/liability");
  await expect(page.getByTestId("liability-list-page")).toBeVisible();
  await expect(page.getByTestId("liability-table")).toBeVisible();

  const row = page.getByTestId(`liability-row-${warehouseId}`);
  await expect(row).toBeVisible();
  // Root OWES the warehouse, so the amount is in the Payable column — no minus sign anywhere.
  await expect(row).toContainText("Rp 25.000");
  await expect(row).not.toContainText("-");
  await expect(page.getByTestId(`liability-age-${warehouseId}`)).toBeVisible();

  // The header tile totals the payable side.
  await expect(page.getByTestId("liability-total-payable")).toContainText("Rp 25.000");
});

// #222 — the counterparty detail, redesigned. Clicking a /liability row opens the relationship's
// history: the net position in words, the ledger split by direction with its TYPED cause, and the
// Make-Payment form. Reuses the serial seed (root owes the warehouse a COD fee).
test("Liability redesign: the counterparty detail opens with the ledger and its typed cause (#222)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/liability");
  await page.getByTestId(`liability-row-${warehouseId}`).click();

  await expect(page.getByTestId("liability-detail-page")).toBeVisible();
  // Net position, in words — never a sign.
  await expect(page.getByTestId("liability-detail-balance")).toContainText("You owe them Rp 25.000");

  // The Payable tab carries the debt, named by its typed cause + the restock id (not a free-text note).
  await page.getByTestId("liability-detail-tab-payable").click();
  await expect(page.getByTestId("liability-detail-payable")).toContainText("Delivery costs");

  // Make Payment opens the two-phase form (recording alone moves nothing until they confirm).
  await page.getByTestId("liability-detail-make-payment").click();
  await expect(page.getByTestId("record-amount")).toBeVisible();
});

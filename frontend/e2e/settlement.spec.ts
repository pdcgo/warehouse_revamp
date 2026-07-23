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

test("Liability: a COD acceptance shows up as a real debt, in words (#185)", async ({ page }) => {
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
    codShippingFee: String(COD_FEE),
    lines: request.items.map((item: { id: string; quantity: number }) => ({
      itemId: item.id,
      receivedQuantity: item.quantity,
      // "unplaced" is a REAL PLACE in this system (#135), not a rack id of zero — the contract makes
      // that a oneof so an empty row cannot masquerade as a partial put-away.
      placements: [{ unplaced: true, quantity: String(item.quantity) }],
    })),
  });
  expect(accepted.status).toBe(200);

  // The requesting team's position: it OWES the warehouse.
  await page.goto("/settlement");
  await expect(page.getByTestId("settlement-table")).toBeVisible();

  const position = page.getByTestId(`position-${warehouseId}`);
  await expect(position).toBeVisible();

  // ⚠ DIRECTION IS WORDS, NEVER A SIGN. A bare "−25.000" would make the reader decode a minus into a
  // direction, and the thing they would get wrong is which way the money goes.
  await expect(position).toHaveText("You owe them Rp 25.000");
  await expect(page.getByTestId(`ageing-${warehouseId}`)).toContainText("oldest unsettled");

  // The counterparty detail is a PAGE, reached by clicking the row.
  await page.getByTestId(`open-counterparty-${warehouseId}`).click();
  await expect(page.getByTestId("counterparty-page")).toBeVisible();
  await expect(page.getByTestId("counterparty-balance")).toHaveText("You owe them Rp 25.000");

  // And the line says WHY, by id — which is what the typed (source_type, source_id) pair was for.
  await expect(page.getByTestId("counterparty-table")).toContainText("COD fee, restock");
  await expect(page.getByTestId("counterparty-table")).toContainText(`#${request.id}`);
});

// The other side of the same debt reads as the OPPOSITE sentence from the same signed number. Both
// teams use one query and one convention; neither has to know which way round the pair was stored.
test("Liability: the warehouse sees the same debt as money owed TO it (#185)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Switch the app to the warehouse team, then read its position on team 1.
  await page.goto("/settlement");

  const rows = page.getByTestId("settlement-table");
  await expect(rows).toBeVisible();

  // Root holds a role in every team, so the switcher is how the other side is reached. Selected by
  // TESTID, not by text: the switcher shows the current team AND the option list, so the name is on
  // screen twice.
  await page.getByTestId("team-switcher").click();
  await page.getByTestId(`team-option-${warehouseId}`).click();

  await page.goto("/settlement");
  await expect(page.getByTestId("settlement-table")).toBeVisible();

  await expect(page.getByTestId(`position-${WAREHOUSE_TEAM}`)).toHaveText(
    "They owe you Rp 25.000",
  );
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

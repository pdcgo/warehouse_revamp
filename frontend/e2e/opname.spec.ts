import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// A STOCK OPNAME: stand at a shelf, count what is on it, correct the lot in one act.
//
// The Stock Opname menu item lives in the warehouse's Inventories sub-menu, but root holds ROLE_ROOT so
// the RPCs are authorised in the root team — the page is reached by its route, exactly as racks.spec.ts
// does. The menu gate is UX only.
//
// The shelf is seeded through the REAL flow (create a rack, raise a restock, fulfil it onto the rack),
// because a stock-take is only meaningful over stock that arrived the way stock arrives — cost layers
// included, since a shortfall is priced off them.

const SUFFIX = Date.now().toString().slice(-6);

// ⚠ EVERY TEST GETS ITS OWN SHELF AND ITS OWN PRODUCTS.
//
// These run serially against one database, and three of them post counts — so a shared shelf would let
// one test's correction become the next one's "expected", and the failure would look like a bug in the
// handler rather than in the fixture. A rack code is unique per warehouse, so re-seeding the same one
// also just 409s.
//
// The product ids are far from anything else in the suite, so another spec's stock can never appear on
// a shelf this one is counting.
let shelfSeq = 0;

function shelfIds() {
  shelfSeq += 1;

  const base = 900_000 + shelfSeq * 10;

  return { code: `OP${SUFFIX}-${shelfSeq}`, productA: base, productB: base + 1 };
}

const ARRIVED_A = 50;
const ARRIVED_B = 30;
// 10.000/pc for A — the price the write-off is checked against.
const TOTAL_A = ARRIVED_A * 10_000;
const TOTAL_B = ARRIVED_B * 20_000;

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

// rpc calls the API with the page's own token, so the seed runs as the same person the UI does.
async function rpc(page: Page, method: string, body: unknown): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      if (!res.ok) throw new Error(`${m}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body] as const,
  );
}

// Seeds one shelf holding two products, and returns its rack id.
async function seedShelf(page: Page): Promise<{ rack: string; productA: number; productB: number }> {
  const { code, productA, productB } = shelfIds();

  const rack = (await rpc(page, "warehouse.inventory.v1.RackService/RackCreate", {
    teamId: "1",
    code,
  })) as { rack: { id: string } };

  const created = (await rpc(page, "warehouse.inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: "1",
    warehouseId: "1",
    shippingCode: "jne",
    items: [
      { productId: String(productA), sku: `A${code}`, name: "Opname A", quantity: String(ARRIVED_A), totalPrice: String(TOTAL_A) },
      { productId: String(productB), sku: `B${code}`, name: "Opname B", quantity: String(ARRIVED_B), totalPrice: String(TOTAL_B) },
    ],
  })) as { request: { id: string; items: { id: string }[] } };

  await rpc(page, "warehouse.inventory.v1.RestockRequestService/RestockRequestFulfill", {
    teamId: "1",
    requestId: created.request.id,
    lines: created.request.items.map((item, i) => ({
      itemId: item.id,
      receivedQuantity: String(i === 0 ? ARRIVED_A : ARRIVED_B),
      placements: [{ rackId: rack.rack.id, quantity: String(i === 0 ? ARRIVED_A : ARRIVED_B) }],
    })),
  });

  return { rack: rack.rack.id, productA, productB };
}

test.describe.configure({ mode: "serial" });

// THE COUNT SHEET. Picking a shelf shows everything on it with what the system believes is there —
// beside an empty box, because the count is the person's answer, not a prefilled number to accept.
test("Opname: a shelf shows what the system believes, ready to be counted", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const { rack, productA, productB } = await seedShelf(page);

  await page.goto(`/inventories/opname?rack=${rack}`);
  await expect(page.getByTestId("opname-table")).toBeVisible();

  await expect(page.getByTestId(`opname-row-${productA}`)).toContainText(String(ARRIVED_A));
  await expect(page.getByTestId(`opname-row-${productB}`)).toContainText(String(ARRIVED_B));

  // Nothing is counted until somebody types. The boxes start EMPTY — a prefilled expected figure would
  // turn a stock-take into a confirmation, which is the one thing it must not be.
  await expect(page.getByTestId(`opname-count-${productA}`)).toHaveValue("");
  await expect(page.getByTestId("opname-counted-count")).toHaveText("0");
  await expect(page.getByTestId("opname-uncounted-count")).toHaveText("2");

  // With nothing counted there is nothing to post.
  await expect(page.getByTestId("opname-post")).toBeDisabled();
});

// THE VARIANCE IS LIVE, and a blank box is NOT a zero. Those two facts are the whole contract of this
// screen, so they are asserted before anything is posted.
test("Opname: typing a count shows the variance; a blank box stays uncounted", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const { rack, productA, productB } = await seedShelf(page);

  await page.goto(`/inventories/opname?rack=${rack}`);
  await expect(page.getByTestId("opname-table")).toBeVisible();

  await page.getByTestId(`opname-count-${productA}`).fill(String(ARRIVED_A - 5));

  await expect(page.getByTestId(`opname-variance-${productA}`)).toHaveText("-5");
  // The one nobody typed in reads as an em dash, not 0 — and is still counted as NOT counted.
  await expect(page.getByTestId(`opname-variance-${productB}`)).toHaveText("—");
  await expect(page.getByTestId("opname-counted-count")).toHaveText("1");
  await expect(page.getByTestId("opname-uncounted-count")).toHaveText("1");
  await expect(page.getByTestId("opname-variance-count")).toHaveText("1");

  // A surplus is signed too, and the other way.
  await page.getByTestId(`opname-count-${productB}`).fill(String(ARRIVED_B + 3));
  await expect(page.getByTestId(`opname-variance-${productB}`)).toHaveText("+3");
});

// POSTING IT — the whole point, end to end: the correction lands, the shortfall is priced off the cost
// layer it came from, and the product nobody counted is left exactly as it was.
//
// That last assertion is the one that matters most. "A sweep means everything else is gone" is the
// tempting reading and it would silently write off real stock, so it is proved here rather than trusted.
test("Opname: posting corrects the shelf, prices the shortfall, and leaves uncounted stock alone", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const { rack, productA, productB } = await seedShelf(page);

  await page.goto(`/inventories/opname?rack=${rack}`);
  await expect(page.getByTestId("opname-table")).toBeVisible();

  await page.getByTestId(`opname-count-${productA}`).fill(String(ARRIVED_A - 5));
  await page.getByTestId("opname-note").fill(`e2e ${SUFFIX}`);

  // A count changes real stock and writes off value, so it confirms (the destructive-action rule).
  await page.getByTestId("opname-post").click();
  await page.getByRole("button", { name: "Post count" }).click();

  const result = page.getByTestId("opname-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText("1 differed");

  // 5 missing at 10.000/pc — priced off the batch the delivery minted, not guessed.
  await expect(page.getByTestId("opname-result-loss")).toContainText("50.000");

  // THE SHELF NOW HOLDS WHAT WAS COUNTED, and the untouched product still holds what arrived. Read back
  // from a fresh load, so this is the server's answer rather than the screen's own state.
  await page.goto(`/inventories/opname?rack=${rack}`);
  await expect(page.getByTestId("opname-table")).toBeVisible();

  await expect(page.getByTestId(`opname-row-${productA}`)).toContainText(String(ARRIVED_A - 5));
  await expect(page.getByTestId(`opname-row-${productB}`)).toContainText(String(ARRIVED_B));
});

// The write-off reaches the MONEY, not just the stock ledger. A warehouse's daily statement is
// fees earned − (its expenses + stock loss), so a count that corrected the shelf and booked nothing
// would leave the biggest controllable cost in a warehouse invisible where it is meant to appear.
test("Opname: the shortfall shows up as stock loss on the daily statement", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const { rack, productA, productB } = await seedShelf(page);

  await page.goto(`/inventories/opname?rack=${rack}`);
  await expect(page.getByTestId("opname-table")).toBeVisible();

  await page.getByTestId(`opname-count-${productA}`).fill(String(ARRIVED_A - 5));
  await page.getByTestId("opname-post").click();
  await page.getByRole("button", { name: "Post count" }).click();
  await expect(page.getByTestId("opname-result")).toBeVisible();

  // Root's team is not a WAREHOUSE, so the statement renders in selling mode — but the expense is on
  // team 1 either way, and the stock-loss line is what proves the two features are joined up.
  await page.goto("/statement");
  await expect(page.getByTestId("statement-summary")).toBeVisible();

  await expect(page.getByTestId("statement-total-stock-loss")).toContainText("stock written off");
});

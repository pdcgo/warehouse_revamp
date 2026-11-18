import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE WAREHOUSE SEES THE COD IT PAID — this month's, and only its own
// (docs/technical/frontend/restock_decision.md#the-warehouse-sees-the-cod-it-paid, built 2026-11-16;
// docs/business/inventory/restock_decision.md#the-warehouse-cost-is-the-couriers-charge-at-the-door): the warehouse
// restock list's last card, *COD paid*, sums the courier's charge the warehouse handed over at the door
// (`warehouse_additional_cost`, entered at accept) over the restocks SENT TO THIS WAREHOUSE and ACCEPTED this Jakarta
// month with a charge above 0, and its line counts them. Never the goods' value; not narrowed by the list's *From*
// filter, which restates the queue's question.
//
//   R1  seller A → W    accepted, charge Rp 8.000        counted
//   R2  seller A → W    accepted, no charge              not counted — the line says how many it PAID on
//   R3  seller B → W    accepted, charge Rp 12.500       counted
//   R4  seller A → W    arrived, not accepted            not counted
//   R5  seller A → W2   accepted, charge Rp 99.000       W2's, never W's
//
//   W:  Rp 20.500 · this month · 2 restocks          W2: Rp 99.000 · this month · 1 restock
//
// Teams of their own, owned by root; each seller pays from its own account — root's team 1 is never touched. The file
// sorts after statement.spec.ts.

const SUFFIX = Date.now().toString().slice(-6);

const state = { w: "", w2: "", sellerA: "", sellerB: "", r: {} as Record<string, string> };

async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const r = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: r.status, body: await r.json() };
    },
    [method, body, API_URL] as const,
  );
}

async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// Unix seconds of a Jakarta wall-clock time (WIB, UTC+7, no daylight saving).
const wib = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => Date.UTC(y, m - 1, d, h - 7, min, s) / 1000;

async function codPaid(page: Page, teamId: string, fromUnix: number, toUnix: number) {
  const res = await ok<{ restockCount?: string; amount?: number }>(page, "inventory.v1.RestockRequestService/RestockCodPaidStat", {
    teamId,
    fromUnix,
    toUnix,
  });

  return { restocks: Number(res.restockCount ?? 0), amount: res.amount ?? 0 };
}

// This Jakarta month, 00:00 WIB on the 1st through 23:59:59 WIB today — the window the card asks for.
function thisMonth() {
  const [y, m, d] = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).split("-").map(Number) as [
    number,
    number,
    number,
  ];

  return [wib(y, m, 1), wib(y, m, d, 23, 59, 59)] as const;
}

async function expectCard(page: Page, amount: string, line: string) {
  await expect(page.getByTestId("restock-stat-cod-value")).toHaveText(amount);
  await expect(page.getByTestId("restock-stat-cod")).toContainText(line);
}

test.describe.configure({ mode: "serial" });

test("Setup: two warehouses, two sellers, five restocks — three accepted into W, one with no charge", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  state.w = await team(`E2E COD Gudang ${SUFFIX}`, `CW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  state.w2 = await team(`E2E COD Gudang Dua ${SUFFIX}`, `CV${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  state.sellerA = await team(`E2E COD Seller A ${SUFFIX}`, `CA${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.sellerB = await team(`E2E COD Seller B ${SUFFIX}`, `CB${SUFFIX}`, "TEAM_TYPE_SELLING");

  const rackIn = async (warehouse: string, code: string) =>
    String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code })).rack.id);
  const rackW = await rackIn(state.w, `cod${SUFFIX}-w`);
  const rackW2 = await rackIn(state.w2, `cod${SUFFIX}-v`);

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E COD ${SUFFIX}` })).category
    .id as string;

  // Each seller: one product and an operational account to pay from.
  const ground = async (seller: string, tag: string) => {
    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId: seller,
        productCodePart: `CD${tag}${SUFFIX}`,
        name: `Kaos COD ${tag}`,
        categoryId: category,
      })
    ).product as { id: string; productCode: string };
    const account = (
      await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E COD ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-COD-${tag}-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id as string;
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: seller,
      accountId: account,
      operational: true,
    });

    return { seller, product, account, tag };
  };
  const a = await ground(state.sellerA, "A");
  const b = await ground(state.sellerB, "B");

  const raise = async (g: Awaited<ReturnType<typeof ground>>, warehouse: string, count: number) =>
    (
      await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: g.seller,
        warehouseId: warehouse,
        financeAccountId: g.account,
        items: [{ productId: g.product.id, productCode: g.product.productCode, name: `Kaos COD ${g.tag}`, count, total: count * 10_000 }],
      })
    ).request as { id: string; items: { id: string }[] };

  // Accepted whole onto the warehouse's one rack, with the courier's charge at the door (its note is required once there
  // is a charge) — or none.
  const accept = async (warehouse: string, rack: string, request: { id: string; items: { id: string }[] }, count: number, charge: number) => {
    await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: request.id,
      lines: [{ itemId: request.items[0]!.id, receivedCount: count, placements: [{ placementId: rack, quantity: count }] }],
      ...(charge > 0 ? { warehouseAdditionalCost: charge, warehouseAdditionalCostNote: "ongkir COD di pintu" } : {}),
    });
  };

  const r1 = await raise(a, state.w, 2);
  await accept(state.w, rackW, r1, 2, 8_000);
  const r2 = await raise(a, state.w, 3);
  await accept(state.w, rackW, r2, 3, 0);
  const r3 = await raise(b, state.w, 4);
  await accept(state.w, rackW, r3, 4, 12_500);
  const r4 = await raise(a, state.w, 5);
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestArrive", { teamId: state.w, requestId: r4.id });
  const r5 = await raise(a, state.w2, 6);
  await accept(state.w2, rackW2, r5, 6, 99_000);

  state.r = { r1: r1.id, r2: r2.id, r3: r3.id, r4: r4.id, r5: r5.id };
});

test("RestockCodPaidStat: this month's charges on the restocks this warehouse accepted — no other window, no other warehouse", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  const [from, to] = thisMonth();

  // R1 + R3: the no-charge R2 and the arrived R4 are not counted, and R5 went to W2.
  expect(await codPaid(page, state.w, from, to)).toEqual({ restocks: 2, amount: 20_500 });
  expect(await codPaid(page, state.w2, from, to)).toEqual({ restocks: 1, amount: 99_000 });

  // A window the restocks were not accepted in holds nothing.
  expect(await codPaid(page, state.w, wib(2020, 1, 1), wib(2020, 1, 31, 23, 59, 59))).toEqual({ restocks: 0, amount: 0 });

  // A window that ends before it starts is refused.
  const backwards = await call(page, "inventory.v1.RestockRequestService/RestockCodPaidStat", {
    teamId: state.w,
    fromUnix: to,
    toUnix: from,
  });
  expect(backwards.status).toBe(400);
});

test("The page: COD paid is Rp 20.500 over 2 restocks; From narrows the list, never the card; W2 has its own", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.w);

  await page.goto("/inventories/restock?status=all");
  await expect(page.getByTestId("restock-inbound-page")).toBeVisible();
  await expect(page.getByTestId(`restock-row-${state.r.r3}`)).toBeVisible();
  await expectCard(page, "Rp 20.500", "this month · 2 restocks");
  await expect(page.getByTestId("restock-stat-cod-note")).toHaveText("owed back by the selling teams");
  // The figure is real now — no sample mark on the card.
  await expect(page.getByTestId("not-implemented-cod")).toHaveCount(0);

  // From = seller A: B's R3 leaves the list, and the card still says what the warehouse paid this month.
  await page.goto(`/inventories/restock?status=all&from=${state.sellerA}`);
  await expect(page.getByTestId(`restock-row-${state.r.r1}`)).toBeVisible();
  await expect(page.getByTestId(`restock-row-${state.r.r3}`)).toHaveCount(0);
  await expectCard(page, "Rp 20.500", "this month · 2 restocks");

  // The other warehouse's card is its own: R5 alone.
  await useTeam(page, state.w2);
  await page.goto("/inventories/restock?status=all");
  await expect(page.getByTestId(`restock-row-${state.r.r5}`)).toBeVisible();
  await expectCard(page, "Rp 99.000", "this month · 1 restock");
});

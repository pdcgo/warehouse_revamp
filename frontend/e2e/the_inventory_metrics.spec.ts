import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// THE FOUR INVENTORY METRICS ON ANALYTIC, END TO END (docs/business/analytic/rpc_provide_decision.md —
// the-inventory-metrics-prototype-is-accepted, a-transfer-counts-each-side-on-its-own-day,
// a-warehouse-sees-ready-value-but-a-shelf-only-units, ready-stock-is-folded-in-the-stock-changes-own-step) — against the
// real server and Postgres:
//
//   · a SELLING TEAM owned by Dewi restocks 12 Kaos Metrik at Rp 10.000 into warehouse A (Wati's): A's door finds 11 in
//     the box, 1 of them broken — 10 good units on the rack, 1 broken, 1 missing;
//   · Dewi moves 4 of them from A to warehouse B (Wati's too): A processes and ships it, B counts the 4 in — all today;
//   · DEWI reads it on Analytic: Restock by warehouse (A: 10 accepted, Rp 100.000, 1 broken, 1 missing); Transfer and
//     Ready stock by warehouse (A sent 4 / Rp 40.000, B received 4 / Rp 40.000, nothing on the road; on hand A 6, B 4 —
//     the headline 10 and Rp 100.000, the last day's stock);
//   · WATI, a warehouse member, opens Dewi's link ranking Restock by value: it opens on units, with no value tile, column
//     or cell — and her Ready stock shows its value (A's 6 units, Rp 60.000).
//
// Its own teams (the shape of the_owner_corrects_a_batch_price.spec.ts), no order placed, root's own team never touched;
// it sorts after orders.spec.ts and statement.spec.ts. Every write is a real RPC as root; every figure is read on screen.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-metrik-pass-1";
// A username is lowercase letters and digits only.
const DEWI = `e2emetrikdewi${SUFFIX}`;
const WATI = `e2emetrikwati${SUFFIX}`;
const WH_A = `E2E Metrik Gudang A ${SUFFIX}`;
const WH_B = `E2E Metrik Gudang B ${SUFFIX}`;

const RESTOCK = "metrics/inventory/restock";
const TRANSFER = "metrics/inventory/transfer";
const READY = "metrics/inventory/ready";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

const state = { seller: "", whA: "", whB: "", rackA: "", rackB: "", product: "" };

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

// A seed call that must succeed — its JSON body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await page.evaluate(
    async ([m, b]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const r = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: r.status, body: await r.json() };
    },
    [method, body] as const,
  );
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

test.describe.configure({ mode: "serial" });

test("Setup: Dewi restocks 12 into A (10 good, 1 broken, 1 missing) and moves 4 to B, all today", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // TeamCreate names an EXISTING person as the Owner, so Dewi and Wati are made first in a scratch team of root's.
  const scratch = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Metrik Scratch ${SUFFIX}`,
      teamCode: `MX${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  const [dewi, wati] = await Promise.all(
    [
      [DEWI, `Dewi Metrik ${SUFFIX}`],
      [WATI, `Wati Metrik ${SUFFIX}`],
    ].map(
      async ([username, name]) =>
        (
          await ok(page, "user.v1.UserService/CreateUser", {
            teamId: scratch,
            username,
            password: PASSWORD,
            name,
            role: "ROLE_SELLING_ADMIN",
          })
        ).user.id as string,
    ),
  );
  const team = async (name: string, code: string, type: string, owner: string) =>
    (await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: owner })).team.id as string;
  state.whA = await team(WH_A, `MA${SUFFIX}`, "TEAM_TYPE_WAREHOUSE", wati);
  state.whB = await team(WH_B, `MB${SUFFIX}`, "TEAM_TYPE_WAREHOUSE", wati);
  state.seller = await team(`E2E Metrik Seller ${SUFFIX}`, `MS${SUFFIX}`, "TEAM_TYPE_SELLING", dewi);

  state.rackA = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.whA, code: `met-a-${SUFFIX}` })).rack.id;
  state.rackB = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.whB, code: `met-b-${SUFFIX}` })).rack.id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Metrik ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `MT${SUFFIX}`,
      name: "Kaos Metrik",
      categoryId: category,
    })
  ).product;
  state.product = product.id;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E metrik restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-MET-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account,
    operational: true,
  });

  // The restock: 12 ordered at Rp 120.000 — Rp 10.000 a unit, no freight. A's door: 11 in the box, 1 broken.
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: state.seller,
    warehouseId: state.whA,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Metrik", count: 12, total: 120000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.whA,
    requestId: restock.request.id,
    lines: [
      {
        itemId: restock.request.items[0].id,
        receivedCount: 11,
        brokenCount: 1,
        brokenNote: "sobek",
        placements: [{ placementId: state.rackA, quantity: 10 }],
      },
    ],
  });

  // The transfer: 4 from A to B — opened by the seller, processed and shipped by A, counted in by B.
  const created = await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferCreate", {
    teamId: state.seller,
    fromWarehouseId: state.whA,
    toWarehouseId: state.whB,
    lines: [{ productId: state.product, count: "4" }],
  });
  const transfer = created.transfer.id;
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferProcess", { teamId: state.whA, transferId: transfer });
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferShip", {
    teamId: state.whA,
    transferId: transfer,
    receipt: `JPM${SUFFIX}`,
  });
  const detail = await ok<{ transfer: { items: { id: string }[] } }>(
    page,
    "inventory.v1.WarehouseTransferService/WarehouseTransferDetail",
    { teamId: state.whB, transferId: transfer },
  );
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferAccept", {
    teamId: state.whB,
    transferId: transfer,
    lines: [{ itemId: detail.transfer.items[0]!.id, arrivedCount: "4", placements: [{ placementId: state.rackB, quantity: "4" }] }],
  });
});

test("Dewi reads Restock by warehouse: A accepted 10 at Rp 100.000, 1 broken and 1 missing at the door", async ({ page }) => {
  await login(page, DEWI, PASSWORD);
  await useTeam(page, state.seller);

  await page.goto(`/analytic?g=warehouse&m=${RESTOCK}&r=7d`);
  await expect(page.getByTestId("analytic-table")).toBeVisible();
  await expect(page.getByTestId(`analytic-row-${state.whA}`)).toContainText(WH_A);
  await expect(page.getByTestId(/^analytic-row-/)).toHaveCount(1);
  await expect(page.getByTestId(`analytic-cell-${state.whA}-accepted_count`)).toHaveText("10");
  await expect(page.getByTestId(`analytic-cell-${state.whA}-accepted_value`)).toHaveText(rp(100_000));
  await expect(page.getByTestId(`analytic-cell-${state.whA}-broken_count`)).toHaveText("1");
  await expect(page.getByTestId(`analytic-cell-${state.whA}-missing_count`)).toHaveText("1");
  await expect(page.getByTestId("analytic-headline-accepted_value-value")).toHaveText(rp(100_000));
});

test("Dewi reads Transfer and Ready stock by warehouse: A sent 4, B received 4; on hand A 6, B 4 — 10 in all", async ({ page }) => {
  await login(page, DEWI, PASSWORD);
  await useTeam(page, state.seller);

  // Ranked by units on hand, so both warehouses are rows; Transfer fills the same rows.
  await page.goto(`/analytic?g=warehouse&m=${TRANSFER},${READY}&r=7d&s=${READY}:on_hand_count:desc`);
  await expect(page.getByTestId("analytic-table")).toBeVisible();
  await expect(page.getByTestId(/^analytic-row-/)).toHaveCount(2);
  await expect(page.getByTestId(`analytic-row-${state.whB}`)).toContainText(WH_B);

  const a = (field: string) => page.getByTestId(`analytic-cell-${state.whA}-${field}`);
  const b = (field: string) => page.getByTestId(`analytic-cell-${state.whB}-${field}`);

  // Each side on its own day: A sent at the create, B received at the accept — both today; nothing left on the road.
  await expect(a("sent_count")).toHaveText("4");
  await expect(a("sent_value")).toHaveText(rp(40_000));
  await expect(a("received_count")).toHaveText("0");
  await expect(b("received_count")).toHaveText("4");
  await expect(b("received_value")).toHaveText(rp(40_000));
  await expect(b("sent_count")).toHaveText("0");
  await expect(page.getByTestId("analytic-headline-in_transit_count-value")).toHaveText("0");

  // Ready stock: what each shelf holds at the end of today; the headline is that day's whole stock.
  await expect(a("on_hand_count")).toHaveText("6");
  await expect(a("on_hand_value")).toHaveText(rp(60_000));
  await expect(b("on_hand_count")).toHaveText("4");
  await expect(b("on_hand_value")).toHaveText(rp(40_000));
  await expect(page.getByTestId("analytic-headline-on_hand_count-value")).toHaveText("10");
  await expect(page.getByTestId("analytic-headline-on_hand_value-value")).toHaveText(rp(100_000));

  // By day, the headline is the LAST day's stock — 10 — not the days added up.
  await page.goto(`/analytic?g=daily&m=${READY}&r=7d`);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  await expect(page.getByTestId(`analytic-cell-${today}-on_hand_count`)).toHaveText("10");
  await expect(page.getByTestId("analytic-headline-on_hand_count-value")).toHaveText("10");
});

test("Wati, a warehouse member, opens Dewi's value-ranked Restock link: units only; her Ready stock shows its value", async ({
  page,
}) => {
  await login(page, WATI, PASSWORD);
  await useTeam(page, state.whA);

  // Dewi's link ranks by value accepted — a warehouse is never given it, so the screen ranks by units instead of failing.
  await page.goto(`/analytic?g=product&m=${RESTOCK},${READY}&r=7d&s=${RESTOCK}:accepted_value:desc`);
  await expect(page.getByTestId("analytic-table")).toBeVisible();
  await expect(page.getByTestId("analytic-error")).toHaveCount(0);
  await expect(page.getByTestId(`analytic-row-${state.product}`)).toContainText("Kaos Metrik");
  await expect(page.getByTestId(`analytic-cell-${state.product}-accepted_count`)).toHaveText("10");
  await expect(page.getByTestId("analytic-headline-accepted_count-value")).toHaveText("10");
  await expect(page.getByTestId(`analytic-cell-${state.product}-broken_count`)).toHaveText("1");

  // No value on Restock: no tile, no column, no cell.
  await expect(page.getByTestId("analytic-headline-accepted_value")).toHaveCount(0);
  await expect(page.getByTestId("analytic-sort-accepted_value")).toHaveCount(0);
  await expect(page.getByTestId(`analytic-cell-${state.product}-accepted_value`)).toHaveCount(0);

  // Ready stock's value she reads (a-warehouse-sees-ready-value-but-a-shelf-only-units): A's own 6 units.
  await expect(page.getByTestId(`analytic-cell-${state.product}-on_hand_count`)).toHaveText("6");
  await expect(page.getByTestId(`analytic-cell-${state.product}-on_hand_value`)).toHaveText(rp(60_000));
  await expect(page.getByTestId("analytic-headline-on_hand_value-value")).toHaveText(rp(60_000));
});

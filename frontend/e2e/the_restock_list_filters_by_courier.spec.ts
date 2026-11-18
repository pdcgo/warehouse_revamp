import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { listLanded } from "./pickers";

// THE RESTOCK LIST FILTERS BY COURIER, AND EACH DATE READS ITS OWN COLUMN — end to end, on the real server and Postgres
// (backlog #68):
//
//   the-restock-list-exports-and-filters-by-courier (docs/technical/frontend/restock_decision.md) — the courier half:
//     `RestockRequestListFilter.shipment_id` narrows the list on the server, the page sends the picker's pick (kept in the
//     URL as `courier`), *nothing matches* is said when the courier alone empties the list, and a restock that names no
//     courier is listed only under *All couriers* (no pick asks for one without);
//   the list's date filter (the proto: "each field reads its own column … A row without that date is excluded") — Arrived
//     reads arrived_at and Lost reads lost_at; they fell to created_at before this slice.
//
// The ground, all the spec's own — a selling team of root's sending to a warehouse of root's, three restocks:
//
//   R0  JNE        raised first     → arrived after R2 was raised
//   R1  J&T        raised first     → lost after R2 was raised
//   R2  no courier raised ≥1 s later, still on its way
//
// Not pinned: Ekspor (still `dropped`, #73), the status cards + Rincian (#72), a "no courier" pick (undefined).

const SUFFIX = Date.now().toString().slice(-6);

const state = {
  team: "",
  warehouse: "",
  couriers: {} as Record<string, string>,
  r0: "",
  r1: "",
  r2: "",
  // The three restocks' own dates, as the server stamped them.
  created: {} as Record<string, number>,
  arrived0: 0,
  lost1: 0,
};

// An RPC as the signed-in person — the status and the JSON body.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body, API_URL] as const,
  );
}

// A call that must succeed — its JSON body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

const SERVICE = "inventory.v1.RestockRequestService";

// The team's restocks under `filter`, as ids, sorted.
async function listed(page: Page, filter: Record<string, unknown>) {
  const res = await ok<{ ids?: string[] }>(page, `${SERVICE}/RestockRequestList`, {
    teamId: state.team,
    filter,
    dataRequest: ["RESTOCK_REQUEST_LIST_DATA_TYPE_GENERAL"],
    page: { page: 1, limit: 50 },
  });

  return [...(res.ids ?? [])].sort();
}

const ids = (...rs: string[]) => [...rs].sort();

// Root on the team's restock list — `query` is the URL's own filters.
async function openList(page: Page, query = "") {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), state.team);
  await page.goto(`/inventories/restock${query}`);
  await expect(page.getByTestId("restock-selling-page")).toBeVisible();
}

const row = (page: Page, id: string) => page.getByTestId(`restock-row-${id}`);

/** Exactly these of the three are on the list. */
async function expectRows(page: Page, shown: string[]) {
  for (const id of [state.r0, state.r1, state.r2]) {
    if (shown.includes(id)) {
      await expect(row(page, id)).toBeVisible();
    } else {
      await expect(row(page, id)).toHaveCount(0);
    }
  }
}

// Pick a courier in the list's filter, once the catalogue has landed.
async function pickCourier(page: Page, code: string) {
  const field = page.getByTestId("restock-courier-filter");
  const option = page.getByTestId(`shipment-channel-option-${code}`);
  await listLanded(option);
  await field.getByRole("combobox").click();
  await option.click();
}

test.describe.configure({ mode: "serial" });

test("Setup: three restocks — JNE arrived, J&T lost, one with no courier still on its way", async ({ page }) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  state.team = await team(`E2E Courier Seller ${SUFFIX}`, `RCS${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.warehouse = await team(`E2E Courier WH ${SUFFIX}`, `RCW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

  // The seeded couriers' ids, by code.
  const channels = await ok<{ items: { channel?: { mapData: Record<string, { code: string }> } }[] }>(
    page,
    "shipment.v1.ShipmentChannelService/ShipmentChannelList",
    { dataRequest: ["SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL"], page: { page: 1, limit: 100 } },
  );
  const map = channels.items.find((item) => item.channel)?.channel?.mapData ?? {};
  for (const [id, channel] of Object.entries(map)) state.couriers[channel.code] = id;
  expect(state.couriers.jne && state.couriers.jnt && state.couriers.sicepat).toBeTruthy();

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Courier ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.team,
      productCodePart: `RCP${SUFFIX}`,
      name: `E2E Courier Kaos ${SUFFIX}`,
      categoryId: category,
    })
  ).product;

  const account = String(
    (
      await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: state.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E courier restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-RC-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.team,
    accountId: account,
    operational: true,
  });

  const raise = async (n: number, courier?: string) =>
    String(
      (
        await ok(page, `${SERVICE}/RestockRequestCreate`, {
          teamId: state.team,
          warehouseId: state.warehouse,
          financeAccountId: account,
          receipt: `E2E-RC-${n}-${SUFFIX}`,
          ...(courier ? { shipmentId: state.couriers[courier] } : {}),
          items: [{ productId: product.id, productCode: product.productCode, name: product.name, count: 2, total: 20_000 }],
        })
      ).request.id,
    );

  state.r0 = await raise(0, "jne");
  state.r1 = await raise(1, "jnt");
  // A later second for R2's raise, so a range can start after R0 and R1 were raised.
  await page.waitForTimeout(1_500);
  state.r2 = await raise(2);

  await ok(page, `${SERVICE}/RestockRequestArrive`, { teamId: state.warehouse, requestId: state.r0 });
  await ok(page, `${SERVICE}/RestockRequestMarkLost`, { teamId: state.team, requestId: state.r1, description: "hilang di jalan" });

  const detail = async (id: string) =>
    (await ok(page, `${SERVICE}/RestockRequestDetail`, { teamId: state.team, requestId: id })).request;
  for (const id of [state.r0, state.r1, state.r2]) {
    const r = await detail(id);
    state.created[id] = Number(r.createdAtUnix);
    if (id === state.r0) state.arrived0 = Number(r.arrivedAtUnix);
    if (id === state.r1) state.lost1 = Number(r.lostAtUnix);
  }
  expect(state.created[state.r2]).toBeGreaterThan(state.created[state.r1]!);
  expect(state.arrived0).toBeGreaterThanOrEqual(state.created[state.r2]!);
  expect(state.lost1).toBeGreaterThanOrEqual(state.created[state.r2]!);
});

test("Courier: JNE keeps JNE's restock, J&T its own, SiCepat says nothing matches — and All couriers brings back the one with none", async ({
  page,
}) => {
  await openList(page);
  await expectRows(page, [state.r0, state.r1, state.r2]);

  const jne = page.waitForRequest(
    (r) => r.url().includes("RestockRequestService/RestockRequestList") && (r.postData() ?? "").includes(`"shipmentId":"${state.couriers.jne}"`),
  );
  await pickCourier(page, "jne");
  await jne;
  await expectRows(page, [state.r0]);
  await expect(page).toHaveURL(new RegExp(`courier=${state.couriers.jne}(&|$)`));

  await pickCourier(page, "jnt");
  await expectRows(page, [state.r1]);
  await expect(page).toHaveURL(new RegExp(`courier=${state.couriers.jnt}(&|$)`));

  // A courier none of them came by: the empty state says nothing matches, and offers to clear the filters.
  await pickCourier(page, "sicepat");
  await expect(page.getByTestId("restock-requests-empty")).toBeVisible();
  await expect(page.getByTestId("restock-requests-empty")).toContainText("No restocks match.");
  await expectRows(page, []);

  // Cleared back to every courier: all three again, the one that names no courier included.
  await page.getByTestId("restock-courier-filter").locator('[data-part="clear-trigger"]').click();
  await expectRows(page, [state.r0, state.r1, state.r2]);
  await expect(page).not.toHaveURL(/courier=/);

  // The pick lives in the URL: opened with it, the list is already narrowed.
  await page.goto(`/inventories/restock?courier=${state.couriers.jnt}`);
  await expectRows(page, [state.r1]);
  await expect(page.getByTestId("not-implemented-courier")).toHaveCount(0);
});

test("Date: Arrived lists only the restock that arrived, Lost only the lost one — a restock raised today is not under either", async ({
  page,
}) => {
  // The last 7 days, by each date in turn (4 = Arrived, 5 = Lost, 1 = Created).
  await openList(page, "?date=4&range=7d");
  await expectRows(page, [state.r0]);

  await page.goto("/inventories/restock?date=5&range=7d");
  await expectRows(page, [state.r1]);

  await page.goto("/inventories/restock?date=1&range=7d");
  await expectRows(page, [state.r0, state.r1, state.r2]);
});

test("API: each date reads its own column — raised in the range but arrived after it is out; the courier narrows the same set", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const ARRIVED = "RESTOCK_DATE_FIELD_ARRIVED";
  const LOST = "RESTOCK_DATE_FIELD_LOST";
  const CREATED = "RESTOCK_DATE_FIELD_CREATED";

  // From R2's raise on: R0 arrived and R1 was lost in it, though both were raised before it.
  const later = { fromUnix: String(state.created[state.r2]), toUnix: String(Math.floor(Date.now() / 1000) + 60) };
  expect(await listed(page, { dateField: ARRIVED, ...later })).toEqual(ids(state.r0));
  expect(await listed(page, { dateField: LOST, ...later })).toEqual(ids(state.r1));
  expect(await listed(page, { dateField: CREATED, ...later })).toEqual(ids(state.r2));

  // Up to the second after R1's raise: R0 and R1 were raised in it, but neither arrived nor was lost in it. The bound is
  // R1's own second + 1 — a whole second, as the filter compares (`<= to`) against the exact moment and createdAtUnix
  // drops the fraction; R2 was raised ≥1.5 s after R1, so it is past it. (R2's second − 1 was wrong: with R0 and R1 raised
  // in one second and R2 1.5 s later in the next-but-one, it excluded all three — red once on the 20:01 run.)
  const earlier = { fromUnix: String(state.created[state.r0]! - 60), toUnix: String(state.created[state.r1]! + 1) };
  expect(state.created[state.r2]!).toBeGreaterThanOrEqual(state.created[state.r1]! + 1);
  expect(await listed(page, { dateField: CREATED, ...earlier })).toEqual(ids(state.r0, state.r1));
  expect(await listed(page, { dateField: ARRIVED, ...earlier })).toEqual([]);
  expect(await listed(page, { dateField: LOST, ...earlier })).toEqual([]);

  // The courier: its own restock alone; 0 is any courier — the one that names none only there.
  expect(await listed(page, { shipmentId: state.couriers.jne })).toEqual(ids(state.r0));
  expect(await listed(page, { shipmentId: state.couriers.jnt })).toEqual(ids(state.r1));
  expect(await listed(page, { shipmentId: state.couriers.sicepat })).toEqual([]);
  expect(await listed(page, {})).toEqual(ids(state.r0, state.r1, state.r2));
  // With a date: J&T's restock under Lost, none of JNE's.
  expect(await listed(page, { shipmentId: state.couriers.jnt, dateField: LOST, ...later })).toEqual(ids(state.r1));
  expect(await listed(page, { shipmentId: state.couriers.jne, dateField: LOST, ...later })).toEqual([]);
});

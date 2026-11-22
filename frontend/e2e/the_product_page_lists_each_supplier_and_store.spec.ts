import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { pickTeam } from "./pickers";

// THE PEMASOK TAB IS REAL (#112, InventoryService.ProductSupplierGoods), END TO END on the real server and Postgres —
// docs/technical/frontend/products_decision.md:
//
//   the-suppliers-are-a-tab-of-their-own — Pemasok is a tab of the Per Gudang card, unmarked;
//   the-supplier-tab-names-the-store — one row per supplier AND the store it was bought at: the supplier (opening its
//     discover detail; a deleted one badged and opening nothing), the store (its link opening the store, its
//     marketplace, a deleted one badged), Kiriman, Unit, Kiriman terakhir — and *Modal terakhir* on the OWNER's page
//     only: the server sends no cost to another team at all;
//   a-line-with-no-store-links-under-the-supplier (docs/business/supplier/context_decision.md) — a line naming the
//     supplier and no store is its own row, the store read as —;
//   the-warehouse-picker-splits-the-page — the tab reads the picker's warehouse: only the deliveries received there;
//   the-discover-detail-has-the-warehouse-zone — the discover detail's Pemasok tab is the same, without the last cost,
//     even on the team's own product;
//   each-figure-is-read-at-the-accept (docs/business/supplier/context_decision.md) — Unit is the good units ACCEPTED, a
//     received-count correction counted in; only an accepted RESTOCK is a delivery — a cancelled restock is none, and a
//     transfer-in (which carries the supplier onto the batch it mints) is none.
//
// The ground, all the spec's own (root's teams, no order placed, root's own team untouched): the OWNER, a selling team,
// keeps three suppliers — S1 with two stores (T1 on Shopee with a link, T2 on Tokopedia), S2, S3 (store T3) — and its
// product is restocked:
//   r1  Gudang A · S1/T1 · 4 at Rp 10.000, then corrected to 3 received
//   r2  Gudang A · S1/T1 · 6 at Rp 12.000 (the newer — Modal terakhir Rp 12.000, Kiriman terakhir its accept)
//   r3  Gudang B · S1/T2 · 5 at Rp 11.000, then T2 deleted
//   r4  Gudang A · S2, no store · 2 at Rp 20.000
//   r5  Gudang A · S3/T3 · 1 at Rp 30.000, then S3 deleted
//   r6  Gudang A · S1/T1 · 7 — CANCELLED before any accept
//   and 3 units transferred from A to Gudang C, accepted there — C has stock from S1's batch but no delivery.
// So, every warehouse: S1/T1 2 deliveries · 9 units · Rp 12.000; S1/T2 1 · 5 · Rp 11.000; S2/— 1 · 2 · Rp 20.000;
// S3/T3 1 · 1 · Rp 30.000. A VIEWER, a second selling team, reads the same rows with no cost.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-ys-pass-1";
// A username is lowercase letters and digits only.
const STAFF = `e2eyswawan${SUFFIX}`;
const WH = {
  A: { code: `YSA${SUFFIX}`, name: `E2E YS Gudang A ${SUFFIX}` },
  B: { code: `YSB${SUFFIX}`, name: `E2E YS Gudang B ${SUFFIX}` },
  C: { code: `YSC${SUFFIX}`, name: `E2E YS Gudang C ${SUFFIX}` },
};
const PRODUCT_NAME = `E2E YS Sabun ${SUFFIX}`;
const T1_URI = `https://shopee.co.id/e2e-ys-${SUFFIX}`;

const state = {
  owner: "",
  viewer: "",
  whA: "",
  whB: "",
  whC: "",
  rackA: "",
  rackB: "",
  rackC: "",
  product: "",
  code: "",
  account: "",
  s1: "",
  s2: "",
  s3: "",
  t1: "",
  t2: "",
  t3: "",
  // Unix seconds between r1's accept and r2's — the newer delivery's accept is at or after it.
  between: 0,
};

const names = {
  s1: `E2E YS Sumber Satu ${SUFFIX}`,
  s2: `E2E YS Sumber Dua ${SUFFIX}`,
  s3: `E2E YS Sumber Tiga ${SUFFIX}`,
  t1: `YS Satu Shopee ${SUFFIX}`,
  t2: `YS Satu Tokopedia ${SUFFIX}`,
  t3: `YS Tiga Lazada ${SUFFIX}`,
};

// An RPC as the signed-in person — the status and the JSON body.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body, API_URL] as const,
  );
}

// A seed call that must succeed — its JSON body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// One row of a ProductSupplierGoods answer, as proto3 JSON sends it: 64-bit integers as strings, a zero left out.
type Goods = {
  id: string;
  supplierId?: string;
  storeId?: string;
  deliveries?: string;
  units?: string;
  lastDeliveryUnix?: string;
  lastUnitCost?: number;
};

// The answer's rows in its own order — `ids`, each looked up in the GOODS slice.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function goodsOf(res: any): Goods[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map: Record<string, Goods> = res.items?.find((item: any) => item.goods)?.goods?.mapData ?? {};

  return ((res.ids ?? []) as string[]).map((id) => map[id] ?? { id });
}

// The row of (supplier, store) in an answer — store "0" is lines that named no store.
const pairOf = (rows: Goods[], supplier: string, store: string) =>
  rows.find((r) => (r.supplierId ?? "0") === supplier && (r.storeId ?? "0") === store);

const goodsApi = (page: Page, teamId: string, warehouseId = "0") =>
  call(page, "inventory.v1.InventoryService/ProductSupplierGoods", {
    teamId,
    filter: { productId: state.product, warehouseId },
    dataRequest: ["PRODUCT_SUPPLIER_GOODS_DATA_TYPE_GOODS"],
    page: { page: 1, limit: 20 },
  });

// The page's own ProductSupplierGoods answer for `teamId` in the warehouse lens (0 = every warehouse) — armed BEFORE the
// click that asks it.
const goodsAnswer = (page: Page, teamId: string, warehouseId = "0") =>
  page.waitForResponse((r) => {
    if (!r.url().includes("InventoryService/ProductSupplierGoods")) return false;
    const body = JSON.parse(r.request().postData() ?? "{}");

    return body.teamId === teamId && (body.filter?.warehouseId ?? "0") === warehouseId;
  });

// Root, standing in `team`, on `path`.
async function openAs(page: Page, team: string, path: string) {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  await page.goto(path);
}

const rows = (panel: Locator) => panel.locator('[data-testid^="pd-supplier-row-"]');
const rowOf = (panel: Locator, supplier: string, store: string) =>
  panel.locator(`[data-testid^="pd-supplier-row-"][data-supplier-id="${supplier}"][data-store-id="${store}"]`);
const cellOf = (row: Locator, kind: "deliveries" | "units" | "cost" | "last") =>
  row.locator(`[data-testid^="pd-supplier-${kind}-"]`);

// Kiriman terakhir as the tab writes it — every delivery here was accepted today, Jakarta time.
const TODAY = new Date().toLocaleDateString("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

// A row's Kiriman, Unit and — on the owner's page — Modal terakhir.
async function expectFigures(row: Locator, deliveries: string, units: string, cost?: RegExp) {
  await expect(row).toBeVisible();
  await expect(cellOf(row, "deliveries")).toHaveText(deliveries);
  await expect(cellOf(row, "units")).toHaveText(units);
  await expect(cellOf(row, "last")).toHaveText(TODAY);
  if (cost) {
    await expect(cellOf(row, "cost")).toHaveText(cost);
  } else {
    await expect(cellOf(row, "cost")).toHaveCount(0);
  }
}

test.describe.configure({ mode: "serial" });

test("Setup: a selling team's product restocked from three suppliers into A and B, one restock cancelled, 3 moved to C", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String(
      (
        await ok(page, "team.v1.TeamService/TeamCreate", {
          name,
          teamCode,
          type,
          ownerUserId: ROOT_USER_ID,
        })
      ).team.id,
    );

  state.owner = await team(`E2E YS Owner ${SUFFIX}`, `YSO${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.viewer = await team(`E2E YS Viewer ${SUFFIX}`, `YSV${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.whA = await team(WH.A.name, WH.A.code, "TEAM_TYPE_WAREHOUSE");
  state.whB = await team(WH.B.name, WH.B.code, "TEAM_TYPE_WAREHOUSE");
  state.whC = await team(WH.C.name, WH.C.code, "TEAM_TYPE_WAREHOUSE");

  const rack = async (teamId: string, code: string) =>
    String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId, code })).rack.id);
  state.rackA = await rack(state.whA, `ys-a-${SUFFIX}`);
  state.rackB = await rack(state.whB, `ys-b-${SUFFIX}`);
  state.rackC = await rack(state.whC, `ys-c-${SUFFIX}`);

  const category = (
    await ok(page, "category.v1.CategoryService/CategoryCreate", {
      name: `E2E YS ${SUFFIX}`,
    })
  ).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.owner,
      productCodePart: `YSP${SUFFIX}`,
      name: PRODUCT_NAME,
      categoryId: category,
      crossMarkupBps: 1000,
    })
  ).product;
  state.product = String(product.id);
  state.code = String(product.productCode);

  // The owner's suppliers and their stores.
  const supplier = async (name: string) =>
    String(
      (
        await ok(page, "supplier.v1.SupplierService/SupplierCreate", {
          teamId: state.owner,
          name,
        })
      ).supplier.id,
    );
  const store = async (supplierId: string, channelType: string, name: string, uri = "") =>
    String(
      (
        await ok(page, "supplier.v1.SupplierChannelService/SupplierChannelCreate", {
          teamId: state.owner,
          supplierId,
          channelType,
          name,
          uri,
        })
      ).channel.id,
    );
  state.s1 = await supplier(names.s1);
  state.s2 = await supplier(names.s2);
  state.s3 = await supplier(names.s3);
  state.t1 = await store(state.s1, "MARKETPLACE_SHOPEE", names.t1, T1_URI);
  state.t2 = await store(state.s1, "MARKETPLACE_TOKOPEDIA", names.t2);
  state.t3 = await store(state.s3, "MARKETPLACE_LAZADA", names.t3);

  // Restocks name an OPERATIONAL paying account (a-restock-names-its-paying-account).
  state.account = String(
    (
      await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: state.owner,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E YS restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-YS-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Jakarta",
        }),
      })
    ).account.id,
  );
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.owner,
    accountId: state.account,
    operational: true,
  });

  // A restock of `count` for `total` from `supplierId` (and its store, when named) into `warehouse`.
  const raise = async (warehouse: string, count: number, total: number, supplierId: string, storeId?: string) => {
    const created = await ok<{
      request: { id: string; items: { id: string }[] };
    }>(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: state.owner,
      warehouseId: warehouse,
      financeAccountId: state.account,
      items: [
        {
          productId: state.product,
          productCode: state.code,
          name: PRODUCT_NAME,
          count,
          total,
          supplierId,
          ...(storeId ? { supplierChannelId: storeId } : {}),
        },
      ],
    });

    return {
      id: String(created.request.id),
      item: String(created.request.items[0]!.id),
    };
  };
  // …accepted whole onto the warehouse's rack.
  const accept = async (warehouse: string, rackId: string, r: { id: string; item: string }, count: number) => {
    await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: r.id,
      lines: [
        {
          itemId: r.item,
          receivedCount: count,
          placements: [{ placementId: rackId, quantity: count }],
        },
      ],
    });
  };

  // r1: 4 accepted at A, then the count corrected to 3 (one was never there).
  const r1 = await raise(state.whA, 4, 40_000, state.s1, state.t1);
  await accept(state.whA, state.rackA, r1, 4);
  await ok(page, "inventory.v1.RestockRequestService/RestockReceivedCountCorrect", {
    teamId: state.whA,
    requestId: r1.id,
    reason: "Dihitung ulang",
    lines: [
      {
        itemId: r1.item,
        expectedReceivedCount: "4",
        receivedCount: "3",
        placementId: state.rackA,
      },
    ],
  });

  // r2, a second later: the newer delivery of the same pair.
  await page.waitForTimeout(1100);
  state.between = Math.floor(Date.now() / 1000);
  const r2 = await raise(state.whA, 6, 72_000, state.s1, state.t1);
  await accept(state.whA, state.rackA, r2, 6);

  const r3 = await raise(state.whB, 5, 55_000, state.s1, state.t2);
  await accept(state.whB, state.rackB, r3, 5);
  const r4 = await raise(state.whA, 2, 40_000, state.s2);
  await accept(state.whA, state.rackA, r4, 2);
  const r5 = await raise(state.whA, 1, 30_000, state.s3, state.t3);
  await accept(state.whA, state.rackA, r5, 1);

  // r6: raised and cancelled while ongoing — it never came.
  const r6 = await raise(state.whA, 7, 70_000, state.s1, state.t1);
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestCancel", {
    teamId: state.owner,
    requestId: r6.id,
    moneyReturned: false,
  });

  // 3 units moved from A to C, shipped and accepted there.
  const transfer = String(
    (
      await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferCreate", {
        teamId: state.owner,
        fromWarehouseId: state.whA,
        toWarehouseId: state.whC,
        lines: [{ productId: state.product, count: "3" }],
      })
    ).transfer.id,
  );
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferProcess", {
    teamId: state.whA,
    transferId: transfer,
  });
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferShip", {
    teamId: state.whA,
    transferId: transfer,
    receipt: `YST${SUFFIX}`,
  });
  const detail = await ok<{ transfer: { items: { id: string }[] } }>(
    page,
    "inventory.v1.WarehouseTransferService/WarehouseTransferDetail",
    { teamId: state.whC, transferId: transfer },
  );
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferAccept", {
    teamId: state.whC,
    transferId: transfer,
    lines: [
      {
        itemId: detail.transfer.items[0]!.id,
        arrivedCount: "3",
        placements: [{ placementId: state.rackC, quantity: "3" }],
      },
    ],
  });

  // C really holds the moved units now, in a batch of its own — what the tab must still not call a delivery.
  const inC = await ok<{
    ids?: string[];
    items?: { batch?: { mapData?: Record<string, { supplierId?: string }> } }[];
  }>(page, "inventory.v1.InventoryService/BatchList", {
    teamId: state.whC,
    filter: { productId: state.product },
    dataRequest: ["BATCH_LIST_DATA_TYPE_BATCH"],
    page: { page: 1, limit: 10 },
  });
  expect(inC.ids ?? [], "the transfer-in minted a batch at C").not.toHaveLength(0);
  // …carrying the supplier of the batch it left A from (a-batch-keeps-its-supplier): a supplier the tab could count.
  const cBatches = Object.values(inC.items?.find((item) => item.batch)?.batch?.mapData ?? {});
  expect(cBatches).not.toHaveLength(0);
  expect(cBatches.map((b) => b.supplierId ?? "0").every((id) => [state.s1, state.s2, state.s3].includes(id))).toBe(
    true,
  );

  // T2 and S3 deleted after their deliveries — soft deletes, so the rows keep their names.
  await ok(page, "supplier.v1.SupplierChannelService/SupplierChannelDelete", {
    teamId: state.owner,
    channelId: state.t2,
  });
  await ok(page, "supplier.v1.SupplierService/SupplierDelete", {
    teamId: state.owner,
    supplierId: state.s3,
  });

  // Wawan, staff of Gudang A — a warehouse has no product page.
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.whA,
    username: STAFF,
    password: PASSWORD,
    name: `Wawan YS ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });
});

test("Owner's page: Pemasok lists each supplier × store — Kiriman, Unit, Modal terakhir, Kiriman terakhir — the names badged", async ({
  page,
}) => {
  await openAs(page, state.owner, `/products/${state.product}`);
  await expect(page.getByTestId("product-detail-page")).toBeVisible();

  const answered = goodsAnswer(page, state.owner);
  await page.getByTestId("pd-tab-suppliers").click();
  const answer = await (await answered).json();
  const panel = page.getByTestId("pd-panel-suppliers");

  await test.step("regression: the-suppliers-are-a-tab-of-their-own — a real tab, no unimplemented mark or sample", async () => {
    await expect(panel.getByTestId("pd-suppliers-table")).toBeVisible();
    await expect(page.getByTestId("not-implemented-suppliers")).toHaveCount(0);
    await expect(page.getByTestId("pending-row-suppliers")).toHaveCount(0);
  });

  await test.step("regression: the-supplier-tab-names-the-store — one row per supplier and the store it was bought at", async () => {
    await expect(rows(panel)).toHaveCount(4);
    await expect(rowOf(panel, state.s1, state.t1)).toHaveCount(1);
    await expect(rowOf(panel, state.s1, state.t2)).toHaveCount(1);
    await expect(rowOf(panel, state.s2, "0")).toHaveCount(1);
    await expect(rowOf(panel, state.s3, state.t3)).toHaveCount(1);
    // No pager while page 1 holds them all.
    await expect(panel.getByTestId("pd-suppliers-pager")).toHaveCount(0);
  });

  await test.step("regression: each-figure-is-read-at-the-accept — 2 deliveries, the corrected 3 + 6 units, the newer's Rp 12.000", async () => {
    // The cancelled 7 never came: still 2 deliveries, not 3 — and C's transfer-in adds none.
    await expectFigures(rowOf(panel, state.s1, state.t1), "2", "9 pcs", /^Rp\s?12\.000$/);
    await expectFigures(rowOf(panel, state.s1, state.t2), "1", "5 pcs", /^Rp\s?11\.000$/);
    await expectFigures(rowOf(panel, state.s2, "0"), "1", "2 pcs", /^Rp\s?20\.000$/);
    await expectFigures(rowOf(panel, state.s3, state.t3), "1", "1 pcs", /^Rp\s?30\.000$/);
    await expect(panel.getByRole("columnheader", { name: "Last cost" })).toBeVisible();
  });

  await test.step("regression: Modal terakhir on the owner's page — the owner's answer carries every row's last cost", async () => {
    const got = goodsOf(answer);
    expect(got).toHaveLength(4);
    for (const r of got) expect(r.lastUnitCost, `row ${r.supplierId}/${r.storeId ?? 0}`).toEqual(expect.any(Number));
    expect(pairOf(got, state.s1, state.t1)?.lastUnitCost).toBe(12_000);
  });

  await test.step("regression: the supplier opens its discover detail; a deleted supplier is named, badged and opens nothing", async () => {
    const s1 = rowOf(panel, state.s1, state.t1);
    await expect(s1.getByTestId(`supplier-open-${state.s1}`)).toHaveText(names.s1);
    await expect(s1.getByTestId(`supplier-open-${state.s1}`)).toHaveAttribute(
      "href",
      `/inventories/suppliers/discover/${state.s1}`,
    );
    await expect(s1).toContainText(`E2E YS Owner ${SUFFIX}`);

    const s3 = rowOf(panel, state.s3, state.t3);
    await expect(s3.getByTestId(`supplier-name-${state.s3}`)).toHaveText(names.s3);
    await expect(s3.getByTestId("deleted-badge")).toHaveCount(1);
    await expect(page.getByTestId(`supplier-open-${state.s3}`)).toHaveCount(0);
  });

  await test.step("regression: the store's name opens its link in a new tab, its marketplace under it; a deleted store is badged", async () => {
    const t1 = rowOf(panel, state.s1, state.t1).getByTestId(`supplier-store-${state.t1}`);
    await expect(t1.getByTestId(`supplier-store-link-${state.t1}`)).toHaveAttribute("href", T1_URI);
    await expect(t1.getByTestId(`supplier-store-link-${state.t1}`)).toHaveAttribute("target", "_blank");
    await expect(t1.getByTestId(`supplier-store-link-${state.t1}`)).toHaveText(names.t1);
    await expect(t1).toContainText("Shopee");

    // T2 has no link — plain text — and was deleted: still named, badged.
    const t2 = rowOf(panel, state.s1, state.t2).getByTestId(`supplier-store-${state.t2}`);
    await expect(t2).toContainText(names.t2);
    await expect(t2).toContainText("Tokopedia");
    await expect(t2.getByTestId(`supplier-store-link-${state.t2}`)).toHaveCount(0);
    await expect(t2.getByTestId("deleted-badge")).toHaveCount(1);
  });

  await test.step("regression: a-line-with-no-store-links-under-the-supplier — S2's line with no store reads —", async () => {
    const s2 = rowOf(panel, state.s2, "0");
    await expect(s2.getByTestId(`supplier-store-none-${state.s2}`)).toHaveText("—");
    await expect(s2.getByTestId(`supplier-open-${state.s2}`)).toHaveText(names.s2);
  });
});

test("Owner's page: the warehouse picker narrows Pemasok to what was received there — C's transfer-in is no delivery", async ({
  page,
}) => {
  await openAs(page, state.owner, `/products/${state.product}`);
  await expect(page.getByTestId("product-detail-page")).toBeVisible();
  await page.getByTestId("pd-tab-suppliers").click();
  const panel = page.getByTestId("pd-panel-suppliers");
  await expect(rows(panel)).toHaveCount(4);
  const picker = page.getByTestId("pd-warehouse-filter");

  await test.step("regression: the-warehouse-picker-splits-the-page — Gudang A: its three pairs, B's store left out", async () => {
    const answered = goodsAnswer(page, state.owner, state.whA);
    await pickTeam(page, picker, WH.A.code);
    expect(goodsOf(await (await answered).json())).toHaveLength(3);

    await expect(rows(panel)).toHaveCount(3);
    await expect(rowOf(panel, state.s1, state.t2)).toHaveCount(0);
    // A's figures are what A received — the 3 moved on to C are still part of the deliveries A accepted.
    await expectFigures(rowOf(panel, state.s1, state.t1), "2", "9 pcs", /^Rp\s?12\.000$/);
    await expectFigures(rowOf(panel, state.s2, "0"), "1", "2 pcs", /^Rp\s?20\.000$/);
    await expectFigures(rowOf(panel, state.s3, state.t3), "1", "1 pcs", /^Rp\s?30\.000$/);
  });

  await test.step("regression: Gudang B — S1's Tokopedia store alone", async () => {
    const answered = goodsAnswer(page, state.owner, state.whB);
    await pickTeam(page, picker, WH.B.code);
    expect(goodsOf(await (await answered).json())).toHaveLength(1);

    await expect(rows(panel)).toHaveCount(1);
    await expectFigures(rowOf(panel, state.s1, state.t2), "1", "5 pcs", /^Rp\s?11\.000$/);
  });

  await test.step("regression: a transfer-in is no delivery — Gudang C holds S1's moved units and its Pemasok is empty", async () => {
    const answered = goodsAnswer(page, state.owner, state.whC);
    await pickTeam(page, picker, WH.C.code);
    expect(goodsOf(await (await answered).json())).toHaveLength(0);

    await expect(panel.getByTestId("pd-suppliers-empty")).toBeVisible();
    await expect(rows(panel)).toHaveCount(0);
  });
});

test("Another team's discover detail: Pemasok lists the owner's rows with their units — no cost on screen, none on the wire", async ({
  page,
}) => {
  await openAs(page, state.viewer, `/products/discover/${state.product}`);
  await expect(page.getByTestId("discover-detail-page")).toBeVisible();

  const answered = goodsAnswer(page, state.viewer);
  await page.getByTestId("dd-tab-suppliers").click();
  const answer = await (await answered).json();
  const panel = page.getByTestId("dd-panel-suppliers");

  await test.step("regression: the-discover-detail-has-the-warehouse-zone — the same four rows, Kiriman and Unit shown", async () => {
    await expect(rows(panel)).toHaveCount(4);
    await expectFigures(rowOf(panel, state.s1, state.t1), "2", "9 pcs");
    await expectFigures(rowOf(panel, state.s1, state.t2), "1", "5 pcs");
    await expectFigures(rowOf(panel, state.s2, "0"), "1", "2 pcs");
    await expectFigures(rowOf(panel, state.s3, state.t3), "1", "1 pcs");
    await expect(page.getByTestId("not-implemented-suppliers")).toHaveCount(0);
    // Another team's supplier opens for this team too; the owner's team is named under it.
    await expect(rowOf(panel, state.s1, state.t1).getByTestId(`supplier-open-${state.s1}`)).toBeVisible();
    await expect(rowOf(panel, state.s1, state.t1)).toContainText(`E2E YS Owner ${SUFFIX}`);
  });

  await test.step("regression: the-supplier-tab-names-the-store — no Modal terakhir cell, column or Rupiah for another team", async () => {
    await expect(panel.locator('[data-testid^="pd-supplier-cost-"]')).toHaveCount(0);
    await expect(panel.getByRole("columnheader", { name: "Last cost" })).toHaveCount(0);
    await expect(panel).not.toContainText("Rp");
  });

  await test.step("regression: another team's ProductSupplierGoods answer carries no cost field at all", async () => {
    const got = goodsOf(answer);
    expect(got).toHaveLength(4);
    for (const r of got) expect(Object.keys(r), `row ${r.supplierId}/${r.storeId ?? 0}`).not.toContain("lastUnitCost");
    expect(JSON.stringify(answer)).not.toContain("lastUnitCost");
  });

  await test.step("regression: the discover detail's picker narrows it too — Gudang B: S1's Tokopedia store, still no cost", async () => {
    const inB = goodsAnswer(page, state.viewer, state.whB);
    await pickTeam(page, page.getByTestId("dd-warehouse-filter"), WH.B.code);
    const body = await (await inB).json();
    expect(goodsOf(body)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("lastUnitCost");

    await expect(rows(panel)).toHaveCount(1);
    await expectFigures(rowOf(panel, state.s1, state.t2), "1", "5 pcs");
  });
});

test("Own discover detail: the owner's own product shows no cost on its discover detail either", async ({ page }) => {
  await openAs(page, state.owner, `/products/discover/${state.product}`);
  await expect(page.getByTestId("discover-detail-page")).toBeVisible();

  const answered = goodsAnswer(page, state.owner);
  await page.getByTestId("dd-tab-suppliers").click();
  await answered;
  const panel = page.getByTestId("dd-panel-suppliers");

  await test.step("regression: the-discover-detail-has-the-warehouse-zone — Pemasok without the last cost, even for its owner", async () => {
    await expect(rows(panel)).toHaveCount(4);
    await expectFigures(rowOf(panel, state.s1, state.t1), "2", "9 pcs");
    await expect(panel.locator('[data-testid^="pd-supplier-cost-"]')).toHaveCount(0);
    await expect(panel.getByRole("columnheader", { name: "Last cost" })).toHaveCount(0);
    await expect(panel).not.toContainText("Rp");
  });
});

test("API: ProductSupplierGoods — the owner's rows and last cost; another team the same rows with no cost", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const mine = await goodsApi(page, state.owner);
  expect(mine.status, JSON.stringify(mine.body)).toBe(200);
  const own = goodsOf(mine.body);

  await test.step("regression: each-figure-is-read-at-the-accept — Kiriman, Unit and the newer delivery's accept and cost", async () => {
    expect(own).toHaveLength(4);
    expect(mine.body.pageInfo?.totalItems).toBe("4");

    const t1 = pairOf(own, state.s1, state.t1)!;
    expect(t1.deliveries).toBe("2");
    expect(t1.units).toBe("9");
    expect(t1.lastUnitCost).toBe(12_000);
    // Kiriman terakhir is r2's accept, not r1's.
    expect(Number(t1.lastDeliveryUnix)).toBeGreaterThanOrEqual(state.between);

    const t2 = pairOf(own, state.s1, state.t2)!;
    expect([t2.deliveries, t2.units, t2.lastUnitCost]).toEqual(["1", "5", 11_000]);
    const none = pairOf(own, state.s2, "0")!;
    expect([none.deliveries, none.units, none.lastUnitCost]).toEqual(["1", "2", 20_000]);
    const t3 = pairOf(own, state.s3, state.t3)!;
    expect([t3.deliveries, t3.units, t3.lastUnitCost]).toEqual(["1", "1", 30_000]);
  });

  await test.step("regression: another team reads the owner's same rows — and never the cost", async () => {
    const theirs = await goodsApi(page, state.viewer);
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(200);
    const got = goodsOf(theirs.body);

    const strip = ({ lastUnitCost: _cost, ...rest }: Goods) => rest;
    expect(got).toEqual(own.map(strip));
    for (const r of got) expect(Object.keys(r)).not.toContain("lastUnitCost");
  });

  await test.step("regression: the warehouse filter — A three pairs, B one, C (a transfer-in only) none", async () => {
    for (const [warehouse, count] of [
      [state.whA, 3],
      [state.whB, 1],
      [state.whC, 0],
    ] as const) {
      const res = await goodsApi(page, state.viewer, warehouse);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(goodsOf(res.body), `warehouse ${warehouse}`).toHaveLength(count);
    }
  });
});

test("API: a warehouse role is refused ProductSupplierGoods — a warehouse has no product page", async ({ page }) => {
  await signIn(page, STAFF, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), state.whA);

  await test.step("regression: Wawan, staff of Gudang A, asks in A and is refused", async () => {
    const refused = await goodsApi(page, state.whA);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body.code).toBe("permission_denied");
  });
});

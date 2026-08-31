// The Connect transport Storybook runs against — an IN-PROCESS fake, no network, no Go server.
//
// ⚠ This module REPLACES `src/transport.ts` when Storybook (or the story test run) builds the app.
// The swap is done by stubTransportPlugin.ts, and it works because `src/transport.ts` has exactly
// ONE importer — `src/api/clients.ts`. Every one of the ~106 modules that reads a client therefore
// gets the fake without knowing it, and no component needs a Storybook-only prop or provider.
//
// Stubbing at the TRANSPORT is deliberate, rather than mocking each hook:
//
//   - the component under test runs its REAL query hook, its real adapter and its real loading and
//     error states, so a story exercises the same code path production does;
//   - the columnar list envelope (`items`/`ids`) is built here once, so a change to that contract
//     breaks the fixtures loudly instead of silently diverging from the server;
//   - a method nobody stubbed throws `unimplemented`, which surfaces in the story as a visible error
//     rather than an empty dropdown that looks like a styling bug.

import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";

import { CategoryService } from "../src/gen/warehouse/category/v1/category_pb";
import { ExpenseKind, ExpenseService } from "../src/gen/warehouse/expense/v1/expense_pb";
import { InventoryService } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { RackService } from "../src/gen/warehouse/inventory/v1/rack_pb";
import { SupplierService } from "../src/gen/warehouse/inventory/v1/supplier_pb";
import { ProductService } from "../src/gen/warehouse/product/v1/product_pb";
import { RegionService } from "../src/gen/warehouse/region/v1/region_pb";
import {
  LiabilityPaymentService,
  LiabilityService,
  LiabilitySourceType,
  LiabilityTermsService,
} from "../src/gen/warehouse/liability/v1/liability_pb";
import { OrderDraftService } from "../src/gen/warehouse/selling/v1/order_draft_pb";
import { OrderService, OrderStatus } from "../src/gen/warehouse/selling/v1/order_pb";
import { ShopService } from "../src/gen/warehouse/selling/v1/selling_pb";
import { ShippingService } from "../src/gen/warehouse/shipping/v1/shipping_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { TeamService } from "../src/gen/warehouse/team/v1/team_pb";
import { AuthService, UserService } from "../src/gen/warehouse/user/v1/user_pb";
import {
  SettlementService,
  SettlementType as WireSettlementType,
  SourceType as WireSourceType,
} from "../src/gen/warehouse/settlement/v1/settlement_pb";
import * as settlementFixtures from "../src/pages/order-settlement/fixtures";

// The prototype's string unions, back to the wire enums. Same mapping as src/features/settlement,
// kept here rather than imported so the stub never depends on app code it is meant to replace.
const stubSettlementType: Record<string, WireSettlementType> = {
  initial_total: WireSettlementType.INITIAL_TOTAL,
  initial_total_cancel: WireSettlementType.INITIAL_TOTAL_CANCEL,
  fund: WireSettlementType.FUND,
  external_ads_fee: WireSettlementType.EXTERNAL_ADS_FEE,
  affiliate_fee: WireSettlementType.AFFILIATE_FEE,
  marketplace_adjustment: WireSettlementType.MARKETPLACE_ADJUSTMENT,
  other: WireSettlementType.OTHER,
};

const stubSourceType: Record<string, WireSourceType> = {
  exporter: WireSourceType.EXPORTER,
  manual: WireSourceType.MANUAL,
  order: WireSourceType.ORDER,
};

import {
  categories,
  couriers,
  dayKey,
  expenseDays,
  orderDetailFor,
  orderDrafts,
  orders,
  productCosts,
  products,
  publicUsers,
  racks,
  regionTree,
  regions,
  liabilityDays,
  shops,
  liabilityEntries,
  liabilityPayments,
  liabilityPositions,
  liabilityTerms,
  liabilityTermsChanges,
  suppliers,
  teams,
  users,
  warehouseStock,
} from "./fixtures";

// ── The list envelope ───────────────────────────────────────────────────────────────────────────
//
// Every governed List RPC answers in the guideline's COLUMNAR shape: one slice per requested data
// type, each a map keyed by id, plus a separate `ids` array carrying the ORDER. Rebuilding it here
// (rather than returning a flat array) is what makes the adapters under features/*/adapt.ts run for
// real in a story.
type Row = { id: bigint };

function columnar<C extends string, R extends Row>(slice: C, rows: R[]) {
  const mapData: Record<string, R> = {};
  for (const row of rows) {
    mapData[row.id.toString()] = row;
  }

  return {
    items: [{ d: { case: slice, value: { mapData } } }],
    ids: rows.map((r) => r.id),
    pageInfo: { currentPage: 1, totalPage: 1, totalItems: BigInt(rows.length) },
  };
}

// The same envelope, PAGED — it honours the request's page rather than claiming one page of
// everything. A screen's pager reads `totalItems`, so a stub that always answers "1 of 1" would make
// every pagination rule untestable and, worse, make a page-turn look like it worked.
type PageReq = { page?: bigint; limit?: bigint } | undefined;

function pagedColumnar<C extends string, R extends Row>(slice: C, rows: R[], page: PageReq) {
  const limit = Number(page?.limit ?? 20n) || 20;
  const current = Number(page?.page ?? 1n) || 1;
  const window = rows.slice((current - 1) * limit, current * limit);

  const mapData: Record<string, R> = {};
  for (const row of window) {
    mapData[row.id.toString()] = row;
  }

  return {
    items: [{ d: { case: slice, value: { mapData } } }],
    ids: window.map((r) => r.id),
    pageInfo: {
      currentPage: current,
      totalPage: Math.max(1, Math.ceil(rows.length / limit)),
      // The WHOLE filtered set, not the window — that is what the pager counts.
      totalItems: BigInt(rows.length),
    },
  };
}

// The same envelope for a slice keyed by something OTHER than `id`.
//
// ⚠ The liability POSITION and TERMS slices are keyed by `counterparty_id`, and `0` is a real key
// there — the creditor's default row. So this cannot reuse `pagedColumnar`, which assumes `row.id`,
// and it must not treat a 0 key as missing.
function pagedColumnarBy<C extends string, R>(
  slice: C,
  rows: R[],
  keyOf: (row: R) => bigint,
  page: PageReq,
) {
  const limit = Number(page?.limit ?? 20n) || 20;
  const current = Number(page?.page ?? 1n) || 1;
  const window = rows.slice((current - 1) * limit, current * limit);

  const mapData: Record<string, R> = {};
  for (const row of window) {
    mapData[keyOf(row).toString()] = row;
  }

  return {
    items: [{ d: { case: slice, value: { mapData } } }],
    ids: window.map(keyOf),
    pageInfo: {
      currentPage: current,
      totalPage: Math.max(1, Math.ceil(rows.length / limit)),
      totalItems: BigInt(rows.length),
    },
  };
}

// The terms table is WRITEABLE in the stub, so a story can set a limit and see the row change — the
// whole point of the screen is the write, and echoing the request back would test the dialog without
// testing that anything landed.
//
// ⚠ MODULE STATE SURVIVES BETWEEN STORIES in one browser tab, so preview.tsx resets it in
// `beforeEach`. Without that, a story that freezes a team decides what every later story renders.
type StubTerms = (typeof liabilityTerms)[number];
let termsTable: StubTerms[] = [...liabilityTerms];

export function resetLiabilityTerms() {
  termsTable = [...liabilityTerms];
}

// ByIds answers a map of id → the same slice list, so an anti-join can look one id up directly.
function byIds<C extends string, R extends Row>(slice: C, rows: R[], wanted: bigint[]) {
  const items: Record<string, { items: { d: { case: C; value: { mapData: Record<string, R> } } }[] }> = {};

  for (const id of wanted) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue; // an unknown id is simply ABSENT — never a null row (see the adapters).

    items[id.toString()] = {
      items: [{ d: { case: slice, value: { mapData: { [id.toString()]: row } } } }],
    };
  }

  return { items };
}

// The server-side searches (`filter.q`) match on the fields a person would actually type.
const match = (q: string | undefined, ...fields: string[]) => {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle) return true;

  return fields.some((f) => f.toLowerCase().includes(needle));
};

// The one warehouse the fixtures describe. Named rather than repeated as `11n`, because stock, HPP
// and the team's default all have to agree about WHICH BUILDING they are talking about — three
// literals is three chances for them to drift apart and for a story to fail with an empty table.
const WAREHOUSE_ID = teams[0]!.id;

// ── The order list's scope and filters, shared by OrderList and OrderStat ───────────────────────
//
// ONE function for both, mirroring the server's one query builder. The stat sits directly above the
// table, so if the two narrowed differently the tab counts would describe a different population
// than the rows under them — and nothing on screen would explain the gap.
type OrderScopeFilter =
  | { search?: string; shopId?: bigint; createdFromUnix?: bigint; createdToUnix?: bigint }
  | undefined;

// Free text over the customer's NAME, their PHONE, and — only when the term is ALL DIGITS — the
// order id, matched WHOLE. Substring-matching the id would make "1" select every order, which is
// neither what the server does nor what somebody quoting an order number means.
function matchOrder(q: string | undefined, o: (typeof orders)[number]): boolean {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle) return true;

  if (/^\d+$/.test(needle) && o.id.toString() === needle) return true;

  return [o.customerName, o.customerPhone].some((f) => f.toLowerCase().includes(needle));
}

function visibleOrders(teamId: bigint, filter: OrderScopeFilter) {
  return orders
    // EITHER SIDE — see OrderList below.
    .filter((o) => o.teamId === teamId || o.warehouseId === teamId)
    .filter((o) => matchOrder(filter?.search, o))
    .filter((o) => !filter?.shopId || o.shopId === filter.shopId)
    // 0 on a side is an OPEN end, so {0,0} means every date.
    .filter((o) => !filter?.createdFromUnix || o.createdAtUnix >= filter.createdFromUnix)
    .filter((o) => !filter?.createdToUnix || o.createdAtUnix <= filter.createdToUnix)
    // Newest first, which is the order the list promises.
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

// ── The daily statement, from three services at once ────────────────────────────────────────────
//
// The statement is the one screen here that subtracts one service from another (revenue or
// liability, minus expenses), so all three Daily RPCs are stubbed together and share this period
// filter. They are the sparse series the client's date spine is built to fill.
//
// A plain string compare is the whole period test — a `yyyy-mm-dd` sorts lexically, which is why the
// contract uses it — and both ends are INCLUSIVE, as the filter says.
const inPeriod = (date: string, filter: { from?: string; to?: string } | undefined) =>
  (!filter?.from || date >= filter.from) && (!filter?.to || date <= filter.to);

// The days one team has in a series, resolved to real dates and ASCENDING — the order every Daily
// response promises, and the order the screen's running total depends on.
function periodDays<T extends { teamId: bigint; ago: number }>(
  rows: T[],
  teamId: bigint,
  filter: { from?: string; to?: string } | undefined,
) {
  return rows
    .filter((r) => r.teamId === teamId)
    .map((r) => ({ ...r, date: dayKey(r.ago) }))
    .filter((r) => inPeriod(r.date, filter))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Sum a per-key money map into an accumulator — how every by-kind / by-source total is built.
function addInto(total: Record<number, bigint>, part: Record<number, bigint>) {
  for (const [k, v] of Object.entries(part)) {
    total[Number(k)] = (total[Number(k)] ?? 0n) + v;
  }
}

const sumMap = (m: Record<number, bigint>) => Object.values(m).reduce((a, b) => a + b, 0n);

export const transport = createRouterTransport(({ service }) => {
  service(TeamService, {
    teamList: (req) =>
      columnar(
        "team",
        teams.filter(
          (t) =>
            // WHICH TEAMS CARRY THE PRIORITY-PRODUCT FEATURE. The product picker asks this first and
            // then narrows a ProductDiscover by the ids — so a stub that ignored the filter would
            // hand back every team and make the Priority tab indistinguishable from Other.
            (!req.filter?.priorityProductOnly || t.priorityProduct) &&
            match(req.filter?.q, t.name, t.teamCode),
        ),
      ),
    // ⚠ The ids live under `filter`, NOT at the top level — both ByIds RPCs read `filter.ids`, and
    // the guideline's ByIds shape is what puts them there. Reaching for `req.ids` yields `undefined`
    // and the helper throws on iterating it; that stayed invisible while no story called a ByIds.
    teamByIds: (req) => byIds("team", teams, req.filter?.ids ?? []),
    // The team's SETTINGS, which is where the order form reads its default warehouse from (#145).
    // Every fixture team names the warehouse team as its default, so the form opens pre-filled —
    // the state the page is actually in for the people using it, rather than an empty select
    // nobody ever really sees.
    teamDetail: (req) => ({
      team: {
        ...teams.find((t) => t.id === req.teamId),
        info: { teamId: req.teamId, defaultWarehouseId: WAREHOUSE_ID },
      },
    }),
  });

  service(AuthService, {
    // Only ever called when a token is present, which the `signedIn` decorator plants. Stories that
    // do not opt in never reach this.
    checkAccess: () => ({
      identity: { identityId: users[0]!.id, username: users[0]!.username, agent: "storybook" },
      token: "",
    }),
    logout: () => ({}),
  });

  service(UserService, {
    // The caller's memberships — what TeamProvider loads, and therefore what `useTeam().current`
    // resolves to. The warehouse team is first so it becomes the default selection.
    teamAccessList: () => ({
      items: [
        {
          d: {
            case: "teamAccess" as const,
            value: {
              mapData: Object.fromEntries(
                teams.map((t) => [
                  t.id.toString(),
                  {
                    teamId: t.id,
                    role: Role.WAREHOUSE_ADMIN,
                    alias: "",
                    teamName: t.name,
                    teamType: t.type,
                    imageUrl: "",
                  },
                ]),
              ),
            },
          },
        },
      ],
      ids: teams.map((t) => t.id),
      pageInfo: { currentPage: 1, totalPage: 1, totalItems: BigInt(teams.length) },
    }),
    // UserList is the TEAM-scoped search; SearchUser is the global typeahead. The two return
    // different messages (User vs the narrower PublicUser), which is exactly why UserSelect has two
    // paths — so the stub keeps them distinct rather than serving one shape for both.
    userList: (req) => columnar("user", users.filter((u) => match(req.filter?.q, u.name, u.username))),
    // THE ACTORS BEHIND A TIMELINE. `fetchActors` SWALLOWS a failure here and returns an empty map,
    // so leaving this unstubbed does not throw — it silently degrades every history to "User #61".
    // That is the one shape of broken stub this file's `unimplemented` default cannot shout about,
    // which is exactly why it is stubbed rather than left out.
    //
    // ⚠ AN UNKNOWN ID IS ABSENT, never a null row — `byIds` already enforces that, and the pages
    // depend on it: id 0 means "not recorded" and must fall through to the page's own fallback.
    userByIDs: (req) => byIds("publicUser", publicUsers, req.filter?.ids ?? []),
    searchUser: (req) => ({
      users: publicUsers.filter((u) => match(req.q, u.name, u.username)).slice(0, req.limit || 10),
    }),
  });

  service(ShopService, {
    shopList: (req) => columnar("shop", shops.filter((s) => match(req.filter?.q, s.name, s.shopCode))),
  });

  service(SupplierService, {
    supplierList: (req) => columnar("supplier", suppliers.filter((s) => match(req.filter?.q, s.name, s.code))),
  });

  service(RackService, {
    rackList: () => columnar("rack", racks),
  });

  service(CategoryService, {
    // The one full-tree read the pagination rule exempts (a picker needs every node to assemble the
    // tree), so there is no filter here — the drill-down happens in the component.
    categoryList: () => ({ categories }),
  });

  service(ShippingService, {
    shippingList: (req) => ({
      data: req.includeInactive ? couriers : couriers.filter((c) => c.active),
    }),
  });

  service(RegionService, {
    // The cascade: each level asks for its parent's children, so the empty parentCode is the top.
    regionList: (req) => ({
      regions: regionTree.filter((r) => r.parentCode === req.parentCode),
    }),
    regionSearchByKodePos: (req) => ({
      results: regions.filter((r) => r.kodePos.startsWith(req.kodePos)).slice(0, req.limit || 10),
    }),
    // Hydration: a consumer may hold a saved address as CODES ONLY, and one resolve back-fills every
    // label. Matching on the DESA code is enough for the fixtures, which is the deepest level.
    regionResolve: (req) => ({
      ancestry: regions.find((r) => r.desaCode === req.code),
    }),
  });

  service(ProductService, {
    // PAGED, because a caller genuinely walks it: OwnStockedProductPicker collects a team's whole
    // catalogue 200 ids at a time to narrow a warehouse by it, and stops on a short page. An
    // always-"1 of 1" stub would make that loop untestable.
    productList: (req) =>
      pagedColumnar(
        "product",
        products.filter((p) => p.teamId === req.teamId && match(req.filter?.q, p.name, p.sku)),
        req.page,
      ),
    // Discovery looks ACROSS teams — that is the whole difference from ProductList, so `team_id` is
    // an authorization scope here and must NOT narrow the rows, or the "all" picker would be
    // indistinguishable from the "own" one.
    //
    // Its two real narrowings do apply, because both are how AllProductPicker earns its keep:
    // `ownerTeamId` is the in-dialog team filter, `excludeOwnTeam` is the "other teams only" case.
    //
    // PAGED, for the same reason ProductList is: the picker sends `page` and reads `total_items` off
    // the answer, so a stub that always claimed "1 of 1" would hand back the whole catalogue in one
    // page — the pager would never appear, and the dialog would never be seen holding the ten rows it
    // actually holds. Discover is the RPC behind two of the three tabs, so that was the tabbed
    // picker's entire overflow behaviour going untested.
    productDiscover: (req) =>
      pagedColumnar(
        "product",
        products.filter(
          (p) =>
            (req.ownerTeamId === 0n || p.teamId === req.ownerTeamId) &&
            (!req.excludeOwnTeam || p.teamId !== req.teamId) &&
            // ⚠ THE PRIORITY PARTITION, and an EMPTY LIST IS NO NARROWING on both — exactly as the
            // server behaves. Treating empty as "match nothing" here would hide the trap the real
            // contract sets: a caller sending `owner_team_ids: []` gets the whole catalogue back, and
            // the stub has to reproduce that or the Priority tab's guard would look unnecessary.
            (req.ownerTeamIds.length === 0 || req.ownerTeamIds.includes(p.teamId)) &&
            (req.excludeOwnerTeamIds.length === 0 || !req.excludeOwnerTeamIds.includes(p.teamId)) &&
            match(req.filter?.q, p.name, p.sku),
        ),
        req.page,
      ),
    productByIds: (req) => byIds("product", products, req.filter?.ids ?? []),
  });

  service(InventoryService, {
    // What the warehouse HOLDS, paged — the catalogue the order form's picker browses. Note the
    // shape: a flat `items` array of {product_id, available}, NOT the columnar envelope the governed
    // List RPCs use. Inventory answers with the figure the list was built from, so there is no second
    // read to disagree with it.
    stockedProductList: (req) => {
      const wanted = req.filter?.productIds ?? [];
      // An EMPTY id list is "no narrowing", not "nothing matches" — the picker says the latter by
      // never calling. Getting this backwards makes the dialog open empty on first paint.
      const rows = products
        .filter((p) => (warehouseStock[p.id.toString()] ?? 0n) > 0n)
        .filter((p) => wanted.length === 0 || wanted.some((id) => id === p.id));

      const limit = Number(req.page?.limit ?? 10n) || 10;
      const page = Number(req.page?.page ?? 1n) || 1;
      const window = rows.slice((page - 1) * limit, page * limit);

      return {
        items: window.map((p) => ({ productId: p.id, available: warehouseStock[p.id.toString()]! })),
        ids: window.map((p) => p.id),
        pageInfo: {
          currentPage: page,
          totalPage: Math.max(1, Math.ceil(rows.length / limit)),
          totalItems: BigInt(rows.length),
        },
      };
    },

    // ⚠ ONE ENTRY PER PRODUCT ASKED ABOUT, including the ones with nothing. The proto is explicit
    // that this RPC does NOT use the "absent means zero" convention: a screen deciding whether it may
    // promise goods to a buyer must not have to infer a zero from a gap, because a partial answer
    // looks identical. Filtering the zeros out here would make the stub kinder than the server.
    stockAvailability: (req) => ({
      items: req.productIds.map((id) => ({
        productId: id,
        available: warehouseStock[id.toString()] ?? 0n,
      })),
    }),

    // The SELLING side's own-stock read — what this team owns at a warehouse, plus what it has on
    // order elsewhere. Two lenses over one message, so `filter.warehouseId` decides which one the
    // caller gets: set = that building's READY, 0 = every warehouse's ONGOING.
    //
    // The catalogue pickers call this twice per page (once per lens); the stocked ones never call it,
    // because their READY arrives with the list.
    ownerStockByIds: (req) => ({
      items: Object.fromEntries(
        (req.filter?.productIds ?? []).map((id) => {
          const key = id.toString();

          // ⚠ OWNERSHIP, not presence. This RPC establishes ownership through
          // `restock_requests.requesting_team_id`, so it can only answer about goods the CALLER
          // brought in — another team's product reads 0 even when the warehouse plainly holds some.
          //
          // The stub honours that rather than answering with the shelf figure, because it is the one
          // thing a picker built on this read gets wrong in a way nobody notices: "0 ready, 0 on the
          // way" on screen says "we have none" when the truth is "not mine to know".
          const mine = products.find((p) => p.id === id)?.teamId === req.teamId;
          const ready = mine && req.filter?.warehouseId ? (warehouseStock[key] ?? 0n) : 0n;

          return [
            key,
            {
              items: [
                {
                  d: {
                    case: "stock" as const,
                    value: {
                      mapData: {
                        [key]: {
                          readyQty: ready,
                          readyValue: ready * (productCosts[key] ?? 0n),
                          // A fixed ONGOING on one product, so the "already on order" figure has
                          // something to render — it is what stops the same restock being placed
                          // twice, and an all-zero fixture would never show it. Same ownership rule.
                          ongoingQty: mine && key === "72" ? 6n : 0n,
                          ongoingValueEst: 0n,
                          costMin: productCosts[key] ?? 0n,
                          costMax: productCosts[key] ?? 0n,
                          costKnown: (productCosts[key] ?? 0n) > 0n,
                          oldestBatchUnix: 0n,
                          lastRestockUnix: 0n,
                        },
                      },
                    },
                  },
                },
              ],
            },
          ];
        }),
      ),
    }),

    // The HPP per product, in the by-ids map shape: outer key is the product id, and the `cost` slice
    // repeats that id inside its own mapData — which is what features/inventory/adapt.ts reads.
    stockCost: (req) => ({
      items: Object.fromEntries(
        (req.filter?.ids ?? []).map((id) => [
          id.toString(),
          {
            items: [
              {
                d: {
                  case: "cost" as const,
                  value: {
                    mapData: {
                      // 0 = UNKNOWN, never free. Product 73 carries one on purpose.
                      [id.toString()]: { productId: id, unitCost: productCosts[id.toString()] ?? 0n },
                    },
                  },
                },
              },
            ],
          },
        ]),
      ),
    }),
  });

  service(OrderService, {
    // The write the order form exists to make. It answers with an id so the page can navigate to the
    // order it just placed — which is also what tells the unsaved-work blocker to stand down.
    orderCreate: () => ({ order: { id: 900n } }),

    // ⚠ THE TWO-SIDED READ (#151), and it is the reason the order list has two versions at all.
    // `team_id` means "the team you hold a role in", NOT "the team whose orders you get": the handler
    // matches it against EITHER side, so a selling team sees what it placed and a warehouse sees what
    // ships from it. Stubbing this as `o.teamId === req.teamId` would make the warehouse's list a
    // permanently empty table — and empty reads as "no work today" rather than as a broken stub.
    orderList: (req) =>
      pagedColumnar(
        "order",
        visibleOrders(req.teamId, req.filter).filter(
          // UNSPECIFIED is the ABSENCE of a status filter (the "All Status" tab), never a status an
          // order can hold — so it must not be compared against one.
          (o) => !req.filter?.status || o.status === req.filter.status,
        ),
        req.page,
      ),

    // THE DETAIL READ, and it is a DIFFERENT MESSAGE from a list row — `items` and `events` are
    // populated here and nowhere else (order.proto). That is why it cannot be served by finding the
    // row in `orders` and handing it back: the whole detail page is built from the two tables a list
    // row does not carry, so a stub returning the summary would render an order with no lines and no
    // history and look, on screen, exactly like a bug in the page.
    //
    // ⚠ `team_id` IS THE TWO-SIDED SCOPE HERE TOO, not an owner check. A warehouse opens an order it
    // did not place, every day — refusing that would make the picking crew unable to read the job
    // they are picking.
    orderDetail: (req) => {
      const order = orderDetailFor(req.orderId);
      if (!order) throw new ConnectError("order not found", Code.NotFound);

      if (order.teamId !== req.teamId && order.warehouseId !== req.teamId) {
        throw new ConnectError("order not found", Code.NotFound);
      }

      return { order };
    },

    // The header above the table. Deliberately NOT narrowed by the STATUS: the counts are what you
    // read to decide which tab to open, so computing them per tab would empty the number you were
    // about to click. Every OTHER filter does apply, and that is the same rule from the other side —
    // a header counting a bigger population than the rows below it is a gap nothing on screen
    // explains.
    orderStat: (req) => {
      const rows = visibleOrders(req.teamId, req.filter);

      const counts = new Map<OrderStatus, { status: OrderStatus; count: bigint; value: bigint }>();
      for (const o of rows) {
        const row = counts.get(o.status) ?? { status: o.status, count: 0n, value: 0n };
        counts.set(o.status, { status: o.status, count: row.count + 1n, value: row.value + o.total });
      }

      // The money half: a rolling 30 days, CANCELLED excluded — a cancelled order is not a sale, and
      // counting one would let a team read revenue it never took.
      const cutoff = BigInt(Math.floor(Date.now() / 1000) - 30 * 86_400);
      const recent = rows.filter((o) => o.status !== OrderStatus.CANCELLED && o.createdAtUnix >= cutoff);

      return {
        preview: {
          orders30d: BigInt(recent.length),
          revenue30d: recent.reduce((sum, o) => sum + o.total, 0n),
        },
        // One entry per status that HAS orders; a status with none is ABSENT rather than a zero row,
        // exactly as the proto says. The page renders the gaps itself.
        byStatus: [...counts.values()],
      };
    },
  });

  service(OrderDraftService, {
    // A draft is team-scoped AND personal, and — unlike an order — it has only ONE side: it belongs
    // to the team that typed it. So this is a plain `teamId` match, and a warehouse's list is empty
    // because a warehouse never types one.
    orderDraftList: (req) =>
      pagedColumnar(
        "orderDraft",
        orderDrafts
          .filter((d) => d.teamId === req.teamId)
          .filter((d) => !req.filter?.source || d.source === req.filter.source),
        req.page,
      ),

    // Save-as-draft is TWO calls, and the stub has to honour that or the second half is untested:
    // PUSH writes the draft but IGNORES product_id on every line, then UPDATE carries the mapping.
    // So the lines come back here with `productId: 0n` — exactly as the server would return them —
    // and the page's follow-up update is what fills them in.
    orderDraftPush: (req) => ({
      created: true,
      draft: {
        id: 901n,
        items: req.items.map((item, i) => ({
          id: BigInt(910 + i),
          externalSku: item.externalSku,
          externalName: item.externalName,
          productId: 0n,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    }),
    orderDraftUpdate: (req) => ({ draft: { id: req.draftId } }),
  });

  service(LiabilityService, {
    // One row per counterparty — what each of them owes this team, which is what a credit limit is
    // read against. `unsettledOnly` is honoured because the terms screen deliberately asks for
    // EVERY pair, including the square ones: a team at zero still has a limit worth seeing.
    liabilityPositionList: (req) =>
      ({
        ...pagedColumnarBy(
          "position",
          liabilityPositions.filter((p) => !req.filter?.unsettledOnly || p.balance !== 0n),
          (p) => p.counterpartyId,
          req.page,
        ),
        awaitingConfirmation: 0,
      }),

    // The pair ledger — what the pair detail page reads.
    //
    // ⚠ `balance` is the pair's CURRENT net, not the sum of the returned window. The screen shows
    // both, and a stub deriving one from the other would hide a real difference between them.
    liabilityLogList: (req) => ({
      ...pagedColumnar(
        "entry",
        liabilityEntries.filter((e) => e.counterpartyId === req.filter?.counterpartyId),
        req.page,
      ),
      balance:
        liabilityPositions.find((p) => p.counterpartyId === req.filter?.counterpartyId)?.balance ?? 0n,
    }),

    // The WAREHOUSE half — the fees it charged, split by source so the screen can pick which of them
    // it treats as earnings. It picks ORDER_FEE alone: COD reimburses cash already handed to a
    // courier, so summing every source and calling it income counts money nobody earned.
    liabilityDaily: (req) => {
      const days = periodDays(liabilityDays, req.teamId, req.filter);
      const bySource: Record<number, bigint> = {};

      const perDay = days.map((d) => {
        // A source with nothing that day is ABSENT rather than 0 — the contract's choice, and the
        // reason every reader of these maps has to default rather than index blindly.
        const sources: Record<number, bigint> = {};
        if (d.handlingFee !== 0n) sources[LiabilitySourceType.ORDER_FEE] = d.handlingFee;
        if (d.codFee !== 0n) sources[LiabilitySourceType.INCIDENTAL_FEE] = d.codFee;

        addInto(bySource, sources);

        return {
          date: d.date,
          entries: BigInt(Object.keys(sources).length),
          net: sumMap(sources),
          bySource: sources,
        };
      });

      return { days: perDay, totals: { net: sumMap(bySource), bySource } };
    },
  });

  service(LiabilityPaymentService, {
    // Both sides' payments for one pair. `awaitingMyConfirmation` is a SERVER-side filter, so the
    // stub honours it rather than letting the screen narrow — a paginated list filtered on the
    // client reports the unfiltered total beside the wrong rows.
    liabilityPaymentList: (req) =>
      pagedColumnar(
        "payment",
        liabilityPayments.filter(
          (p) =>
            (p.payerTeamId === req.filter?.counterpartyId ||
              p.creditorTeamId === req.filter?.counterpartyId) &&
            (!req.filter?.awaitingMyConfirmation || p.status === 1),
        ),
        req.page,
      ),
  });

  service(LiabilityTermsService, {
    // ⚠ Keyed by counterparty, and the DEFAULT row's key is 0 — see pagedColumnarBy.
    liabilityTermsList: (req) =>
      pagedColumnarBy(
        "terms",
        termsTable.filter((x) => x.teamId === req.teamId),
        (x) => x.counterpartyId,
        req.page,
      ),

    // Create-or-update on (team, counterparty), as the server does.
    //
    // ⚠ `creditLimit` is carried through as `undefined` when absent, NEVER coerced to 0. That
    // coercion is the exact bug the optional field exists to prevent, and a stub that flattened it
    // would make the screen's three-way control untestable.
    liabilityTermsSet: (req) => {
      const row = {
        teamId: req.teamId,
        counterpartyId: req.counterpartyId,
        handlingFee: req.handlingFee,
        productMarkupBp: req.productMarkupBp,
        creditLimit: req.creditLimit,
        reason: req.reason,
      };

      const at = termsTable.findIndex(
        (x) => x.teamId === req.teamId && x.counterpartyId === req.counterpartyId,
      );
      if (at >= 0) termsTable[at] = row;
      else termsTable = [...termsTable, row];

      return { terms: row };
    },

    // A real delete — the only way to say "unlimited" once a limit exists.
    liabilityTermsDelete: (req) => {
      termsTable = termsTable.filter(
        (x) => !(x.teamId === req.teamId && x.counterpartyId === req.counterpartyId),
      );
      return {};
    },

    liabilityTermsHistoryList: (req) =>
      pagedColumnarBy(
        "change",
        liabilityTermsChanges.filter(
          (c) => req.filter?.counterpartyId === undefined || c.counterpartyId === req.filter.counterpartyId,
        ),
        (c) => c.id,
        req.page,
      ),
  });

  service(ExpenseService, {
    // The half BOTH modes subtract. One expense record per kind per day, so a day's total and its
    // entry count are both derived from the fixture's map and cannot disagree with each other.
    expenseDaily: (req) => {
      const wanted = req.filter?.kind ?? ExpenseKind.UNSPECIFIED;
      const byKindTotal: Record<number, bigint> = {};

      const perDay = periodDays(expenseDays, req.teamId, req.filter)
        .map((d) => {
          // UNSPECIFIED is the "any kind" filter (#170), not a kind of its own — so narrowing is
          // exactly dropping the other keys, and a day left holding nothing drops out of the series
          // rather than reporting a 0 the sparse contract says should be absent.
          const only = d.byKind[wanted];
          const byKind: Record<number, bigint> =
            wanted === ExpenseKind.UNSPECIFIED
              ? { ...d.byKind }
              : only === undefined
                ? {}
                : { [wanted]: only };

          addInto(byKindTotal, byKind);

          return {
            date: d.date,
            entries: BigInt(Object.keys(byKind).length),
            total: sumMap(byKind),
            byKind,
          };
        })
        .filter((d) => d.entries > 0n);

      return { days: perDay, totals: { total: sumMap(byKindTotal), byKind: byKindTotal } };
    },
  });

  // The MARKETPLACE payout ledger. The fixtures are the design prototype's own
  // (src/pages/order-settlement/fixtures.ts), so a story asserts against the same numbers the
  // accepted design was reviewed with.
  service(SettlementService, {
    orderSettlementDetail: (req) => {
      // ⚠ THE TWO FIXTURE SETS WERE AUTHORED INDEPENDENTLY. The settlement prototype predates this
      // contract and numbers its orders 1-6; the order fixtures use 101+. Rather than renumber either
      // (both are reviewed artefacts), order 101 — the one written out in full — is bridged to the
      // WORKED example, which is the settlement design's own headline case.
      const found =
        req.orderId === 101n
          ? settlementFixtures.worked
          : settlementFixtures.allOrders.find((o) => o.orderId === req.orderId);

      // ⚠ ABSENT IS NOT EMPTY — the real service answers NotFound for an order never settled, and
      // the tab renders "not settled yet" rather than a zeroed panel.
      if (!found) throw new ConnectError("no settlement account", Code.NotFound);

      return {
        settlement: {
          orderId: found.orderId,
          initialTotal: found.initialTotal,
          lastBalance: found.lastBalance,
          teamId: 1n,
          shopId: 1n,
        },
        entries: found.entries.map((e, i) => ({
          id: BigInt(i + 1),
          uniqueId: e.uniqueId,
          orderId: found.orderId,
          shopId: 1n,
          teamId: 1n,
          actorId: 1n,
          sourceType: stubSourceType[e.sourceType],
          settlementType: stubSettlementType[e.settlementType],
          change: e.change,
          balance: e.balance,
          occurredOn: e.occurredOn,
          postedOn: e.postedOn,
          reversesId: e.reversesId ? BigInt(e.reversesId) : 0n,
          note: e.note ?? "",
          actorName: e.actorName,
        })),
      };
    },
  });
});

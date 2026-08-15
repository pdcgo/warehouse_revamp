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

import { createRouterTransport } from "@connectrpc/connect";

import { CategoryService } from "../src/gen/warehouse/category/v1/category_pb";
import { InventoryService } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { RackService } from "../src/gen/warehouse/inventory/v1/rack_pb";
import { SupplierService } from "../src/gen/warehouse/inventory/v1/supplier_pb";
import { ProductService } from "../src/gen/warehouse/product/v1/product_pb";
import { RegionService } from "../src/gen/warehouse/region/v1/region_pb";
import { ShopService } from "../src/gen/warehouse/selling/v1/selling_pb";
import { ShippingService } from "../src/gen/warehouse/shipping/v1/shipping_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { TeamService } from "../src/gen/warehouse/team/v1/team_pb";
import { AuthService, UserService } from "../src/gen/warehouse/user/v1/user_pb";

import {
  categories,
  couriers,
  products,
  publicUsers,
  racks,
  regionTree,
  regions,
  shops,
  suppliers,
  teams,
  users,
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

export const transport = createRouterTransport(({ service }) => {
  service(TeamService, {
    teamList: (req) => columnar("team", teams.filter((t) => match(req.filter?.q, t.name, t.teamCode))),
    teamByIds: (req) => byIds("team", teams, req.ids),
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
    productList: (req) =>
      columnar("product", products.filter((p) => p.teamId === req.teamId && match(req.filter?.q, p.name, p.sku))),
    // Discovery looks ACROSS teams — that is the whole difference from ProductList, so the stub
    // must not filter by team here or the "all" scope would be indistinguishable from "team".
    productDiscover: (req) => columnar("product", products.filter((p) => match(req.filter?.q, p.name, p.sku))),
    productByIds: (req) => byIds("product", products, req.ids),
  });

  service(InventoryService, {
    stockedProductList: () => columnar("stock", []),
  });
});

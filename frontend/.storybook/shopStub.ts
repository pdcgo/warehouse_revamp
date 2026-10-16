// selling_service's shops as Storybook's stub — ShopService of warehouse.selling.v1.
//
// It plays the server's rules, because a screen must already honour them:
//   a team sees its own shops          every read and write is scoped to the request's team; another team's shop
//                                      answers NotFound, as the server's (team_id, id) lookup does.
//                                      ⚠ ONE LENIENCY, in ShopList only: a team that runs NO shop of its own (the
//                                      warehouse, the root team) is served every team's. Older order-form stories
//                                      place an order as the default warehouse team with a selling team's shop —
//                                      the stub served every shop before it was scoped — and a team with shops of
//                                      its own (every screen that manages them) is scoped exactly.
//   a delete is soft                   ShopDelete marks the row: gone from List and Detail.
//   the-primary-cs-is-a-flag-on-a-grant
//                                      the FIRST user granted a shop becomes its primary CS; removing the primary's
//                                      grant leaves the shop with none (0); Make Primary needs a grant.
//
// And the list's shape: ShopList's `q` over the name and the code, its sort by name or code, its paging — newest first
// (id DESC) when no sort is sent.
//
// WRITEABLE: a shop added in one step is on the list in the next. Module state survives between stories in one tab —
// preview.tsx calls `resetShopStub()` in its `beforeEach`.

import { Code, ConnectError } from "@connectrpc/connect";

import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";
import { CommonSortType } from "../src/gen/warehouse/common/v1/list_pb";
import { ShopRowSort } from "../src/gen/warehouse/selling/v1/selling_pb";
import { shops as shopFixtures } from "./fixtures";

interface ShopRow {
  id: bigint;
  teamId: bigint;
  name: string;
  shopCode: string;
  marketplace: Marketplace;
  description: string;
  deleted: boolean;
  primaryUserId: bigint;
}

// Who may work on each shop — the grants, in the order they were given. Melati Official has two (Ani, its primary,
// and Budi); Melati Store has NONE, so it shows "no primary CS"; Melati Grosir has Eko. The rest have none.
const GRANTS: Record<string, bigint[]> = {
  "21": [61n, 62n],
  "23": [65n],
};

let rows: ShopRow[] = [];
let grants = new Map<string, bigint[]>();

export function resetShopStub() {
  grants = new Map(Object.entries(GRANTS).map(([id, users]) => [id, [...users]]));
  rows = shopFixtures.map((s) => ({ ...s, primaryUserId: grants.get(s.id.toString())?.[0] ?? 0n }));
}

resetShopStub();

const live = (teamId: bigint) => rows.filter((r) => r.teamId === teamId && !r.deleted);

function find(teamId: bigint, shopId: bigint): ShopRow {
  const row = live(teamId).find((r) => r.id === shopId);
  if (!row) throw new ConnectError("shop not found", Code.NotFound);
  return row;
}

type PageReq = { page?: bigint; limit?: bigint } | undefined;

// The columnar envelope every guideline List answers in, paged on the "server".
function paged<R extends { id: bigint }>(slice: string, all: R[], page: PageReq) {
  const limit = Number(page?.limit ?? 20n) || 20;
  const current = Number(page?.page ?? 1n) || 1;
  const window = all.slice((current - 1) * limit, current * limit);
  const mapData: Record<string, R> = {};
  for (const row of window) mapData[row.id.toString()] = row;

  return {
    items: [{ d: { case: slice, value: { mapData } } }],
    ids: window.map((r) => r.id),
    // `currentPage` and `totalPage` are plain numbers on the wire; only `totalItems` is an int64.
    pageInfo: {
      currentPage: current,
      totalPage: Math.max(1, Math.ceil(all.length / limit)),
      totalItems: BigInt(all.length),
    },
  };
}

const matches = (q: string | undefined, ...fields: string[]) => {
  const term = (q ?? "").trim().toLowerCase();
  return term === "" || fields.some((f) => f.toLowerCase().includes(term));
};

export const shopService = {
  shopList: (req: {
    teamId: bigint;
    filter?: { q?: string };
    sort?: { sortType?: CommonSortType; s?: { case?: string; value?: unknown } };
    page?: PageReq;
  }) => {
    const by = req.sort?.s?.case === "shop" ? (req.sort.s.value as ShopRowSort) : ShopRowSort.UNSPECIFIED;
    const dir = req.sort?.sortType === CommonSortType.ASC ? 1 : -1;
    const field = (s: ShopRow) => (by === ShopRowSort.SHOP_CODE ? s.shopCode : s.name);
    const order = (a: ShopRow, b: ShopRow) =>
      by === ShopRowSort.NAME || by === ShopRowSort.SHOP_CODE
        ? field(a).localeCompare(field(b)) * dir
        : a.id > b.id
          ? -1
          : 1;

    return paged(
      "shop",
      (live(req.teamId).length > 0 ? live(req.teamId) : rows.filter((r) => !r.deleted))
        .filter((s) => matches(req.filter?.q, s.name, s.shopCode))
        .sort(order),
      req.page,
    );
  },

  shopDetail: (req: { teamId: bigint; shopId: bigint }) => ({ shop: find(req.teamId, req.shopId) }),

  shopCreate: (req: { teamId: bigint; name: string; shopCode: string; marketplace: Marketplace; description: string }) => {
    const id = rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
    const shop: ShopRow = {
      id,
      teamId: req.teamId,
      name: req.name,
      shopCode: req.shopCode,
      marketplace: req.marketplace,
      description: req.description,
      deleted: false,
      primaryUserId: 0n,
    };
    rows.push(shop);
    return { shop };
  },

  shopUpdate: (req: {
    teamId: bigint;
    shopId: bigint;
    name: string;
    shopCode: string;
    marketplace: Marketplace;
    description: string;
  }) => {
    const shop = find(req.teamId, req.shopId);
    Object.assign(shop, { name: req.name, shopCode: req.shopCode, marketplace: req.marketplace, description: req.description });
    return { shop };
  },

  shopDelete: (req: { teamId: bigint; shopId: bigint }) => {
    find(req.teamId, req.shopId).deleted = true;
    return {};
  },

  shopUserList: (req: { teamId: bigint; filter?: { shopId?: bigint }; page?: PageReq }) => {
    const shop = find(req.teamId, req.filter?.shopId ?? 0n);
    const ids = grants.get(shop.id.toString()) ?? [];
    return { items: [], ids: [...ids], pageInfo: { currentPage: 1, totalPage: 1, totalItems: BigInt(ids.length) } };
  },

  shopUserAdd: (req: { teamId: bigint; shopId: bigint; userId: bigint }) => {
    const shop = find(req.teamId, req.shopId);
    const list = grants.get(shop.id.toString()) ?? [];
    if (list.includes(req.userId)) throw new ConnectError("already granted", Code.AlreadyExists);
    grants.set(shop.id.toString(), [...list, req.userId]);
    // The first grant becomes the primary CS.
    if (shop.primaryUserId === 0n) shop.primaryUserId = req.userId;
    return {};
  },

  shopUserRemove: (req: { teamId: bigint; shopId: bigint; userId: bigint }) => {
    const shop = find(req.teamId, req.shopId);
    grants.set(
      shop.id.toString(),
      (grants.get(shop.id.toString()) ?? []).filter((id) => id !== req.userId),
    );
    // Removing the primary's grant leaves the shop with none.
    if (shop.primaryUserId === req.userId) shop.primaryUserId = 0n;
    return {};
  },

  shopUserSetPrimary: (req: { teamId: bigint; shopId: bigint; userId: bigint }) => {
    const shop = find(req.teamId, req.shopId);
    if (!(grants.get(shop.id.toString()) ?? []).includes(req.userId)) {
      throw new ConnectError("not granted", Code.FailedPrecondition);
    }
    shop.primaryUserId = req.userId;
    return { shop };
  },
};

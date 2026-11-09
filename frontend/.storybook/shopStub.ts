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
//   a shop is closed, never deleted    ShopClose / ShopReopen (a-shop-is-closed-never-deleted); ShopList's `status`
//                                      reads open by default, closed or all on asking; ShopDetail and the grant RPCs
//                                      answer a closed shop (a-closed-shop-locks-all-but-its-grants: grants and the
//                                      primary CS stay editable); ShopUpdate refuses it ("reopen the shop first");
//                                      a reopen is refused while an open shop of the team holds its code, naming it
//                                      (a-shop-code-is-unique-among-open-shops). Close and reopen are idempotent.
//   the-primary-cs-is-a-flag-on-a-grant
//                                      the FIRST user granted a shop becomes its primary CS; removing the primary's
//                                      grant leaves the shop with none (0); Make Primary needs a grant.
//
// And the list's shape: ShopList's `q` over the name and the code, its marketplace / primary CS / no-primary / writable filters, its sort by name or code, its paging — newest first
// (id DESC) when no sort is sent.
//
// WRITEABLE: a shop added in one step is on the list in the next. Module state survives between stories in one tab —
// preview.tsx calls `resetShopStub()` in its `beforeEach`.
//
// Nothing is closed until a story closes one (`closeShopForStory`, or a play that clicks Close).

import { Code, ConnectError } from "@connectrpc/connect";

import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";
import { CommonSortType } from "../src/gen/warehouse/common/v1/list_pb";
import { ShopListStatus, ShopRowSort, ShopStatus } from "../src/gen/warehouse/selling/v1/selling_pb";
import { shops as shopFixtures } from "./fixtures";

interface ShopRow {
  id: bigint;
  teamId: bigint;
  name: string;
  shopCode: string;
  marketplace: Marketplace;
  description: string;
  status: ShopStatus;
  /** When it closed, unix seconds; 0 while open. */
  closedAtUnix: bigint;
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

// WHO ShopList's `writable` answers for (a-write-needs-a-grant-or-a-manager): `null` = a manager of the team — the
// team's owner or admin, root — who writes on every shop; a user id = a CS, who writes only on the shops granted them.
// A story about the gate sets it in its own `beforeEach`; resetShopStub puts the manager back.
let writer: bigint | null = null;

export function setShopWriter(userId: bigint | null) {
  writer = userId;
}

export function resetShopStub() {
  writer = null;
  grants = new Map(Object.entries(GRANTS).map(([id, users]) => [id, [...users]]));
  rows = shopFixtures.map((s) => ({ ...s, primaryUserId: grants.get(s.id.toString())?.[0] ?? 0n }));
}

resetShopStub();

// A team's shops, OPEN OR CLOSED — a closed shop is still the team's (a-shop-is-closed-never-deleted).
const ofTeam = (teamId: bigint) => rows.filter((r) => r.teamId === teamId);
const isClosed = (r: ShopRow) => r.status === ShopStatus.CLOSED;
const nowUnix = () => BigInt(Math.floor(Date.now() / 1000));

function find(teamId: bigint, shopId: bigint): ShopRow {
  const row = ofTeam(teamId).find((r) => r.id === shopId);
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

type ListReq = {
  teamId: bigint;
  filter?: {
    q?: string;
    marketplace?: Marketplace;
    primaryUserId?: bigint;
    noPrimary?: boolean;
    writable?: boolean;
    status?: ShopListStatus;
  };
  sort?: { sortType?: CommonSortType; s?: { case?: string; value?: unknown } };
};

// ShopList's WHERE and ORDER BY — its `status` open by default (UNSPECIFIED), closed, or all.
function selectShops(req: ListReq): ShopRow[] {
  const f = req.filter ?? {};
  const status = f.status ?? ShopListStatus.UNSPECIFIED;
  // A person and nobody at once cannot both hold — the server answers InvalidArgument.
  if (f.noPrimary && (f.primaryUserId ?? 0n) > 0n) {
    throw new ConnectError("a shop cannot both have this primary cs and have none", Code.InvalidArgument);
  }
  const by = req.sort?.s?.case === "shop" ? (req.sort.s.value as ShopRowSort) : ShopRowSort.UNSPECIFIED;
  const dir = req.sort?.sortType === CommonSortType.ASC ? 1 : -1;
  const field = (s: ShopRow) => (by === ShopRowSort.SHOP_CODE ? s.shopCode : s.name);
  const order = (a: ShopRow, b: ShopRow) =>
    by === ShopRowSort.NAME || by === ShopRowSort.SHOP_CODE
      ? field(a).localeCompare(field(b)) * dir
      : a.id > b.id
        ? -1
        : 1;

  return (ofTeam(req.teamId).length > 0 ? ofTeam(req.teamId) : rows)
      .filter((s) =>
        status === ShopListStatus.ALL ? true : status === ShopListStatus.CLOSED ? isClosed(s) : !isClosed(s),
      )
      .filter((s) => matches(f.q, s.name, s.shopCode))
      // #16 — the marketplace, the primary CS and "no primary CS" narrow the whole set, as the server's WHERE does.
      .filter((s) => !f.marketplace || s.marketplace === f.marketplace)
      .filter((s) => !f.primaryUserId || s.primaryUserId === f.primaryUserId)
      .filter((s) => !f.noPrimary || s.primaryUserId === 0n)
      // The picker of a write: a manager writes on every shop, anyone else on the ones granted them.
      .filter((s) => !f.writable || writer === null || (grants.get(s.id.toString()) ?? []).includes(writer))
      .sort(order);
}

export const shopService = {
  shopList: (req: ListReq & { page?: PageReq }) => paged("shop", selectShops(req), req.page),

  shopDetail: (req: { teamId: bigint; shopId: bigint }) => ({ shop: find(req.teamId, req.shopId) }),

  // ACROSS TEAMS, basic fields only (the-warehouse-row-fills-from-shop-and-user-by-ids) — a warehouse's order row names
  // another team's shop. An unknown id is simply absent.
  shopByIds: (req: { filter?: { ids?: bigint[] } }) => ({
    items: Object.fromEntries(
      rows
        .filter((s) => (req.filter?.ids ?? []).includes(s.id))
        .map((s) => [
          s.id.toString(),
          {
            items: [
              {
                d: {
                  case: "basic" as const,
                  value: {
                    mapData: {
                      [s.id.toString()]: { id: s.id, teamId: s.teamId, name: s.name, marketplace: s.marketplace },
                    },
                  },
                },
              },
            ],
          },
        ]),
    ),
  }),

  shopCreate: (req: { teamId: bigint; name: string; shopCode: string; marketplace: Marketplace; description: string }) => {
    const id = rows.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
    const shop: ShopRow = {
      id,
      teamId: req.teamId,
      name: req.name,
      shopCode: req.shopCode,
      marketplace: req.marketplace,
      description: req.description,
      status: ShopStatus.OPEN,
      closedAtUnix: 0n,
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
    // A closed shop is locked until it is reopened (a-closed-shop-locks-all-but-its-grants).
    if (isClosed(shop)) throw new ConnectError("the shop is closed — reopen the shop first", Code.FailedPrecondition);
    Object.assign(shop, { name: req.name, shopCode: req.shopCode, marketplace: req.marketplace, description: req.description });
    return { shop };
  },

  // Idempotent: a closed shop is answered as it is, its date unchanged.
  shopClose: (req: { teamId: bigint; shopId: bigint }) => {
    const shop = find(req.teamId, req.shopId);
    if (!isClosed(shop)) Object.assign(shop, { status: ShopStatus.CLOSED, closedAtUnix: nowUnix() });
    return { shop };
  },

  // Idempotent; refused while an open shop of the team holds the code, naming it — the server's words.
  shopReopen: (req: { teamId: bigint; shopId: bigint }) => {
    const shop = find(req.teamId, req.shopId);
    if (!isClosed(shop)) return { shop };
    const holder = ofTeam(req.teamId).find((r) => r.id !== shop.id && !isClosed(r) && r.shopCode === shop.shopCode);
    if (holder) {
      throw new ConnectError(
        `${shop.name} cannot reopen: the open shop ${holder.name} holds the code ${shop.shopCode} — rename one, then reopen`,
        Code.FailedPrecondition,
      );
    }
    Object.assign(shop, { status: ShopStatus.OPEN, closedAtUnix: 0n });
    return { shop };
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

/** A STORY'S SETUP: shop `shopId` closed `daysAgo` days ago (a relative day, never a fixed clock hour). */
export function closeShopForStory(shopId: bigint, daysAgo = 3) {
  const row = rows.find((r) => r.id === shopId);
  if (!row) throw new Error(`no shop ${shopId} in the stub`);
  Object.assign(row, {
    status: ShopStatus.CLOSED,
    closedAtUnix: BigInt(Math.floor((Date.now() - daysAgo * 24 * 3600 * 1000) / 1000)),
  });
}

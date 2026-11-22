import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { productClient, rackClient, userClient } from "../../api/clients";
import { key, referenceQuery } from "../../api/queryClient";
import type { StockMovement } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { Rack, RackStockLine, RackSummary } from "../../gen/warehouse/inventory/v1/rack_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import type { Team } from "../../gen/warehouse/team/v1/team_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { personName } from "../../lib/users";
import type { MovementRow } from "../inventory/MovementTable";
import { useInvalidateStock } from "../inventory/queries";
import { productByIdsRowData, productsFromByIds } from "../products/adapt";
import { countCorrectionOf } from "../receivedCount/corrections";
import { teamsByIdsQuery } from "../teams/queries";
import { publicUsersByIds, userByIdsRowData } from "../users/adapt";
import {
  rackHistoryFromList,
  rackHistoryRowData,
  rackListRowData,
  rackStockFromList,
  rackStockRowData,
  racksFromList,
} from "./adapt";

// A warehouse's rack id → CODE map.
//
// Stock records WHERE it went as a rack id, and an id is unreadable: "A-01-3" is painted on the
// aisle, "7" is not. Any screen that shows a stored placement therefore needs the whole shelf list
// to translate it, which is one read rather than one per line.
//
// It lives in features/ rather than beside the racks pages because the callers are NOT rack screens:
// the restock detail resolves a delivery's put-away with it. One large page covers a warehouse's
// shelves; a warehouse with more than this many needs a different screen, not a bigger page.
const RACK_LOOKUP_SIZE = 200;

// The ONE read behind both hooks below, so a screen that shows a placement AND lets you change it
// (the accept page, the warehouse product page) fetches a warehouse's shelves once, not twice. They
// differ only in `select`, which react-query applies per-hook over a single shared cache entry.
function rackListOptions(warehouseId: bigint, enabled: boolean) {
  return {
    queryKey: key.racks(warehouseId, { lookup: true }),
    enabled: enabled && warehouseId > 0n,
    queryFn: async () => {
      // RackList scopes racks by `team_id` — a warehouse IS a team (one of type WAREHOUSE), and the
      // handler matches it against the rack's `warehouse_id`. Deleted racks are filtered server-side,
      // and the list comes back ordered by code, which is how someone walking the aisles reads it.
      const res = await rackClient.rackList({
        teamId: warehouseId,
        dataRequest: rackListRowData(),
        page: { page: 1, limit: RACK_LOOKUP_SIZE },
      });

      return racksFromList(res.items, res.ids);
    },
  };
}

// A warehouse's racks, in aisle order — what a PICKER needs (code AND name).
//
// Through react-query rather than a hand-rolled effect, and that is the point of the hook rather
// than a nicety: the effect version fetched once keyed on `warehouseId` and, on failure, set an
// error and stopped. The effect could not re-run because the warehouse had not changed, so one
// transient failure left the picker permanently empty — "Racks unavailable" with no way back but a
// reload. ShopSelect hit exactly this (#176) and this is the same fix.
export function useRacks(args: { warehouseId: bigint; enabled?: boolean }) {
  const { warehouseId, enabled = true } = args;

  return useQuery(rackListOptions(warehouseId, enabled));
}

export function useRackCodes(args: { warehouseId: bigint; enabled?: boolean }) {
  const { warehouseId, enabled = true } = args;

  return useQuery({
    ...rackListOptions(warehouseId, enabled),
    // Stock records WHERE it went as a rack id, and an id is unreadable: "A-01-3" is painted on the
    // aisle, "7" is not. Any screen that shows a stored placement needs the whole shelf list to
    // translate it, which is one read rather than one per line.
    select: (racks) => {
      const codes: Record<string, string> = {};
      for (const rack of racks) {
        codes[rack.id.toString()] = rack.code;
      }
      return codes;
    },
  });
}

// ── One rack's whole contents, and the two writes off it ────────────────────────────────────────
//
// The Move and Record Sample dialogs act on EVERYTHING on a rack, not on the page of it the Products tab
// is showing — "empty Rak A" must see the products on page 2 too. So they read the rack in one large
// page, with each product resolved by ProductByIds (the shelf holds other teams' goods, which the
// warehouse's own catalogue would silently omit). One rack holding more than this is not a rack.
const RACK_CONTENTS_SIZE = 200;

export interface RackContents {
  lines: RackStockLine[];
  // productId → product. ProductByIds answers unordered and may answer short, so a line is matched by id.
  products: Map<string, Product>;
}

/** The rack's own writes off its page — a move and a sample — keyed so a read can tell one is in flight. */
const RACK_WRITE = ["racks", "write"] as const;

// THE CONTENTS SIT STILL WHILE A RACK WRITE IS IN FLIGHT (a move or a sample — RACK_WRITE). The two dialogs that
// read them close on their write's success, and the write's invalidation runs BEFORE they close: re-read then, the
// lines would shift under the typed quantities a beat before the dialog goes, for a RackStock of 200 the page never
// shows (the rack page's after-save storm, #120). So the read is not ACTIVE while one is pending — `enabled` as a
// function, which TanStack evaluates at the invalidation itself, never a render late — and the invalidation only marks
// it stale: the next opening reads it afresh. A refused write keeps its dialog open on the error, its lines as they were.
export function useRackContents(args: { warehouseId: bigint; rackId: bigint; enabled?: boolean }) {
  const { warehouseId, rackId, enabled = true } = args;
  const client = useQueryClient();
  const readable = enabled && warehouseId > 0n && rackId > 0n;

  return useQuery({
    queryKey: key.racks(warehouseId, { contents: rackId.toString() }),
    enabled: () => readable && client.isMutating({ mutationKey: RACK_WRITE }) === 0,
    queryFn: async (): Promise<RackContents> => {
      const res = await rackClient.rackStock({
        teamId: warehouseId,
        filter: { rackId },
        dataRequest: rackStockRowData(),
        page: { page: 1, limit: RACK_CONTENTS_SIZE },
      });
      const lines = rackStockFromList(res.items, res.ids);

      const ids = [...new Set(lines.map((line) => line.productId).filter((id) => id > 0n))];
      const products = new Map<string, Product>();

      if (ids.length > 0) {
        try {
          const productRes = await productClient.productByIds({
            teamId: warehouseId,
            filter: { ids },
            dataRequest: productByIdsRowData(),
          });
          for (const product of productsFromByIds(productRes)) {
            products.set(product.id.toString(), product);
          }
        } catch {
          // A name is decoration here: the line still carries its count, and the dialog labels it unknown.
        }
      }

      return { lines, products };
    },
  });
}

// ── The rack page's reads (pages/rack-detail, backlog #120) ─────────────────────────────────────
//
// THE HEADER, THE SHELF AND THE HISTORY ARE QUERIES, so a write refreshes them by invalidation (every read goes through a
// query hook — no-global-store-every-read-is-a-query-hook). They were hand-rolled effects re-run by a `reloadKey` the
// page bumped after each write, while the write's own invalidation re-read the dialog's reads too: one move asked
// RackStock twice and ProductByIds three times (the speed audit's after-save storm, audits/frontend/rack-detail.md).
// Now the move's invalidation (useInvalidateStock → `racks`) re-reads each of the three once, in place.

// THE NAMES BEHIND A PAGE OF IDS — products and people, read to LABEL a row, never worked from — through the cache as a
// name lookup (`referenceQuery`, HARD RULE 10's one buy-out, by name), keyed by the id set. A re-read of the shelf or the
// history after a write asks only for a set it has not named in the last five minutes, so a move that leaves the shelf's
// products as they were costs no ProductByIds for it. Never cached when it fails: the lookup throws inside, the caller
// gets an empty map — every row keeps its count and its fallback label — and the next read asks again. No retry either: a
// name is decoration, and the row should not wait a second for one.
function idSet(ids: bigint[]): bigint[] {
  return [...new Set(ids.filter((id) => id > 0n))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function productsNamed(client: QueryClient, teamId: bigint, ids: bigint[]): Promise<Map<string, Product>> {
  const wanted = idSet(ids);
  // ProductByIds demands min_items:1, unique ids, each > 0 — so a duplicate or an empty set never becomes a call. Its
  // cap is 200 and a page is at most 50, so a page's ids always fit in ONE call.
  if (wanted.length === 0) return new Map();

  try {
    return await client.fetchQuery({
      queryKey: key.products(teamId, { names: wanted.join(",") }),
      ...referenceQuery,
      retry: false,
      queryFn: async () => {
        // `teamId` here is the team the CALLER holds a role in — this warehouse — not the team whose products come
        // back. That is what lets it resolve a selling team's product.
        const res = await productClient.productByIds({ teamId, filter: { ids: wanted }, dataRequest: productByIdsRowData() });

        return new Map(productsFromByIds(res).map((product) => [product.id.toString(), product]));
      },
    });
  } catch {
    return new Map();
  }
}

// The people behind a page of history rows. UserByIDs takes no team — a public user reads the same for everyone — so the
// key has none (as useActors).
async function actorsNamed(client: QueryClient, ids: bigint[]): Promise<Map<string, PublicUser>> {
  const wanted = idSet(ids);
  if (wanted.length === 0) return new Map();

  try {
    return await client.fetchQuery({
      queryKey: key.users(undefined, { names: wanted.join(",") }),
      ...referenceQuery,
      retry: false,
      queryFn: async () =>
        new Map(
          Object.entries(
            publicUsersByIds(await userClient.userByIDs({ filter: { ids: wanted }, dataRequest: userByIdsRowData() })),
          ),
        ),
    });
  } catch {
    return new Map();
  }
}

// THE PREVIOUS ROWS, KEPT ONLY FOR THE SAME RACK. A page turned, a page size or the other history chip REFINES the same
// question, so the rows on screen stay under RefreshOverlay while the next ones load (`listQuery`'s keepPreviousData,
// HARD RULE 10, backlog #45). Another rack — the address changed — is a different subject: its read is a first load
// (the skeleton), never the previous rack's rows drawn under this rack's code for a beat. features/liability's
// keepWithinPair is the same rule for a pair.
function keepWithinRack(part: "shelf" | "history", rackId: bigint) {
  return <T>(previous: T | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined): T | undefined => {
    const params = previousQuery?.queryKey[2] as Record<string, unknown> | undefined;

    return params?.[part] === rackId.toString() ? previous : undefined;
  };
}

export interface RackDetailRead {
  rack: Rack | null;
  summary: RackSummary | null;
}

// WHICH RACK IS THIS, AND THE HEADER'S FIGURES. A by-id read on the plain default — no previous data: another rack's code
// and figures under this address would read as the wrong rack having loaded (HARD RULE 10's warning). A re-read of the
// SAME rack keeps its answer on screen while it asks. Another warehouse's rack is NotFound, and so is a deleted one.
export function useRackDetail(args: { teamId: bigint | undefined; rackId: bigint }) {
  const { teamId, rackId } = args;

  return useQuery({
    queryKey: key.racks(teamId, { detail: rackId.toString() }),
    enabled: teamId !== undefined && rackId > 0n,
    queryFn: async (): Promise<RackDetailRead> => {
      const res = await rackClient.rackDetail({ teamId: teamId!, rackId });

      return { rack: res.rack ?? null, summary: res.summary ?? null };
    },
  });
}

export interface RackShelfRead {
  lines: RackStockLine[];
  /** productId → product. ProductByIds answers unordered and may answer SHORT, so rows are matched by id. */
  products: Map<string, Product>;
  totalItems: number;
}

// WHAT IS ON A RACK, ONE PAGE OF IT, PRICED — the Produk section's read (a-rack-page-is-one-page-of-sections).
//
// The two calls are SERIALISED inside ONE query function and committed together, rather than showing the lines and
// letting the names land after: "Unknown product" is a claim — that the catalogue no longer lists it — and flashing it
// down the column on every load, while the lookup is merely in flight, would assert something false. One query means the
// rows and their names arrive as one value or not at all. (A team NAME is decoration with an honest "Team #<id>"
// fallback, so that one resolves after — useShelfTeams.)
//
// The page exists because a warehouse holds OTHER TEAMS' goods: RackStock returns product ids this warehouse does not
// own, and ONLY ids — resolving them is the caller's job, via ProductByIds and NOT ProductList, which serves the
// warehouse's own catalogue and would silently omit most of the shelf. A failed lookup is swallowed (productsNamed): the
// goods are on the shelf whether or not the catalogue can be read, and every row KEEPS ITS COUNT.
export function useRackShelfPage(args: { teamId: bigint | undefined; rackId: bigint; page: number; pageSize: number }) {
  const { teamId, rackId, page, pageSize } = args;
  const client = useQueryClient();

  return useQuery({
    queryKey: key.racks(teamId, { shelf: rackId.toString(), page, pageSize }),
    enabled: teamId !== undefined && rackId > 0n,
    placeholderData: keepWithinRack("shelf", rackId),
    queryFn: async (): Promise<RackShelfRead> => {
      const res = await rackClient.rackStock({
        teamId: teamId!,
        filter: { rackId },
        dataRequest: rackStockRowData(),
        page: { page, limit: pageSize },
      });
      const lines = rackStockFromList(res.items, res.ids);

      return {
        lines,
        products: await productsNamed(client, teamId!, lines.map((line) => line.productId)),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// THE OWNING TEAM PER SHELF ROW — the Tim column and the dialogs' team names. One TeamByIds for a page's owners
// (teamsByIdsQuery, a referenceQuery name lookup), resolved AFTER the rows: it never holds them back — rows render with
// TeamItem's "Team #<id>" fallback and upgrade in place. Every name resolved is kept for the page's life, so paging back,
// or a page owned by teams already named, never drops a name back to its fallback.
export function useShelfTeams(products: Map<string, Product>): Map<string, Team> {
  const ids = useMemo(() => idSet([...products.values()].map((product) => product.teamId)), [products]);
  const query = useQuery({ ...teamsByIdsQuery(ids), enabled: ids.length > 0 });

  // Adjusted while rendering, not in an effect (React's "storing information from previous renders"): each new answer is
  // folded into the names already known — the read itself stays the query's.
  const [known, setKnown] = useState<{ from: unknown; teams: Map<string, Team> }>({ from: undefined, teams: new Map() });
  if (query.data !== undefined && query.data !== known.from) {
    const teams = new Map(known.teams);
    for (const [id, team] of Object.entries(query.data)) {
      teams.set(id, team);
    }
    setKnown({ from: query.data, teams });
  }

  return known.teams;
}

/** A history row as the ledger draws it — a received-count correction reads as one. */
export type RackHistoryRow = StockMovement & Pick<MovementRow, "countCorrection">;

export interface RackHistoryRead {
  movements: RackHistoryRow[];
  /** userId → name — WHO did it (any-warehouse-member-may-move-goods: every row names its person). */
  actorNames: Map<string, string>;
  /** productId → name — to WHAT. */
  productNames: Map<string, string>;
  totalItems: number;
}

// WHAT HAS HAPPENED TO THIS SHELF (#197) — Riwayat's read, a ledger `StockHistory` cannot serve (it demands a product id
// and answers "what happened to this product"). `kinds` narrows it to the Penempatan chip (PLACEMENT_KINDS), none = all.
// The page of rows, its people and its products' names are ONE value: committed together, and a lookup that fails falls
// back to "#id" rather than failing the rows.
export function useRackHistory(args: {
  teamId: bigint | undefined;
  rackId: bigint;
  kinds: readonly number[] | undefined;
  page: number;
  pageSize: number;
}) {
  const { teamId, rackId, page, pageSize } = args;
  const client = useQueryClient();
  // The kinds are joined for the key: a new array literal on every render must not read as a new question.
  const kinds = (args.kinds ?? []).join(",");

  return useQuery({
    queryKey: key.racks(teamId, { history: rackId.toString(), kinds, page, pageSize }),
    enabled: teamId !== undefined && rackId > 0n,
    placeholderData: keepWithinRack("history", rackId),
    queryFn: async (): Promise<RackHistoryRead> => {
      const res = await rackClient.rackHistory({
        teamId: teamId!,
        filter: { rackId, kinds: kinds === "" ? [] : kinds.split(",").map(Number) },
        dataRequest: rackHistoryRowData(),
        page: { page, limit: pageSize },
      });
      const rows = rackHistoryFromList(res.items, res.ids);

      const [actors, products] = await Promise.all([
        actorsNamed(client, rows.map((row) => row.actorUserId)),
        productsNamed(client, teamId!, rows.map((row) => row.productId)),
      ]);

      const actorNames = new Map<string, string>();
      for (const [id, user] of actors) {
        actorNames.set(id, personName(user));
      }

      const productNames = new Map<string, string>();
      for (const [id, product] of products) {
        productNames.set(id, product.name);
      }

      return {
        // A received-count correction reads as one — *Jumlah terima dikoreksi · 20 → 18*, why and who
        // (the-received-count-prototype-is-accepted).
        movements: rows.map((row) => {
          const countCorrection = countCorrectionOf(row, actors);
          return countCorrection ? { ...row, countCorrection } : row;
        }),
        actorNames,
        productNames,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// The two writes. Both go through useInvalidateStock, the cross-domain fan-out (#177), so a move made here
// is not still on the old shelf in the inventory screens — and, on the rack page, its header, shelf and history read
// again (`racks`), in place, with nothing of the page's own to bump. The invalidation is AWAITED (onSuccess returns it),
// so the dialog closes on the page already re-read; the dialog's own reads sit still while it runs (useRackContents).
export function useRackMove() {
  const invalidate = useInvalidateStock();

  return useMutation({
    mutationKey: RACK_WRITE,
    mutationFn: (vars: Parameters<typeof rackClient.rackMove>[0]) => rackClient.rackMove(vars),
    onSuccess: () => invalidate(),
  });
}

export function useRackSample() {
  const invalidate = useInvalidateStock();

  return useMutation({
    mutationKey: RACK_WRITE,
    mutationFn: (vars: Parameters<typeof rackClient.rackSample>[0]) => rackClient.rackSample(vars),
    onSuccess: () => invalidate(),
  });
}

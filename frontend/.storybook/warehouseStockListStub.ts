// THE STOCK SCREEN as Storybook's stub — InventoryService.WarehouseStockList
// (backend/services/inventory_service/inventory_v1/warehouse_stock_list.go, the-stock-screen-lists-what-the-warehouse-has-held).
//
// It plays the server's rules, and the one the RPC exists for is ENFORCED: the list is every product with a batch in THIS
// warehouse — any team's, emptied ones included — read off the SAME batch registers the warehouse picker searches
// (`heldHere`, warehouseProductSearchStub.ts), never the warehouse team's own catalogue. So Kopi Arabika (71), which
// Gudang Pusat never had a batch of, is never listed however it is searched.
//
//   who        Root, the Administrator, the warehouse Owner, Admin and Staff, and the admin team's monitor (a read) — a
//              selling role is refused as the policy refuses it.
//   the term   none lists everything held; otherwise at least 2 characters after trimming, in the name or the code,
//              case-insensitive.
//   the set    archived ones too, flagged — the screen labels them.
//   on hand    the batches' stock here, summed (opnameOnHandHere) — 0 for a product held and emptied, or held only on
//              the found register. (The server sums the racks; in a consistent ledger the two agree.)
//   the order  by name, then code, then id; paged.
//
// STATELESS but for one switch: `warehouseStockNothingHeld()` (a `beforeEach`) answers every warehouse as one that has
// held nothing; preview.tsx resets it.

import { Code, ConnectError } from "@connectrpc/connect";

import type { WarehouseStockListRequest } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { opnameOnHandHere } from "./opnameStub";
import { allProducts } from "./productStub";
import { sessionScenario } from "./sessionScenario";
import { heldHere } from "./warehouseProductSearchStub";

const READERS = new Set<Role>([
  Role.ROOT,
  Role.ADMINISTRATOR,
  Role.WAREHOUSE_OWNER,
  Role.WAREHOUSE_ADMIN,
  Role.WAREHOUSE_STAFF,
  Role.ADMIN_OWNER,
  Role.ADMIN_ADMINISTRATOR,
]);

/** `nothingHeld`: every warehouse answers as one nothing has ever been stocked in. */
export const warehouseStockScenario = { nothingHeld: false };

export function resetWarehouseStockStub() {
  warehouseStockScenario.nothingHeld = false;
}

/** A `beforeEach`: the warehouse has held nothing yet — the screen says nothing is stocked here. */
export function warehouseStockNothingHeld() {
  warehouseStockScenario.nothingHeld = true;
}

export function warehouseStockList(req: WarehouseStockListRequest) {
  if (!READERS.has(sessionScenario.role)) {
    throw new ConnectError("insufficient role", Code.PermissionDenied);
  }

  const term = (req.filter?.q ?? "").trim().toLowerCase();
  if (term !== "" && [...term].length < 2) {
    throw new ConnectError("type at least 2 characters of a product's name or code, or clear the search", Code.InvalidArgument);
  }

  const held = warehouseStockScenario.nothingHeld ? new Set<bigint>() : heldHere(req.warehouseId);
  const onHand = opnameOnHandHere(req.warehouseId);

  const rows = allProducts()
    .filter((p) => held.has(p.id))
    .filter((p) => term === "" || p.name.toLowerCase().includes(term) || p.productCode.toLowerCase().includes(term))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.productCode.localeCompare(b.productCode) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  const limit = Number(req.page?.limit ?? 20) || 20;
  const page = Number(req.page?.page ?? 1) || 1;
  const window = rows.slice((page - 1) * limit, page * limit);

  return {
    items: [
      {
        d: {
          case: "product" as const,
          value: {
            mapData: Object.fromEntries(
              window.map((p) => [
                p.id.toString(),
                { id: p.id, teamId: p.teamId, productCode: p.productCode, name: p.name, archived: p.archived },
              ]),
            ),
          },
        },
      },
      {
        d: {
          case: "stock" as const,
          value: {
            mapData: Object.fromEntries(
              window.map((p) => [
                p.id.toString(),
                { productId: p.id, warehouseId: req.warehouseId, onHand: onHand.get(p.id) ?? 0n },
              ]),
            ),
          },
        },
      },
    ],
    ids: window.map((p) => p.id),
    // `currentPage` and `totalPage` are plain numbers on the wire; only `totalItems` is an int64.
    pageInfo: { currentPage: page, totalPage: Math.max(1, Math.ceil(rows.length / limit)), totalItems: BigInt(rows.length) },
  };
}

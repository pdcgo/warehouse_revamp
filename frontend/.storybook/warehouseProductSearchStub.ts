// The WAREHOUSE'S PRODUCT PICKER as Storybook's stub — InventoryService.WarehouseProductSearch
// (backend/services/inventory_service/inventory_v1/warehouse_product_search.go, a-warehouse-picks-only-what-it-has-held).
//
// It plays the server's rules, and the one the RPC exists for is ENFORCED: only a product with a batch in THIS warehouse
// comes back — any team's, emptied ones included — read off the SAME batch registers the found and the count stubs
// refuse a never-stocked product by (foundRequestStub's, opnameStub's). So a story can never pick here what those then
// refuse: Kopi Arabika (71), which Gudang Pusat never had a batch of, is never offered however it is typed.
//
//   who        Root, the Administrator, the warehouse Owner, Admin and Staff, and the admin team's monitor (a read) — a
//              selling role is refused as the policy refuses it. Unlike most stubs this one checks: the bug this RPC
//              fixes was a picker whose policy no stub ever checked (ProductDiscover refusing warehouse roles).
//   the term   at least 2 characters after trimming, in the name or the code, case-insensitive.
//   the set    archived ones too, flagged — a warehouse is offered what it holds (an-archived-product-held-here-can-be-picked).
//   the order  by name, then code; paged.
//
// STATELESS: everything is read from the registers and the catalogue, which preview.tsx resets.

import { Code, ConnectError } from "@connectrpc/connect";

import type { WarehouseProductSearchRequest } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { foundHeldHere } from "./foundRequestStub";
import { opnameHeldHere } from "./opnameStub";
import { allProducts, analyticSamplesHeldHere } from "./productStub";
import { sessionScenario } from "./sessionScenario";

const PICKERS = new Set<Role>([
  Role.ROOT,
  Role.ADMINISTRATOR,
  Role.WAREHOUSE_OWNER,
  Role.WAREHOUSE_ADMIN,
  Role.WAREHOUSE_STAFF,
  Role.ADMIN_OWNER,
  Role.ADMIN_ADMINISTRATOR,
]);

/**
 * How many searches the stub REFUSED on the policy — the only sign a story has that the picker asked and was turned away,
 * since the picker shows "No products found" either way. A story reads it before and after; nothing resets it.
 */
export const warehouseProductSearchScenario = { refused: 0 };

/** Every product with a batch in this warehouse, at 0 or not — the set the picker searches, and nothing else. */
export function heldHere(warehouseId: bigint): Set<bigint> {
  return new Set([...foundHeldHere(warehouseId), ...opnameHeldHere(warehouseId), ...analyticSamplesHeldHere(warehouseId)]);
}

export function warehouseProductSearch(req: WarehouseProductSearchRequest) {
  if (!PICKERS.has(sessionScenario.role)) {
    warehouseProductSearchScenario.refused++;
    throw new ConnectError("insufficient role", Code.PermissionDenied);
  }

  const term = (req.filter?.q ?? "").trim().toLowerCase();
  if ([...term].length < 2) {
    throw new ConnectError("type at least 2 characters of a product's name or code", Code.InvalidArgument);
  }

  const held = heldHere(req.warehouseId);
  const rows = allProducts()
    .filter((p) => held.has(p.id))
    .filter((p) => p.name.toLowerCase().includes(term) || p.productCode.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name) || a.productCode.localeCompare(b.productCode));

  const limit = Number(req.page?.limit ?? 10) || 10;
  const page = Number(req.page?.page ?? 1) || 1;
  const window = rows.slice((page - 1) * limit, page * limit);

  return {
    items: [
      {
        d: {
          case: "product" as const,
          value: {
            mapData: Object.fromEntries(
              window.map((p) => [p.id.toString(), { id: p.id, teamId: p.teamId, productCode: p.productCode, name: p.name, archived: p.archived }]),
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

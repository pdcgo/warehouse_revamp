// CETAK ULANG KODE as Storybook's stub — InventoryService.ProductReprintList / ProductReprintRecord (backend #151:
// backend/services/inventory_service/inventory_v1/product_reprint_list.go, product_reprint_record.go;
// product_service's product_v1/product_reprint.go) and the *Cetak ulang kode (N)* count WarehouseStockList carries when
// asked (warehouseStockListStub.ts reads `reprintWaitingOf`). It plays the server's rules:
//
//   who        the read: Root, the Administrator, the warehouse Owner, Admin and Staff, and the admin team's monitor (a
//              read); the record: the same minus the monitor (PermissionDenied) — a selling role is refused both.
//   the list   the products still waiting for THIS warehouse, by live code, each with its LIVE code (productStub's row, so
//              a story that changes a code sees it), its former code, and one label per shelf spot of this warehouse.
//   the record a product printed with its live code stops waiting HERE; one printed with an older code is not cleared
//              (`code_changed_ids`); once no warehouse waits for a product, the app takes `need_reprint_code` off it in
//              the live tag stub (productTagScenario.ts `appTagOffForStory`), so the lists' chips follow. Idempotent.
//
// THE STORY IT TELLS — the accepted prototype's (accepts/141, shots 17–18, 21–22), on the fixtures' teams and Toko
// Anggrek's catalogue: Toko Anggrek (15) changed its code TA → SL-03 two days ago, so its products are SL-03-… now and
// their former codes TA-… still find them. Two of them hold stock:
//   700  SL-03-ANG-001  Minyak Goreng Sawit 2L — Satuan   Gudang Pusat A-01-1 (30), A-01-2 (24) · Gudang Cabang C-01-1 (25)
//   703  SL-03-ANG-004  Tepung Terigu Serbaguna 1kg — Karton   Gudang Pusat B-02-1 (12)
// so both carry `need_reprint_code` and wait for Gudang Pusat's reprint (3 labels on 3 shelf spots — the acceptance's
// given 3); 700 waits for Gudang Cabang's too (given 4). 702 (SL-03-ANG-003) was recomposed with nothing on a shelf
// anywhere, so it is NOT tagged (⚠4) — not on any reprint.
//
// WRITEABLE, reset per story from preview.tsx (`resetProductReprintStub`).

import { Code, ConnectError } from "@connectrpc/connect";

import type { ProductReprintListRequest, ProductReprintRecordRequest } from "../src/gen/warehouse/inventory/v1/inventory_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { allProducts } from "./productStub";
import { appTagOffForStory } from "./productTagScenario";
import { sessionScenario } from "./sessionScenario";

export const ANGGREK = 15n;
export const GUDANG_PUSAT = 11n;
export const GUDANG_CABANG = 14n;

const READERS = new Set<Role>([
  Role.ROOT,
  Role.ADMINISTRATOR,
  Role.WAREHOUSE_OWNER,
  Role.WAREHOUSE_ADMIN,
  Role.WAREHOUSE_STAFF,
  Role.ADMIN_OWNER,
  Role.ADMIN_ADMINISTRATOR,
]);
const WRITERS = new Set<Role>([Role.ROOT, Role.ADMINISTRATOR, Role.WAREHOUSE_OWNER, Role.WAREHOUSE_ADMIN, Role.WAREHOUSE_STAFF]);

interface Spot {
  placementId: bigint;
  placementCode: string;
  quantity: bigint;
}

/** One product waiting for one warehouse, with its shelf spots there. */
interface Wait {
  productId: bigint;
  formerCode: string;
  spots: Spot[];
}

/** What a story's Cetak sent — every ProductReprintRecord, in order, as the page sent it. */
export interface ReprintRecordCall {
  warehouseId: bigint;
  items: { productId: bigint; productCode: string }[];
}

export const productReprintScenario = {
  records: [] as ReprintRecordCall[],
  /** How many times the reprint list was asked, refused or not — the page reads again after each print. */
  listReads: 0,
};

function seed(): Map<string, Wait[]> {
  return new Map([
    [
      GUDANG_PUSAT.toString(),
      [
        {
          productId: 700n,
          formerCode: "TA-ANG-001",
          spots: [
            { placementId: 9101n, placementCode: "A-01-1", quantity: 30n },
            { placementId: 9102n, placementCode: "A-01-2", quantity: 24n },
          ],
        },
        { productId: 703n, formerCode: "TA-ANG-004", spots: [{ placementId: 9103n, placementCode: "B-02-1", quantity: 12n }] },
      ],
    ],
    [GUDANG_CABANG.toString(), [{ productId: 700n, formerCode: "TA-ANG-001", spots: [{ placementId: 9401n, placementCode: "C-01-1", quantity: 25n }] }]],
  ]);
}

let waits = seed();

export function resetProductReprintStub() {
  waits = seed();
  productReprintScenario.records = [];
  productReprintScenario.listReads = 0;
}

/** A `beforeEach`: nothing waits for any warehouse's reprint — the entry hides, the page says so. */
export function reprintNothingWaitsForStory() {
  waits = new Map();
}

/** How many products wait for the warehouse's reprint — WarehouseStockList's `reprint_waiting` when asked. */
export function reprintWaitingOf(warehouseId: bigint): number {
  return (waits.get(warehouseId.toString()) ?? []).length;
}

const liveOf = (productId: bigint) => allProducts().find((p) => p.id === productId);

export function productReprintList(req: ProductReprintListRequest) {
  productReprintScenario.listReads++;

  if (!READERS.has(sessionScenario.role)) {
    throw new ConnectError("insufficient role", Code.PermissionDenied);
  }

  const rows = (waits.get(req.warehouseId.toString()) ?? [])
    .map((w) => ({ wait: w, product: liveOf(w.productId) }))
    .filter((r) => r.product !== undefined)
    .sort((a, b) => a.product!.productCode.localeCompare(b.product!.productCode) || Number(a.wait.productId - b.wait.productId));

  const limit = Number(req.page?.limit ?? 200) || 200;
  const page = Number(req.page?.page ?? 1) || 1;
  const window = rows.slice((page - 1) * limit, page * limit);

  return {
    items: window.map(({ wait, product }) => ({
      productId: wait.productId,
      productCode: product!.productCode,
      name: product!.name,
      formerCode: wait.formerCode,
      labels: [...wait.spots].sort((a, b) => a.placementCode.localeCompare(b.placementCode)),
    })),
    // `currentPage` and `totalPage` are plain numbers on the wire; only `totalItems` is an int64.
    pageInfo: { currentPage: page, totalPage: Math.max(1, Math.ceil(rows.length / limit)), totalItems: BigInt(rows.length) },
  };
}

export function productReprintRecord(req: ProductReprintRecordRequest) {
  if (!WRITERS.has(sessionScenario.role)) {
    throw new ConnectError("insufficient role", Code.PermissionDenied);
  }

  productReprintScenario.records.push({
    warehouseId: req.warehouseId,
    items: req.items.map((i) => ({ productId: i.productId, productCode: i.productCode })),
  });

  const here = req.warehouseId.toString();
  const cleared: bigint[] = [];
  const codeChanged: bigint[] = [];
  const untagged: bigint[] = [];

  for (const item of req.items) {
    const live = liveOf(item.productId);
    if (!live) continue;

    if (live.productCode !== item.productCode) {
      codeChanged.push(item.productId);
      continue;
    }

    const list = waits.get(here) ?? [];
    if (list.some((w) => w.productId === item.productId)) {
      waits.set(
        here,
        list.filter((w) => w.productId !== item.productId),
      );
      cleared.push(item.productId);
    }

    const stillWaiting = [...waits.values()].some((ws) => ws.some((w) => w.productId === item.productId));
    if (!stillWaiting && cleared.includes(item.productId)) {
      appTagOffForStory(item.productId);
      untagged.push(item.productId);
    }
  }

  return { clearedIds: cleared, codeChangedIds: codeChanged, untaggedIds: untagged };
}

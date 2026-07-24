import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { productClient, rackClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";

// The rack screens' reads (#176).

export function useRacks(args: {
  teamId: bigint | undefined;
  q: string;
  page: number;
  pageSize: number;
}) {
  const { teamId, q, page, pageSize } = args;

  return useQuery({
    queryKey: key.racks(teamId, { q, page, pageSize }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await rackClient.rackList({ teamId: teamId!, q, page: { page, limit: pageSize } });

      return {
        racks: res.racks,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

export function useRack(args: { teamId: bigint | undefined; rackId: bigint }) {
  const { teamId, rackId } = args;

  return useQuery({
    queryKey: key.racks(teamId, { rackId: rackId.toString() }),
    enabled: teamId !== undefined && rackId > 0n,
    queryFn: async () => {
      const res = await rackClient.rackDetail({ teamId: teamId!, rackId });

      return res.rack ?? null;
    },
  });
}

// What is on one shelf, and what each thing IS.
//
// The two calls stay SERIALISED inside one query function and are returned together, exactly as the
// old effect committed them together. "Unknown product" is a claim — that the catalogue no longer
// lists it — and showing it down the column while the lookup is merely in flight would assert
// something false. One query means the rows and their names arrive as one value or not at all.
//
// The inner failure is still swallowed: the goods are on the shelf whether or not the catalogue can
// be read, so every row falls back to its unresolved label and KEEPS ITS COUNT, which is the number
// somebody standing at the rack came for.
export function useRackStock(args: {
  teamId: bigint | undefined;
  rackId: bigint;
  page: number;
  pageSize: number;
}) {
  const { teamId, rackId, page, pageSize } = args;

  return useQuery({
    queryKey: key.racks(teamId, { rackId: rackId.toString(), stock: true, page, pageSize }),
    enabled: teamId !== undefined && rackId > 0n,
    queryFn: async () => {
      const res = await rackClient.rackStock({
        teamId: teamId!,
        rackId,
        page: { page, limit: pageSize },
      });

      // Unique and non-zero: ProductByIds demands min_items:1, unique ids, each > 0 — so a duplicate
      // or an empty set must never become a call. The cap is 200 and a page is at most 50, so a
      // page's ids always fit in ONE call.
      const ids = [...new Set(res.lines.map((line) => line.productId).filter((id) => id > 0n))];

      const products = new Map<string, Product>();

      if (ids.length > 0) {
        try {
          // `teamId` here is the team the CALLER holds a role in — this warehouse — not the team
          // whose products come back. That is what lets it resolve a selling team's product.
          const productRes = await productClient.productByIds({ teamId: teamId!, productIds: ids });

          for (const product of productRes.products) {
            products.set(product.id.toString(), product);
          }
        } catch {
          // See the note above: names are best-effort, counts are not.
        }
      }

      return {
        lines: res.lines,
        products,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

export function useInvalidateRacks() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["racks"] });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// A mutation DECLARES WHAT IT INVALIDATES, here, beside the query it makes stale — see
// src/expenses/queries.ts for the full argument. The hook owns the CACHE, the component owns the UX
// (the toast, closing the dialog, showing the error), and `onSuccess` RETURNS the invalidation promise
// so TanStack awaits it and the dialog does not close a beat before the row appears.

// A rack write reaches INVENTORY as well as `racks`, and the reason is specific rather than "shelves
// and stock are related".
//
// It is that ProductPlace (inventory.proto) carries a DENORMALISED `rack_code` beside its rack_id, and
// two cached inventory reads return those places: useWarehouseProduct (where this product sits) and
// useProductPlaces (the Accept screen's "there are already 12 of these on B-02"). A copy of the label
// is a copy that goes stale the moment somebody renames or removes the shelf, and a put-away sent to a
// shelf that no longer carries that name is a person walking the wrong aisle.
//
// The stock FIGURES are not the reason and would not have justified this: StockLevel deliberately
// carries no rack at all (#135), and StockMovement carries a bare `rack_id`. Only the copied code does.
// The reverse direction already exists — useInvalidateStock invalidates ["racks"] because a move
// changes what a shelf holds — so this closes the pair.
//
// CREATE is included even though a brand-new shelf holds nothing anyone could already be showing: an
// invalidation that depends on which branch of the write ran is a rule the next edit has to remember,
// and an invalidation of queries that are not on screen costs nothing but a stale mark.
//
// ORDERS is deliberately NOT invalidated, though StockPickLocation carries a `rack_code` too. The pick
// screen is keyed under `orders` on purpose (see src/picking/queries.ts), so reaching it from here
// would refetch every order list and order detail in the app — none of which mention a shelf — to fix
// one column on one screen. If that column turns out to matter, the answer is a narrower key for the
// pick read rather than a wider invalidation from this side.
function useInvalidateRacksAndPlaces() {
  const client = useQueryClient();
  const invalidateRacks = useInvalidateRacks();

  return async () => {
    await Promise.all([
      invalidateRacks(),
      client.invalidateQueries({ queryKey: ["inventory"] }),
    ]);
  };
}

interface SaveRackVars {
  teamId: bigint;
  /** Set to correct an existing rack; omitted to register a new one. */
  rackId?: bigint;
  code: string;
  name: string;
  description: string;
}

// Register or correct a rack. One hook for both, because the edit form IS the registry entry
// re-opened — the same reason RackFormDialog serves both.
export function useSaveRack() {
  const invalidate = useInvalidateRacksAndPlaces();

  return useMutation({
    mutationFn: async ({ rackId, ...vars }: SaveRackVars) =>
      rackId === undefined
        ? await rackClient.rackCreate(vars)
        : await rackClient.rackUpdate({ ...vars, rackId }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteRack() {
  const invalidate = useInvalidateRacksAndPlaces();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; rackId: bigint }) => rackClient.rackDelete(vars),
    onSuccess: () => invalidate(),
  });
}

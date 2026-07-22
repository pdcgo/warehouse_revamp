import { useQuery, useQueryClient } from "@tanstack/react-query";
import { productClient, rackClient } from "../api/clients";
import { key } from "../api/queryClient";
import type { Product } from "../gen/warehouse/product/v1/product_pb";

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

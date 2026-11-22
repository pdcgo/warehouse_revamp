import { useQuery } from "@tanstack/react-query";
import { productClient } from "../../api/clients";
import { key } from "../../api/queryClient";

// The product form's read (#122) — the stored product an edit starts from, its ordered gallery included.
//
// Its OWN entry, not useProductDetail's: that one reads the category tree beside the product for the detail page,
// and the form's CategorySelect reads the tree through its own feed — sharing it would ask for the tree twice a load.
// A by-id read on the plain always-fresh default (another product is another subject). The id is parsed INSIDE the
// read, so an address that names no product is the read's error on the page, never a crash while rendering.
//
// `enabled` is a FUNCTION: the form keeps the read still while its own save runs (SAVE_PRODUCT) — the save's
// invalidation would otherwise re-read a product the form is about to leave.
export function useProductRecord(args: { teamId: bigint | undefined; productId: string | undefined; enabled: () => boolean }) {
  const { teamId, productId, enabled } = args;

  return useQuery({
    queryKey: key.products(teamId, { edit: productId ?? "" }),
    enabled: () => teamId !== undefined && productId !== undefined && enabled(),
    queryFn: async () => (await productClient.productDetail({ teamId: teamId!, productId: BigInt(productId!) })).product ?? null,
  });
}

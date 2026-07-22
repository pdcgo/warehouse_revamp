import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shippingClient } from "../api/clients";
import { key } from "../api/queryClient";
import { invalidateShippingCatalogue } from "./catalogue";

// The courier catalogue (#176).
//
// GLOBAL reference data, like categories — the couriers are the same for every team, so no team goes
// in the key.
//
// `includeInactive` IS in the key: the management screen asks for everything including retired
// couriers, while a picker asks only for the ones you can still choose. Those are two different
// answers and must not share an entry — the management screen showing the picker's cached list would
// silently hide the retired couriers it exists to manage.
export function useShippingChannels(args: { includeInactive: boolean }) {
  const { includeInactive } = args;

  return useQuery({
    queryKey: key.shipping({ includeInactive }),
    queryFn: async () => {
      const res = await shippingClient.shippingList({ includeInactive });

      return res.data;
    },
  });
}

// The courier catalogue is cached TWICE, and a write has to drop both.
//
// `["shipping"]` is the TanStack entry this screen reads. The other is the session cache in
// catalogue.ts, which ShippingSelect and every ShippingBadge read from instead — a badge renders per
// table ROW, so a per-instance fetch would be one ShippingList per row (#126).
//
// Dropping both is folded in HERE rather than composed at the call site, which is what this page used
// to do. A rename that cleared only the query would leave the old name in every badge for the rest of
// the session, and "did this caller remember the second cache?" is precisely the question #177 exists
// to stop asking.
export function useInvalidateShipping() {
  const client = useQueryClient();

  return () => {
    invalidateShippingCatalogue();

    return client.invalidateQueries({ queryKey: ["shipping"] });
  };
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// A mutation DECLARES WHAT IT INVALIDATES, here, beside the query it makes stale — see
// src/expenses/queries.ts for the full argument. The split: the hook owns the CACHE, the component
// owns the UX (the toast, closing the dialog, showing the error).
//
// `onSuccess` RETURNS the invalidation promise on purpose. TanStack then awaits it, so the dialog
// cannot close a beat before the renamed row appears — which reads as a write that did not land.
//
// TWO hooks here rather than the single `useSaveX` the expense and category screens use, because
// create and update are genuinely different writes rather than one form with an optional id: `code`
// is the immutable machine key a shipment stores, so it is settable only at creation and
// ShippingUpdate cannot carry it at all.
//
// NOTHING outside the catalogue is invalidated, which is worth stating because a courier rename looks
// like it should touch orders. It does not: an order and a restock request store the courier CODE
// (`shipping_code` — opaque, no FK) and never a copy of its name, so no order row can hold a stale
// one. The name those screens show is resolved from the catalogue at render time, and dropping the
// catalogue above is what refreshes them.

export function useCreateShipping() {
  const invalidate = useInvalidateShipping();

  return useMutation({
    mutationFn: (vars: { code: string; name: string }) => shippingClient.shippingCreate(vars),
    onSuccess: () => invalidate(),
  });
}

// One hook for BOTH writes that reach ShippingUpdate — the rename dialog and the row's
// activate/deactivate — because it is one RPC taking a partial patch, where an absent field means
// "leave it alone". A separate `useToggleShippingActive` would be the same mutation under a second
// name, free to invalidate differently from this one.
export function useUpdateShipping() {
  const invalidate = useInvalidateShipping();

  return useMutation({
    mutationFn: (vars: { shippingId: bigint; name?: string; active?: boolean }) =>
      shippingClient.shippingUpdate(vars),
    onSuccess: () => invalidate(),
  });
}

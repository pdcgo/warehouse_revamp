import { useQuery, useQueryClient } from "@tanstack/react-query";
import { shippingClient } from "../api/clients";
import { key } from "../api/queryClient";

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

export function useInvalidateShipping() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["shipping"] });
}

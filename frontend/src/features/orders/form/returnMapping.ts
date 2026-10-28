import { useMemo, useState } from "react";

import { useProductReturnMaps } from "../queries";
import type { CrossLine, MappedProduct } from "./ReturnMappingCard";

// THE RETURN MAPPING ON SCREEN — for both screens that wear the order form: a new order, and a draft being finished
// (the-draft-page-wears-the-order-form). One hook, so the two cannot disagree about what a mapped row is.
//
// A row is mapped by one of two things, and the second wins:
//
//   1. A PAIR THAT ALREADY STANDS on the server (ProductReturnMapByIds) — written on an earlier order, or by somebody
//      else. It arrives locked and says so (`remembered`), because an answer nobody gave here must not look like one
//      somebody did.
//   2. A PICK MADE ON THIS FORM — the card has already WRITTEN it by the time it lands here
//      (the-map-is-written-when-it-is-picked), so it is as final as the first kind; it only reads differently.
//
// Nothing here prunes: the mapping is DERIVED from the order's current borrowed lines, so a product taken off the order
// simply stops being shown, and comes back mapped if it is added again — the pair stands on the server either way.
export function useReturnMapping(teamId: bigint | undefined, crossLines: CrossLine[]) {
  const [picks, setPicks] = useState<Map<string, MappedProduct>>(new Map());
  const standing = useProductReturnMaps({ teamId, sharedProductIds: crossLines.map((l) => l.productId) });

  const mapping = useMemo(() => {
    const next = new Map<string, MappedProduct>();

    for (const line of crossLines) {
      const key = line.productId.toString();

      const picked = picks.get(key);
      if (picked) {
        next.set(key, picked);
        continue;
      }

      const pair = standing.data?.get(key);
      if (pair) next.set(key, { productId: pair.productId, name: pair.name, remembered: true });
    }

    return next;
  }, [crossLines, picks, standing.data]);

  function onMap(crossProductId: bigint, mapped: MappedProduct) {
    setPicks((prev) => new Map(prev).set(crossProductId.toString(), mapped));
  }

  // What still needs an answer — Create (Promote) is held while it is above zero, and so is it while the standing
  // pairs are still being read: "not read yet" is not "not mapped", and the server would decide either way.
  const unmapped = crossLines.filter((l) => !mapping.has(l.productId.toString())).length;

  return { mapping, onMap, unmapped, checking: standing.isPending };
}

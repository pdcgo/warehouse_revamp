// ProductService.ProductCodesByIds as Storybook's stub answers it (backlog #152), with the server's rules
// (product_v1/product_codes_by_ids.go): each product's code now and every code it carried before — newest first, each
// once (compared case-insensitively), never its code now — and each side only its own: the team's own products and, for a
// warehouse, the ones it holds (heldHere, the WarehouseStockList set); any other id is ABSENT, never refused. A product a
// story names with `scanCodesForStory` is one the asking warehouse holds. Merged into ProductService by stubTransport.ts.

import { allProducts } from "./productStub";
import { formerCodesOf, productCodeScenario, storyScanCodes } from "./productCodeScenario";
import { heldHere } from "./warehouseProductSearchStub";

export const productCodeService = {
  productCodesByIds: (req: { teamId: bigint; productIds: bigint[] }) => {
    productCodeScenario.calls.push({ teamId: req.teamId, productIds: [...req.productIds] });

    const held = heldHere(req.teamId);
    const items: Record<string, { productCode: string; formerCodes: string[] }> = {};

    for (const id of req.productIds) {
      const story = storyScanCodes(id);
      const product = allProducts().find((p) => p.id === id);
      const live = story?.live ?? (product && (product.teamId === req.teamId || held.has(id)) ? product.productCode : undefined);
      if (live === undefined) continue;

      const seen = new Set([live.toLowerCase()]);
      const formerCodes = formerCodesOf(id).filter((code) => {
        const folded = code.toLowerCase();
        if (seen.has(folded)) return false;

        seen.add(folded);
        return true;
      });

      items[id.toString()] = { productCode: live, formerCodes };
    }

    return { items };
  },
};

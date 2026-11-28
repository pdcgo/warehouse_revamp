// ProductService's ELEVEN TAG RPCs as Storybook's stub answers them (backlog #148) — the handlers over
// productTagScenario.ts's list, with the two checks that need the catalogue and the shelves: a custom or system tag goes
// on / comes off only a product of the CALLER's team (another team's product is NotFound, as ProductUpdate answers), and
// ProductTagsByIds answers each side only its own — the team's own products and, for a warehouse, the ones it holds
// (heldHere, the WarehouseStockList set); any other id is ABSENT, never refused (product_tag.proto). Merged into
// ProductService by stubTransport.ts. A stub plays the request policy from `sessionScenario.role`, as the order tags' does.

import { Code, ConnectError } from "@connectrpc/connect";

import { ProductTagType } from "../src/gen/warehouse/product/v1/product_tag_pb";
import { allProducts } from "./productStub";
import {
  productTagScenario,
  createProductTag,
  deleteProductTag,
  listProductTags,
  manageProductTags,
  refuseUnlessProductTagRole,
  renameProductTag,
  setProductTag,
  tagsOnWire,
} from "./productTagScenario";
import { heldHere } from "./warehouseProductSearchStub";

type PageReq = { page?: number; limit?: number } | undefined;
type TagReq = { teamId: bigint; productId: bigint; tagId: bigint };

/** The product, when the caller's team owns it — else NotFound, as the server answers another team's product. */
function ownedBy(teamId: bigint, productId: bigint) {
  const product = allProducts().find((p) => p.id === productId);
  if (!product || product.teamId !== teamId) throw new ConnectError("product not found", Code.NotFound);

  return product;
}

export const productTagService = {
  // A READ — the products' one list, every team's (both Products lists and the add box). A monitor reaches it too.
  productTagList: (req: { q: string; page?: PageReq }) => listProductTags(req.q, req.page),
  productTagManageList: (req: { q: string; page?: PageReq }) => {
    refuseUnlessProductTagRole(true);
    return manageProductTags(req.q, req.page);
  },
  productTagCreate: (req: { teamId: bigint; name: string }) => {
    refuseUnlessProductTagRole(false);
    return createProductTag(req.name, ProductTagType.CUSTOM, req.teamId);
  },
  productTagSystemCreate: (req: { name: string }) => {
    refuseUnlessProductTagRole(true);
    return createProductTag(req.name, ProductTagType.SYSTEM);
  },
  productTagRename: (req: { tagId: bigint; name: string }) => {
    refuseUnlessProductTagRole(true);
    return renameProductTag(req.tagId, req.name);
  },
  productTagDelete: (req: { tagId: bigint }) => {
    refuseUnlessProductTagRole(true);
    return deleteProductTag(req.tagId);
  },
  productTagAdd: (req: TagReq) => {
    refuseUnlessProductTagRole(false);
    ownedBy(req.teamId, req.productId);
    return setProductTag(req.productId, req.tagId, false, true);
  },
  productTagRemove: (req: TagReq) => {
    refuseUnlessProductTagRole(false);
    ownedBy(req.teamId, req.productId);
    return setProductTag(req.productId, req.tagId, false, false);
  },
  productSystemTagAdd: (req: TagReq) => {
    refuseUnlessProductTagRole(true);
    ownedBy(req.teamId, req.productId);
    return setProductTag(req.productId, req.tagId, true, true);
  },
  productSystemTagRemove: (req: TagReq) => {
    refuseUnlessProductTagRole(true);
    ownedBy(req.teamId, req.productId);
    return setProductTag(req.productId, req.tagId, true, false);
  },
  // The warehouse product page's chips — each side only its own; the rest absent.
  productTagsByIds: (req: { teamId: bigint; productIds: bigint[] }) => {
    productTagScenario.byIdsCalls.push([...req.productIds]);
    const held = heldHere(req.teamId);
    const items: Record<string, { tags: ReturnType<typeof tagsOnWire> }> = {};
    for (const id of req.productIds) {
      const product = allProducts().find((p) => p.id === id);
      if (!product) continue;
      if (product.teamId !== req.teamId && !held.has(id)) continue;
      items[id.toString()] = { tags: tagsOnWire(id) };
    }

    return { items };
  },
};

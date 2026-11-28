// A PRODUCT'S TAGS — what a product tag is, and the few rules every screen reads the same way (backlog #148, LIVE since
// the accept, the-team-code-and-product-tags-prototype-is-accepted; the backend is #147).
//
// The owner's decisions (docs/business/product/context_decision.md):
//   · products-have-their-own-tag-list — products get a tag list of their OWN, as orders and restocks have theirs, under
//     the same rules (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps): `system` or `custom`; a custom tag
//     made and used by anyone who may WRITE on the product (ProductUpdate's roles: the selling Owner and Admin, Root, the
//     Administrator); system tags, renaming and deleting a tag are the admins'; the Products list filters by tag;
//   · its 🔄 *who sees* — the owning team AND every warehouse holding the product's stock see its tags (and filter by
//     them); other teams on Discover Product see none;
//   · its 🔄 *what clears* — the first APP-OWNED system tag, `need_reprint_code`, is put on by the team code change
//     (a-team-code-change-recomposes-its-product-codes) and comes off by the app once every warehouse holding the
//     product's stock has printed its new labels (the warehouse's *Cetak ulang kode*, #151). Nobody puts it on or takes
//     it off by hand, an admin included (as the restock's problem tags, `isAppTag`).
//
// THE DESIGN FOLLOWED: the-team-code-and-product-tags-prototype-is-accepted — the restock's own chips
// (features/restock/RestockTagChips, reused as they are), and the order tags' filter, Tags box and Kelola tag copied
// beside this file (ProductTagFilter, ProductTagsBox, ProductTagManageDialog) with the products' test ids and words.
//
// THE API (proto/warehouse/product/v1/product_tag.proto, on ProductService — tagQueries.ts calls it):
//   ProductTagList / ProductTagManageList          the products' one list, every team's (the manage list with counts)
//   ProductTagCreate / ProductTagSystemCreate      a custom tag (a name that exists, any case, answers THAT tag) / a system
//                                                  tag, Root / Administrator only
//   ProductTagRename / ProductTagDelete            Root / Administrator only; the app's tag is refused
//   ProductTagAdd / ProductTagRemove               a custom tag on / off — the product's writers
//   ProductSystemTagAdd / ProductSystemTagRemove   an admin's system tag on / off
//   ProductTagsByIds                               the tags of known products, each side only its own — the warehouse's
//                                                  product page, which reads the product by id (ProductByIds, no tags)
//   Product.tags / ProductRowItem.tags             on ProductDetail and ProductList rows; WarehouseProductSearchItem.tags
//                                                  on WarehouseStockList rows — never on ProductByIds / ProductDiscover
//   ProductListFilter.tag_ids, WarehouseStockListFilter.tag_ids   ANY of the picked, on the server
//   tags.app_task = "product.code.reprint"         the `need_reprint_code` tag, seeded locked

import type { ProductTag as WireTag } from "../../../gen/warehouse/product/v1/product_tag_pb";
import { ProductTagType as WireTagType } from "../../../gen/warehouse/product/v1/product_tag_pb";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import type { RestockTag, RestockTagType } from "../../restock/restockTags";
import { NO_TAGS as NO_TAG_IDS, TAGS_CODEC as TAG_IDS_CODEC, sortTags } from "../../restock/restockTags";

export type ProductTagType = RestockTagType;

/** A product tag — the restock tag's shape: a system tag the app owns carries its app task. */
export type ProductTag = RestockTag;

/** The app task that owns `need_reprint_code` — put on by the team code change, off by the warehouses' reprint. */
export const REPRINT_TAG_TASK = "product.code.reprint";

/** The tag's name as the owner wrote it (products-have-their-own-tag-list). Data, not a translation: one name, one tag. */
export const REPRINT_TAG_NAME = "need_reprint_code";

/** A tag as the wire carries it, in the screens' words. */
export function tagFromWire(tag: WireTag): ProductTag {
  return {
    id: tag.id,
    name: tag.name,
    type: tag.type === WireTagType.SYSTEM ? "SYSTEM" : "CUSTOM",
    appTask: tag.appTask === "" ? undefined : tag.appTask,
  };
}

/** A product's tags in every screen's order — the system's first, then by name. */
export function tagsOfProduct(product: { tags: WireTag[] }): ProductTag[] {
  return sortTags(product.tags.map(tagFromWire));
}

/** The lists' Tag filter in the address — the picked ids, comma-joined (`?tag=1,2`); none picked is left out. */
export const TAGS_CODEC = TAG_IDS_CODEC;
/** No tag picked — "any tag". One array, so the filter's default is the same value every render. */
export const NO_TAGS: bigint[] = NO_TAG_IDS;

// One name, one tag — compared trimmed, inner spaces folded, case ignored; kept as typed (restockTags.ts' rules, reused).
export { cleanTagName, isAppTag, sortTags, tagNameKey, tagNamed } from "../../restock/restockTags";

/** ProductUpdate's roles — who writes on a product, and so who tags it (products-have-their-own-tag-list). UX only: the
 *  access interceptor is the boundary. */
export function writesProducts(role: Role | undefined): boolean {
  return role === Role.ROOT || role === Role.ADMINISTRATOR || role === Role.SELLING_OWNER || role === Role.SELLING_ADMIN;
}

/** What a screen gets to draw and change a product's tags with — the order tags' api, for products. */
export interface ProductTagsApi {
  /** The products' one list, every team's, the system's first then by name — what the add box offers. */
  catalogue: ProductTag[];
  /** Root or the Administrator: may make a system tag, put one on or take it off, and rename or delete any tag but the app's. */
  admin: boolean;
  /** May tag THIS product — its writers (ProductUpdate's roles), never a monitor, never a warehouse. */
  writable: boolean;
  /** Makes a tag — or answers the one the list already has under the name (never a twin). Null when refused. */
  create: (name: string, type: ProductTagType) => Promise<ProductTag | null>;
  add: (productId: bigint, tag: ProductTag) => Promise<void>;
  remove: (productId: bigint, tag: ProductTag) => Promise<void>;
  /** Admins only: "taken" when another product tag already carries the name (any case); "failed" is said in a toast. */
  rename: (tagId: bigint, name: string) => Promise<"renamed" | "taken" | "failed">;
  /** Admins only: the tag leaves the list and comes off every product that carries it. */
  drop: (tagId: bigint) => Promise<void>;
}

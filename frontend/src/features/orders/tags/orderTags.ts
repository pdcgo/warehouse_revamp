// AN ORDER'S TAGS — what an order tag is, and the few rules every screen reads the same way (backlog #100, LIVE since the
// accept, the-order-tags-prototype-is-accepted).
//
// The owner's decisions (docs/business/order/context_decision.md — orders-have-their-own-tag-list and its 🔄 lines):
//   · tags belong to a DOMAIN — orders keep a tag list of their OWN, apart from the restocks'. A restock tag is never
//     offered on an order (nor an order tag on a restock), the same name may exist in both lists, and a name is unique
//     WITHIN the orders' list. The list lives with orders (selling);
//   · the restock tags' rules apply on it (🔄 "A"): system / custom (a-restock-tag-is-system-or-custom); ONE order list
//     shared by every team; a custom tag made and used by anyone who may write on the order; seen and tagged by the
//     selling team AND the warehouse that ships the order, in every status, not by a monitor; system tags, rename and
//     delete for admins (Root / Administrator) only; the order lists filter by tag, ANY of the picked
//     (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps, the-restock-tags-prototype-is-accepted);
//   · NO APP-OWNED ORDER TAGS for now (🔄 "A") — the app puts no tag on an order; an admin may still make a system tag by
//     hand. So an order tag carries no app task, and nothing here locks a tag for an admin.
//
// THE DESIGN FOLLOWED: the-restock-tags-prototype-is-accepted — the restock's own chips (features/restock/RestockTagChips,
// reused as they are), and its filter, Tags box and Kelola tag copied beside this file (OrderTagFilter, OrderTagsBox,
// OrderTagManageDialog) with the orders' test ids and words.
//
// THE API (proto/warehouse/selling/v1/order_tag.proto, on OrderService — tagQueries.ts calls it):
//   OrderTagList            the orders' one list, every team's (a read — the filter and the add box; a picker feed)
//   OrderTagManageList      the admins' list, each tag's order count, every team's (Kelola tag)
//   OrderTagCreate          a CUSTOM tag; a name the orders' list already has, in any case, answers THAT tag — never a twin
//   OrderTagSystemCreate    a SYSTEM tag — Root / Administrator only
//   OrderTagRename          Root / Administrator only; a name another order tag carries (any case) is AlreadyExists
//   OrderTagDelete          Root / Administrator only; the tag comes off every order that carries it
//   OrderTagAdd / Remove                a custom tag on / off an order — the selling team or the warehouse shipping it,
//                                       every role but a monitor, in every status; another team's order is NotFound
//   OrderSystemTagAdd / Remove          an admin's system tag on / off — Root / Administrator only
//   Order.tags                          an order's tags, on the list's rows (OrderList) and the detail (OrderDetail)
//   OrderListFilter.tag_ids             ANY of — inside `scopedOrders`, so the rows, the tab counts (OrderStatFilter
//   OrderStatFilter.tag_ids             takes the same), the statistics and Ekspor narrow alike

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import type { OrderTag as WireTag } from "../../../gen/warehouse/selling/v1/order_tag_pb";
import { OrderTagType as WireTagType } from "../../../gen/warehouse/selling/v1/order_tag_pb";
import type { RestockTagType } from "../../restock/restockTags";
import { NO_TAGS as NO_TAG_IDS, TAGS_CODEC as TAG_IDS_CODEC, sortTags } from "../../restock/restockTags";

export type OrderTagType = RestockTagType;

/** An order tag — the restock tag's shape without an app task (no app-owned order tags). */
export interface OrderTag {
  id: bigint;
  name: string;
  type: OrderTagType;
}

/** A tag as the wire carries it, in the screens' words. */
export function tagFromWire(tag: WireTag): OrderTag {
  return { id: tag.id, name: tag.name, type: tag.type === WireTagType.SYSTEM ? "SYSTEM" : "CUSTOM" };
}

/** An order's tags in every screen's order — the system's first, then by name. */
export function tagsOfOrder(order: Pick<Order, "tags">): OrderTag[] {
  return sortTags(order.tags.map(tagFromWire));
}

/** The lists' Tag filter in the address — the picked ids, comma-joined (`?tag=1,2`); none picked is left out. */
export const TAGS_CODEC = TAG_IDS_CODEC;
/** No tag picked — "any tag". One array, so the filter's default is the same value every render. */
export const NO_TAGS: bigint[] = NO_TAG_IDS;

// One name, one tag — compared trimmed, inner spaces folded, case ignored; kept as typed (restockTags.ts' rules, reused).
export { cleanTagName, sortTags, tagNameKey, tagNamed } from "../../restock/restockTags";

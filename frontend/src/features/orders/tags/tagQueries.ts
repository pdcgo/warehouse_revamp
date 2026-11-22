import { useMemo } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { orderClient } from "../../../api/clients";
import { key, referenceQuery } from "../../../api/queryClient";
import { rpcError } from "../../../api/rpcError";
import { toaster } from "../../../components/feedback/Toaster";
import { useCanWrite, useTeam } from "../../team/TeamContext";
import type { OrderTag, OrderTagType } from "./orderTags";
import { cleanTagName, sortTags, tagFromWire } from "./orderTags";

// THE ORDER TAGS' READS AND WRITES (backlog #100, live since the-order-tags-prototype-is-accepted) — what the two order
// lists' Tag filter and the order pages' Tags box share. The RPCs are orderTags.ts's head; the rules are the server's,
// and the screens only offer what it would take. The restock tags' tagQueries.ts, for the orders' own list.

/**
 * How much of the orders' list a picker reads: one large first page (a list that grows with the data pages — HARD RULE
 * 9 — and a picker asks a large first page), filtered in the field.
 */
export const ORDER_TAG_LIST_SIZE = 200;

/** No tags yet — one array, so a list's options are the same value every render while the catalogue loads. */
export const NO_ORDER_TAGS: OrderTag[] = [];

// A picker feed (HARD RULE 10, `referenceQuery`): it LABELS the filter and the add box. Keyed under `orders`, so every
// order write — a tag made, renamed or deleted included — makes it stale with the rest.
export function useOrderTagCatalogue(teamId: bigint | undefined) {
  return useQuery({
    queryKey: key.orders(teamId, { tagCatalogue: true }),
    ...referenceQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await orderClient.orderTagList({ teamId: teamId!, q: "", page: { page: 1, limit: ORDER_TAG_LIST_SIZE } });

      return sortTags(res.tags.map(tagFromWire));
    },
  });
}

/** The admins' Kelola tag pesanan list — the same tags, each with how many orders carry it, every team's. Read while open. */
export function useOrderTagUsage(enabled: boolean) {
  return useQuery({
    queryKey: key.orders(undefined, { tagUsage: true }),
    enabled,
    queryFn: async () => {
      const res = await orderClient.orderTagManageList({ q: "", page: { page: 1, limit: ORDER_TAG_LIST_SIZE } });

      return new Map(res.tags.map((tag) => [tag.id.toString(), Number(tag.orderCount)]));
    },
  });
}

/** What a screen gets to draw and change an order's tags with. */
export interface OrderTagsApi {
  /** The orders' one list, every team's, the system's first then by name — what the filter and the add box offer. */
  catalogue: OrderTag[];
  /** Root or the Administrator: may make a system tag, put one on or take it off, and rename or delete any order tag. */
  admin: boolean;
  /** May tag THIS order — anyone the screen lets write (every role but a monitor), on the selling side or the shipping
   *  warehouse's, in every status. */
  writable: boolean;
  /** Makes a tag — or answers the one the orders' list already has under the name (never a twin). Null when refused. */
  create: (name: string, type: OrderTagType) => Promise<OrderTag | null>;
  add: (orderId: bigint, tag: OrderTag) => Promise<void>;
  remove: (orderId: bigint, tag: OrderTag) => Promise<void>;
  /** Admins only: "taken" when another order tag already carries the name (any case); "failed" is said in a toast. */
  rename: (tagId: bigint, name: string) => Promise<"renamed" | "taken" | "failed">;
  /** Admins only: the tag leaves the list and comes off every order that carries it. */
  drop: (tagId: bigint) => Promise<void>;
}

/** The two teams an order has — its selling team and the warehouse that ships it. */
export interface OrderSides {
  teamId: bigint;
  warehouseId: bigint;
}

/**
 * The live tags API for an order's page. The caller's team tags the order when it is ONE OF ITS TWO SIDES — the selling
 * team or the warehouse that ships it (orders-have-their-own-tag-list); another reader (the root team reading every
 * team's orders, a return warehouse that does not ship it) sees the tags and changes none, as the server answers it
 * NotFound. A system tag goes on and comes off through the admins' RPCs, a custom one through the team's; every write
 * re-reads the orders domain (the page, the lists, the catalogue).
 */
export function useOrderTags(order?: OrderSides): OrderTagsApi {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { current, platformRole } = useTeam();
  const canWrite = useCanWrite();
  const teamId = current?.teamId;
  const catalogue = useOrderTagCatalogue(teamId);
  const onSide = order !== undefined && teamId !== undefined && (order.teamId === teamId || order.warehouseId === teamId);
  const writable = canWrite && onSide;

  const refresh = () => client.invalidateQueries({ queryKey: ["orders"] });
  const failed = (err: unknown) => toaster.create({ type: "error", title: t("orders.tags.saveFailed"), description: rpcError(err) });

  const write = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSettled: () => refresh(),
  });

  return useMemo<OrderTagsApi>(() => {
    const team = teamId ?? 0n;

    const attempt = async (run: () => Promise<unknown>): Promise<boolean> => {
      try {
        await write.mutateAsync(run);
        return true;
      } catch (err) {
        failed(err);
        return false;
      }
    };

    return {
      catalogue: catalogue.data ?? [],
      admin: canWrite && platformRole !== undefined,
      writable,
      create: async (name, type) => {
        let made: OrderTag | null = null;
        await attempt(async () => {
          const res =
            type === "SYSTEM"
              ? await orderClient.orderTagSystemCreate({ name: cleanTagName(name) })
              : await orderClient.orderTagCreate({ teamId: team, name: cleanTagName(name) });
          made = res.tag ? tagFromWire(res.tag) : null;
        });
        return made;
      },
      add: async (orderId, tag) => {
        await attempt(() =>
          tag.type === "SYSTEM"
            ? orderClient.orderSystemTagAdd({ teamId: team, orderId, tagId: tag.id })
            : orderClient.orderTagAdd({ teamId: team, orderId, tagId: tag.id }),
        );
      },
      remove: async (orderId, tag) => {
        await attempt(() =>
          tag.type === "SYSTEM"
            ? orderClient.orderSystemTagRemove({ teamId: team, orderId, tagId: tag.id })
            : orderClient.orderTagRemove({ teamId: team, orderId, tagId: tag.id }),
        );
      },
      rename: async (tagId, name) => {
        try {
          await write.mutateAsync(() => orderClient.orderTagRename({ tagId, name: cleanTagName(name) }));
          return "renamed";
        } catch (err) {
          // A name another order tag carries is said in place (OrderTagManageDialog); anything else is a toast.
          if (ConnectError.from(err).code === Code.AlreadyExists) return "taken";
          failed(err);
          return "failed";
        }
      },
      drop: async (tagId) => {
        await attempt(() => orderClient.orderTagDelete({ tagId }));
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, catalogue.data, canWrite, writable, platformRole]);
}

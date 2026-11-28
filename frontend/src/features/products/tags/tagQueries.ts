import { useMemo } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { productClient } from "../../../api/clients";
import { key, referenceQuery } from "../../../api/queryClient";
import { rpcError } from "../../../api/rpcError";
import { toaster } from "../../../components/feedback/Toaster";
import { useCanWrite, useTeam } from "../../team/TeamContext";
import type { ProductTag, ProductTagType, ProductTagsApi } from "./productTags";
import { cleanTagName, sortTags, tagFromWire, writesProducts } from "./productTags";

// THE PRODUCT TAGS' READS AND WRITES (backlog #148, live since the-team-code-and-product-tags-prototype-is-accepted) —
// what both Products lists' Tag filter, the product page's Tag card and the warehouse product page's chips share. The
// RPCs are productTags.ts's head; the rules are the server's, and the screens only offer what it would take. The order
// tags' tagQueries.ts (features/orders/tags), for the products' own list.
//
// THE CHIPS COME FROM WHAT EACH PAGE ALREADY READS — `ProductRowItem.tags` (ProductList), `Product.tags` (ProductDetail),
// `WarehouseProductSearchItem.tags` (WarehouseStockList) — never a tag read per row. The one page with no owner's read
// to carry them, the warehouse's product page (ProductByIds carries no tags, 🔄 *who sees*), asks ProductTagsByIds once.

/**
 * How much of the products' list a picker reads: one large first page (a list that grows with the data pages — HARD
 * RULE 9 — and a picker asks a large first page), filtered in the field.
 */
export const PRODUCT_TAG_LIST_SIZE = 200;

/** No tags yet — one array, so a list's options are the same value every render while the catalogue loads. */
export const NO_PRODUCT_TAGS: ProductTag[] = [];

// A picker feed (HARD RULE 10, `referenceQuery`): it LABELS the filter and the add box. Keyed under `products`, so every
// product write — a tag made, renamed or deleted included — makes it stale with the rest.
export function useProductTagCatalogue(teamId: bigint | undefined, enabled = true) {
  return useQuery({
    queryKey: key.products(teamId, { tagCatalogue: true }),
    ...referenceQuery,
    enabled: enabled && teamId !== undefined,
    queryFn: async () => {
      const res = await productClient.productTagList({ teamId: teamId!, q: "", page: { page: 1, limit: PRODUCT_TAG_LIST_SIZE } });

      return sortTags(res.tags.map(tagFromWire));
    },
  });
}

/** The admins' Kelola tag produk list — the same tags, each with how many products carry it, every team's. Read while open. */
export function useProductTagUsage(enabled: boolean) {
  return useQuery({
    queryKey: key.products(undefined, { tagUsage: true }),
    enabled,
    queryFn: async () => {
      const res = await productClient.productTagManageList({ q: "", page: { page: 1, limit: PRODUCT_TAG_LIST_SIZE } });

      return new Map(res.tags.map((tag) => [tag.id.toString(), Number(tag.productCount)]));
    },
  });
}

/**
 * ONE product's tags for a page that reads it by id — the warehouse's product page (ProductTagsByIds: the team's own
 * products and, for a warehouse, the ones it holds; any other id is absent, read here as no tags). A by-id read on the
 * plain default (never `listQuery`: product 5's chips must not stand under product 9's address).
 */
export function useProductTagsOf(teamId: bigint | undefined, productId: bigint) {
  return useQuery({
    queryKey: key.products(teamId, { tagsOf: productId.toString() }),
    enabled: teamId !== undefined && productId > 0n,
    queryFn: async () => {
      const res = await productClient.productTagsByIds({ teamId: teamId!, productIds: [productId] });

      return sortTags((res.items[productId.toString()]?.tags ?? []).map(tagFromWire));
    },
  });
}

/** The product a Tag card belongs to — its id and the team that owns it. */
export interface TaggedProduct {
  id: bigint;
  teamId: bigint;
}

/**
 * The live tags API for a product's page. The caller's team tags the product when it OWNS it and the caller is one of
 * its writers (ProductUpdate's roles — the selling Owner and Admin, Root, the Administrator; never CS, a warehouse or a
 * monitor); everyone else reads the chips. A system tag goes on and comes off through the admins' RPCs, a custom one
 * through the team's; every write re-reads the products domain (the page, the lists, the catalogue). The catalogue —
 * what the add box offers — is read only for someone who may add.
 */
export function useProductTags(product?: TaggedProduct): ProductTagsApi {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { current, platformRole } = useTeam();
  const canWrite = useCanWrite();
  const teamId = current?.teamId;
  const owns = product !== undefined && teamId !== undefined && product.teamId === teamId;
  const writable = canWrite && owns && writesProducts(current?.role);
  const admin = canWrite && platformRole !== undefined;
  const catalogue = useProductTagCatalogue(teamId, writable || admin);

  const refresh = () => client.invalidateQueries({ queryKey: ["products"] });
  const failed = (err: unknown) => toaster.create({ type: "error", title: t("products.tags.saveFailed"), description: rpcError(err) });

  const write = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSettled: () => refresh(),
  });

  return useMemo<ProductTagsApi>(() => {
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
      catalogue: catalogue.data ?? NO_PRODUCT_TAGS,
      admin,
      writable,
      create: async (name: string, type: ProductTagType) => {
        let made: ProductTag | null = null;
        await attempt(async () => {
          const res =
            type === "SYSTEM"
              ? await productClient.productTagSystemCreate({ name: cleanTagName(name) })
              : await productClient.productTagCreate({ teamId: team, name: cleanTagName(name) });
          made = res.tag ? tagFromWire(res.tag) : null;
        });
        return made;
      },
      add: async (productId, tag) => {
        await attempt(() =>
          tag.type === "SYSTEM"
            ? productClient.productSystemTagAdd({ teamId: team, productId, tagId: tag.id })
            : productClient.productTagAdd({ teamId: team, productId, tagId: tag.id }),
        );
      },
      remove: async (productId, tag) => {
        await attempt(() =>
          tag.type === "SYSTEM"
            ? productClient.productSystemTagRemove({ teamId: team, productId, tagId: tag.id })
            : productClient.productTagRemove({ teamId: team, productId, tagId: tag.id }),
        );
      },
      rename: async (tagId, name) => {
        try {
          await write.mutateAsync(() => productClient.productTagRename({ tagId, name: cleanTagName(name) }));
          return "renamed";
        } catch (err) {
          // A name another product tag carries is said in place (ProductTagManageDialog); anything else is a toast.
          if (ConnectError.from(err).code === Code.AlreadyExists) return "taken";
          failed(err);
          return "failed";
        }
      },
      drop: async (tagId) => {
        await attempt(() => productClient.productTagDelete({ tagId }));
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, catalogue.data, admin, writable]);
}

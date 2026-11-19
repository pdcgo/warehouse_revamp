import { useMemo } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { restockClient } from "../../api/clients";
import { key, referenceQuery } from "../../api/queryClient";
import { rpcError } from "../../api/rpcError";
import { toaster } from "../../components/feedback/Toaster";
import { useCanWrite, useTeam } from "../team/TeamContext";
import type { RestockTag, RestockTagType } from "./restockTags";
import { cleanTagName, sortTags, tagFromWire } from "./restockTags";

// THE RESTOCK TAGS' READS AND WRITES (backlog #87, live since the-restock-tags-prototype-is-accepted) — what the two lists'
// Tag filter and the two details' Tags box share. The RPCs are restockTags.ts's head; the rules are the server's, and
// the screens only offer what it would take.

/**
 * How much of the app-wide list a picker reads: one large first page (a list that grows with the data pages — HARD RULE
 * 9 — and a picker asks a large first page, as ShipmentChannelSelect does), filtered in the field.
 */
export const TAG_LIST_SIZE = 200;

// A picker feed (HARD RULE 10, `referenceQuery`): it LABELS the filter and the add box. Keyed under `restock`, so every
// restock write — a tag made, renamed or deleted included — makes it stale with the rest.
export function useRestockTagCatalogue(teamId: bigint | undefined) {
  return useQuery({
    queryKey: key.restock(teamId, { tagCatalogue: true }),
    ...referenceQuery,
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await restockClient.restockTagList({ teamId: teamId!, q: "", page: { page: 1, limit: TAG_LIST_SIZE } });

      return sortTags(res.tags.map(tagFromWire));
    },
  });
}

/** The admins' Kelola tag list — the same tags, each with how many restocks carry it, every team's. Read while open. */
export function useRestockTagUsage(enabled: boolean) {
  return useQuery({
    queryKey: key.restock(undefined, { tagUsage: true }),
    enabled,
    queryFn: async () => {
      const res = await restockClient.restockTagManageList({ q: "", page: { page: 1, limit: TAG_LIST_SIZE } });

      return new Map(res.tags.map((tag) => [tag.id.toString(), Number(tag.restockCount)]));
    },
  });
}

/** What a screen gets to draw and change a restock's tags with. */
export interface RestockTagsApi {
  /** The app-wide list, every team's, the system's first then by name — what the filter and the add box offer. */
  catalogue: RestockTag[];
  /** Root or the Administrator (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps): may make a system tag,
   *  put one on or take it off, and rename or delete any tag. */
  admin: boolean;
  /** May tag a restock — anyone the screen lets write (every role but a monitor), on either side. */
  writable: boolean;
  /** Makes a tag — or answers the one that already carries the name (never a twin). Null when refused. */
  create: (name: string, type: RestockTagType) => Promise<RestockTag | null>;
  add: (requestId: bigint, tag: RestockTag) => Promise<void>;
  remove: (requestId: bigint, tag: RestockTag) => Promise<void>;
  /** Admins only: "taken" when another tag already carries the name (any case); "failed" is said in a toast. */
  rename: (tagId: bigint, name: string) => Promise<"renamed" | "taken" | "failed">;
  /** Admins only: the tag leaves the list and comes off every restock that carries it. */
  drop: (tagId: bigint) => Promise<void>;
}

/**
 * The live tags API for a detail page. `teamId` is the caller's team — one side of the restock. A system tag goes on and
 * comes off through the admins' RPCs, a custom one through the team's (root passes either); every write re-reads the
 * restock domain (the detail, the lists, the catalogue).
 */
export function useRestockTags(): RestockTagsApi {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { current, platformRole } = useTeam();
  const writable = useCanWrite();
  const teamId = current?.teamId;
  const catalogue = useRestockTagCatalogue(teamId);

  const refresh = () => client.invalidateQueries({ queryKey: ["restock"] });
  const failed = (err: unknown) => toaster.create({ type: "error", title: t("restock.tags.saveFailed"), description: rpcError(err) });

  const write = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSettled: () => refresh(),
  });

  return useMemo<RestockTagsApi>(() => {
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
      admin: writable && platformRole !== undefined,
      writable,
      create: async (name, type) => {
        let made: RestockTag | null = null;
        await attempt(async () => {
          const res =
            type === "SYSTEM"
              ? await restockClient.restockTagSystemCreate({ name: cleanTagName(name) })
              : await restockClient.restockTagCreate({ teamId: team, name: cleanTagName(name) });
          made = res.tag ? tagFromWire(res.tag) : null;
        });
        return made;
      },
      add: async (requestId, tag) => {
        await attempt(() =>
          tag.type === "SYSTEM"
            ? restockClient.restockRequestSystemTagAdd({ teamId: team, requestId, tagId: tag.id })
            : restockClient.restockRequestTagAdd({ teamId: team, requestId, tagId: tag.id }),
        );
      },
      remove: async (requestId, tag) => {
        await attempt(() =>
          tag.type === "SYSTEM"
            ? restockClient.restockRequestSystemTagRemove({ teamId: team, requestId, tagId: tag.id })
            : restockClient.restockRequestTagRemove({ teamId: team, requestId, tagId: tag.id }),
        );
      },
      rename: async (tagId, name) => {
        try {
          await write.mutateAsync(() => restockClient.restockTagRename({ tagId, name: cleanTagName(name) }));
          return "renamed";
        } catch (err) {
          // A name another tag carries is said in place (RestockTagManageDialog); anything else is a toast.
          if (ConnectError.from(err).code === Code.AlreadyExists) return "taken";
          failed(err);
          return "failed";
        }
      },
      drop: async (tagId) => {
        await attempt(() => restockClient.restockTagDelete({ tagId }));
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, catalogue.data, writable, platformRole]);
}

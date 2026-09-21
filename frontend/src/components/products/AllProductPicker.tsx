import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { productClient } from "../../api/clients";
import { productListRowData, productsFromList } from "../../features/products/adapt";
import { useTeam } from "../../features/team/TeamContext";
import { usePriorityTeamIds } from "../../features/teams/queries";
import { TeamSelect } from "../teams/TeamSelect";
import { PAGE_SIZE, ProductPickerShell } from "./ProductPickerShell";
import type { PickerSource } from "./ProductPickerShell";
import { catalogueBadges } from "./pickerBadges";
import type { ReadyLens } from "./pickerBadges";
import type { PickedProduct } from "./ProductSelect";

export interface AllProductPickerProps {
  /** WHOSE catalogue the "My Product" tab shows, and the team every call is authorized as. */
  teamId: bigint;
  /** Show READY stock from THIS warehouse — see OwnProductPicker. */
  stockWarehouseId?: bigint;
  readyLens?: ReadyLens;
  value: bigint[];
  onChange: (products: PickedProduct[]) => void;
  disabled?: boolean;
  trigger?: ReactNode;
}

export const description =
  "The full catalogue browse, as TABS in one dialog: My Product (this team's own catalogue), Priority Product (teams ROOT has granted the priority feature — their whole catalogue is priority), and Other Product (everybody else). The three are a PARTITION: a product appears on exactly one tab, because Other excludes the priority teams by the same id list Priority selects by. The Priority tab is HIDDEN when no team currently has the feature — an always-empty tab reads as \"we have none\" rather than \"not for you\". Ticks SURVIVE crossing a tab, which is the whole reason the tabs live inside one picker rather than being three sibling components a page arranges. Each tab is a table of product | on the way | ready stock. Only OTHER carries the owner-team filter: My is already one team's catalogue, and Priority is already a narrowing to the granted teams, so a team control on either would be a filter on a filter. Confirm applies the whole ticked set across every tab at once (an empty list clears), Cancel discards.";

// ── THE PRIORITY PARTITION ──────────────────────────────────────────────────────────────────────
//
// ROOT marks a TEAM as having the priority-product feature, and that makes EVERY product of that team
// a priority product (owner). A flag on the TEAM, not on the product, and not a per-viewer curation —
// so every selling team browsing sees the same priority set.
//
//   MY PRODUCT        ProductList(teamId)
//   PRIORITY PRODUCT  Discover(exclude_own_team, owner_team_ids         = priorityIds)
//   OTHER PRODUCT     Discover(exclude_own_team, exclude_owner_team_ids = priorityIds)
//
// ⚠ ONE ID LIST DRIVES BOTH HALVES, and that is the point rather than a convenience. If Priority
// selected by one rule and Other excluded by another, a priority product would eventually appear on
// two tabs — and ticking it on one would show it ticked on the other, which reads as a bug rather
// than as one selection seen twice.
//
// ⚠ THE IDS COME FROM team_service, NOT FROM A FLAG ON THE PRODUCT QUERY. product_service does not
// own `teams` and must not join to it (HARD RULE 3), so it cannot answer "whose owner has the
// feature". Handed a list of team ids it answers perfectly and never learns what the list means.
//
// ⚠ AN EMPTY PRIORITY SET HIDES THE TAB — it does not render an empty one. Two reasons, and the
// second is a correctness one: an always-empty tab reads as "we have no priority products" rather
// than "this is not for you", AND `owner_team_ids: []` means NO NARROWING to the server, so a Priority
// tab built from an empty list would show the entire catalogue.

export function AllProductPicker({
  teamId,
  stockWarehouseId,
  readyLens = "owned",
  value,
  onChange,
  disabled,
  trigger,
}: AllProductPickerProps) {
  const { t } = useTranslation();
  const { current } = useTeam();

  // WHOSE catalogue to narrow the Other tab to. 0n = everybody's, the default. It lives here rather
  // than in the source below because it is STATE, and a source is rebuilt every render.
  const [ownerTeamId, setOwnerTeamId] = useState<bigint>(0n);

  const scope = teamId > 0n ? teamId : (current?.teamId ?? 0n);
  const badges = catalogueBadges({ scopeTeamId: scope, stockWarehouseId, readyLens });

  // WHICH TEAMS ARE PRIORITY. Read once and used twice — to select on one tab and to exclude on the
  // other — so the partition cannot drift.
  const priorityIds = usePriorityTeamIds().data ?? [];
  const hasPriority = priorityIds.length > 0;

  // THE OWNER-TEAM FILTER BELONGS TO "OTHER PRODUCT" ALONE (owner).
  //
  // Not on My Product, because that catalogue is already one team's — a team filter there could only
  // narrow it to itself or to nothing.
  //
  // And not on Priority Product either, which is the less obvious half: that tab is ALREADY a
  // narrowing by team. It shows the handful of teams root has granted the feature, so a second team
  // control over the top is a filter on a filter — and the set it filters is small enough to read.
  // "Other" is the only tab whose team list is open-ended, and therefore the only one worth narrowing.
  const teamFilter = (
    <TeamSelect value={ownerTeamId} placeholder={t("productPicker.allTeams")} onChange={setOwnerTeamId} />
  );

  // Both discover tabs send the same base request; every narrowing that differs is PASSED IN.
  //
  // ⚠ `ownerTeamId` is an argument rather than a closed-over value, and that is the whole point. It
  // used to be applied here to both tabs — which was invisible while both showed the control, and
  // becomes a bug the moment one does not: narrow to a team on Other, cross to Priority, and Priority
  // would still be filtered by a control it no longer displays. A filter that cannot be seen cannot be
  // cleared, so the tab that owns the control is the tab that sends it.
  const discover = async (
    { page, q }: { page: number; q: string },
    narrow: { ownerTeamId?: bigint; ownerTeamIds?: bigint[]; excludeOwnerTeamIds?: bigint[] },
  ) => {
    const res = await productClient.productDiscover({
      teamId: scope,
      filter: { q },
      dataRequest: productListRowData(),
      page: { page, limit: PAGE_SIZE },
      // ⚠ SERVER-SIDE. Dropping own-team rows after a page loads would narrow the rows while the
      // pager went on counting them.
      excludeOwnTeam: true,
      ...narrow,
    });

    return {
      products: productsFromList(res.items, res.ids),
      total: Number(res.pageInfo?.totalItems ?? 0n),
    };
  };

  const sources: PickerSource[] = [
    {
      key: "own",
      label: t("productPicker.tabOwn"),
      loadBadges: badges,
      load: async ({ page, q }) => {
        const res = await productClient.productList({
          teamId: scope,
          filter: { q },
          dataRequest: productListRowData(),
          page: { page, limit: PAGE_SIZE },
        });

        return {
          products: productsFromList(res.items, res.ids),
          total: Number(res.pageInfo?.totalItems ?? 0n),
        };
      },
    },

    // Present only while some team actually has the feature — see the note above. `owner_team_ids: []`
    // would mean "no narrowing" and turn this tab into a second copy of Other.
    ...(hasPriority
      ? [
          {
            key: "priority",
            label: t("productPicker.tabPriority"),
            loadBadges: badges,
            // No team filter here — see teamFilter above. The tab IS a team narrowing already.
            load: (args: { page: number; q: string }) => discover(args, { ownerTeamIds: priorityIds }),
          },
        ]
      : []),

    {
      key: "other",
      label: t("productPicker.tabOther"),
      loadBadges: badges,
      // THE ONLY TAB WITH THE TEAM FILTER — and therefore the only one that sends `ownerTeamId`.
      filters: teamFilter,
      // The COMPLEMENT, from the same id list. The exclusion is skipped entirely when nothing is
      // priority — not because an empty list would be wrong, but because sending one says something
      // the server would have to parse for no effect.
      load: (args: { page: number; q: string }) =>
        discover(args, { ownerTeamId, ...(hasPriority ? { excludeOwnerTeamIds: priorityIds } : {}) }),
    },
  ];

  return (
    <ProductPickerShell
      scopeTeamId={scope}
      noTeamMessage={t("productPicker.noTeam")}
      // The active tab's key is appended by the shell, so a tab change re-fetches and resets paging
      // through the same machinery a changed warehouse already uses.
      // The priority ids are IN THE KEY: they arrive asynchronously, and a tab whose load already ran
      // against an empty list has to re-run when they land or it shows the unfiltered catalogue.
      loadKey={`catalogue:${scope}:${ownerTeamId}:${stockWarehouseId ?? 0n}:${readyLens}:${priorityIds.join(",")}`}
      sources={sources}
      layout="table"
      value={value}
      onChange={onChange}
      disabled={disabled}
      trigger={trigger}
    />
  );
}

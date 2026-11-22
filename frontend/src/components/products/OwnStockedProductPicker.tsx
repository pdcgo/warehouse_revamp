import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ProductPickerShell } from "./ProductPickerShell";
import { CATALOGUE_ID_LIMIT, catalogueSearchQuery, noMatches, ownCatalogueIdsQuery, stockedPage } from "./stockedSource";
import type { PickedProduct } from "./ProductSelect";

export interface OwnStockedProductPickerProps {
  /** WHOSE catalogue, and the team the call is authorized as — both, here. Required. */
  teamId: bigint;
  /** The building whose shelves narrow the catalogue. Required by the type. */
  warehouseId: bigint;
  value: bigint[];
  onChange: (products: PickedProduct[]) => void;
  disabled?: boolean;
  trigger?: ReactNode;
}

export const description =
  "Multi-select picker over MY CATALOGUE ∩ WHAT THIS WAREHOUSE HOLDS — the own-team counterpart of AllStockedProductPicker. \"Own\" means own CATALOGUE, not own stock: inventory_service has no owner axis (ownership is derived from the restock a unit arrived on, so a direct receive or a transfer belongs to nobody), so the team's product ids are resolved in product_service and handed to inventory as a narrowing. ⚠ That costs one ProductList page per 200 products on open, and cannot express a catalogue larger than 500 — the dialog says so when the cap bites. `warehouseId` is required by the type.";

// OwnStockedProductPicker exists because "what of MINE is on that shelf" is a real question — but it
// is NOT a question inventory_service can answer on its own, and that shapes the whole component.
//
//   StockedProductListFilter { warehouse_id, product_ids }   ← no owner_team_id, by design
//
// So the intersection is assembled across two services: product_service says which ids are mine,
// inventory_service says which of those the building holds and pages over them. The honest long-term
// fix is an `owner_team_id` on that filter; until then the ceiling below is real and is surfaced
// rather than hidden.
export function OwnStockedProductPicker({
  teamId,
  warehouseId,
  value,
  onChange,
  disabled,
  trigger,
}: OwnStockedProductPickerProps) {
  const { t } = useTranslation();
  const client = useQueryClient();

  // The team's catalogue ids, resolved ONCE and reused for every page turn and every reopen — a fact about a team, not
  // about a page; re-resolving per page would triple the cost of the pager for no new information. Through the query
  // cache (`ownCatalogueIdsQuery`, #121), keyed by the team: a team change can never narrow the new team by the old
  // one's catalogue (which would silently show an empty warehouse) — the component ref this replaces had to be
  // cleared by hand for that.
  return (
    <ProductPickerShell
      scopeTeamId={teamId}
      noTeamMessage={t("productPicker.noTeam")}
      loadKey={`own-stocked:${teamId}:${warehouseId}`}
      // The rows are what the building holds — read always fresh (HARD RULE 10).
      stocked
      load={async ({ page, q }) => {
        // A SEARCH is already a narrowing to my catalogue — ProductList only ever returns my products
        // — so it replaces the whole-catalogue resolve rather than intersecting with it.
        const resolved = await (q === ""
          ? client.fetchQuery(ownCatalogueIdsQuery(teamId))
          : client.fetchQuery(catalogueSearchQuery({ scopeTeamId: teamId, q, own: true })));

        // My catalogue is empty, or the search matched nothing in it. Either way there is nothing for
        // the warehouse to hold — and an empty `product_ids` would mean "the whole building".
        if (resolved.ids.length === 0) {
          return noMatches(resolved.capped);
        }

        return stockedPage({
          scopeTeamId: teamId,
          warehouseId,
          productIds: resolved.ids.slice(0, CATALOGUE_ID_LIMIT),
          page,
          capped: resolved.capped,
        });
      }}
      value={value}
      onChange={onChange}
      disabled={disabled}
      trigger={trigger}
    />
  );
}

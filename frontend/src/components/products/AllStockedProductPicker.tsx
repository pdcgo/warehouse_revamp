import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ProductPickerShell } from "./ProductPickerShell";
import { noMatches, searchCatalogueIds, stockedPage } from "./stockedSource";
import type { PickedProduct } from "./ProductSelect";

export interface AllStockedProductPickerProps {
  /** The team the call is AUTHORIZED as. Required — a browse must never widen because a team was
   * missing. */
  teamId: bigint;
  /**
   * The building whose shelves ARE the catalogue. REQUIRED BY THE TYPE, not by a comment: every
   * figure that makes a product pickable here — what is on the shelf, what it cost — is a fact about
   * ONE warehouse, so there is no meaningful call without it.
   */
  warehouseId: bigint;
  value: bigint[];
  onChange: (products: PickedProduct[]) => void;
  disabled?: boolean;
  trigger?: ReactNode;
}

export const description =
  "Multi-select picker over WHAT ONE WAREHOUSE HOLDS, whoever owns it (StockedProductList). Refuses to filter by ownership: an order draws whatever is on the shelf, so another team's goods sitting in this building are in the list like any other, with their owner on the row. Out-of-stock products never reach the dialog at all — paging happens in inventory_service, so the pager counts only what is really there. `warehouseId` is required by the type. Search still works: the term is resolved against the catalogue (ProductDiscover, capped) and handed to inventory as a narrowing, and the dialog says so when the cap bites. The READY badge rides along with the list rather than being read again.";

// "All" here is not a wider browse — it is the refusal to filter by ownership, which is the correct
// behaviour for selling: StockPick drains `stock_levels` for the warehouse regardless of which
// restock brought a unit in, so hiding stock the team does not "own" would refuse orders the building
// can plainly fill.
//
// ⚠ NO CALLER TODAY. The order form was this component's one mount and now uses AllProductPicker
// (owner): the browse is the catalogue and the warehouse's figures are columns on it, so a product
// the building has none of is VISIBLE at 0 rather than absent. This stays as the warehouse-as-
// catalogue member of the 2×2 above — the shape a screen wants when "not on the shelf" should mean
// "not offerable" — and its stories keep it honest until one does.
export function AllStockedProductPicker({
  teamId,
  warehouseId,
  value,
  onChange,
  disabled,
  trigger,
}: AllStockedProductPickerProps) {
  const { t } = useTranslation();

  return (
    <ProductPickerShell
      scopeTeamId={teamId}
      noTeamMessage={t("productPicker.noTeamAll")}
      loadKey={`all-stocked:${teamId}:${warehouseId}`}
      load={async ({ page, q }) => {
        if (q === "") {
          return stockedPage({ scopeTeamId: teamId, warehouseId, productIds: [], page, capped: false });
        }

        const { ids, capped } = await searchCatalogueIds({ scopeTeamId: teamId, q, own: false });

        // Nothing in the catalogue matched, so nothing in the warehouse can. Said HERE rather than
        // sent as an empty filter, which inventory reads as "no narrowing at all" — i.e. everything.
        if (ids.length === 0) {
          return noMatches(capped);
        }

        return stockedPage({ scopeTeamId: teamId, warehouseId, productIds: ids, page, capped });
      }}
      value={value}
      onChange={onChange}
      disabled={disabled}
      trigger={trigger}
    />
  );
}

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { productClient } from "../../api/clients";
import { productListRowData, productsFromList } from "../../features/products/adapt";
import { PAGE_SIZE, ProductPickerShell } from "./ProductPickerShell";
import { catalogueBadges } from "./pickerBadges";
import type { ReadyLens } from "./pickerBadges";
import type { PickedProduct } from "./ProductSelect";

export interface OwnProductPickerProps {
  /**
   * WHOSE catalogue. Required — this picker's whole identity is "one team's products", so there is no
   * unset case to widen into. A caller with no team yet passes 0n and gets the no-team state.
   */
  teamId: bigint;
  /**
   * Show READY stock from THIS warehouse. Stock is held per building (inventory_service owns it), so
   * there is no "total ready" to show and `teamId` cannot stand in for one — a selling team is not a
   * warehouse. Omit it and no ready figure is shown.
   */
  stockWarehouseId?: bigint;
  /** Which READY the badge means — see ReadyLens. "owned" is right when BUYING, which is what this
   * picker is normally used for. */
  readyLens?: ReadyLens;
  /** The ticked product ids. Re-seeds the draft every time the dialog opens. */
  value: bigint[];
  /** Applied on Confirm with the WHOLE ticked set. An empty array means "cleared". */
  onChange: (products: PickedProduct[]) => void;
  disabled?: boolean;
  trigger?: ReactNode;
}

export const description =
  "Multi-select picker over ONE TEAM'S CATALOGUE (ProductList) — searchable, paginated, laid out as a TABLE: product | on the way | ready stock, one tickable row each. `teamId` is required: this picker is \"my products\", so there is no unset case that widens to every team (use AllProductPicker for that). The two figures are columns rather than badges because this is the BUYING picker and buying is a comparison down a column — READY is what is on a shelf at `stockWarehouseId`, ONGOING is what is already ordered and not yet accepted, totalled across EVERY warehouse. A cell shows 0 for a real zero and \"—\" when the figure was never read. `readyLens` picks which READY: \"owned\" (default, what this team owns there) or \"available\" (what a pick would find). Ticks are a draft — Confirm applies them (an empty list clears), Cancel discards.";

// OwnProductPicker is the BUYING-side picker: the products this team sells, whether or not any
// warehouse currently holds them. That is the difference from OwnStockedProductPicker — a restock is
// precisely the act of ordering something the building does NOT have.
export function OwnProductPicker({
  teamId,
  stockWarehouseId,
  readyLens = "owned",
  value,
  onChange,
  disabled,
  trigger,
}: OwnProductPickerProps) {
  const { t } = useTranslation();

  return (
    <ProductPickerShell
      scopeTeamId={teamId}
      noTeamMessage={t("productPicker.noTeam")}
      loadKey={`own:${teamId}:${stockWarehouseId ?? 0n}:${readyLens}`}
      load={async ({ page, q }) => {
        const res = await productClient.productList({
          teamId,
          filter: { q },
          dataRequest: productListRowData(),
          page: { page, limit: PAGE_SIZE },
        });

        return {
          products: productsFromList(res.items, res.ids),
          total: Number(res.pageInfo?.totalItems ?? 0n),
        };
      }}
      loadBadges={catalogueBadges({ scopeTeamId: teamId, stockWarehouseId, readyLens })}
      // A TABLE, not a list of badges (owner). This is the BUYING picker, and buying is a comparison:
      // you scan down "what is already on the way" and "what is already here" across rows to decide
      // what to order. Badges make each row readable on its own and make the column unreadable.
      layout="table"
      value={value}
      onChange={onChange}
      disabled={disabled}
      trigger={trigger}
    />
  );
}

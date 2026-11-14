import { useTranslation } from "react-i18next";

import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { FilterField } from "../../components/chrome/FilterBar";
import { TeamSelect } from "../../components/teams/TeamSelect";

export const description =
  "A supplier list's warehouse filter — the suppliers whose goods were received at that warehouse, the ones whose page lists it under Gudang terkait. The shared warehouse search select in a filter slot; the list narrows on the server, its figures stay whole. Clearing it is 0n, any warehouse.";

// THE WAREHOUSE FILTER (owner: *"di sini ada filter gudang dan di suppliers juga sama, di kiri filter tim"*,
// `the-warehouse-filters-before-the-team`) — on Discover left of the team, on the supplier list where the team would be:
// the first picker after the search.
//
//   [⌕ Cari …] [Semua gudang ⌄] [Semua tim ⌄] …
//
// The orders list's warehouse filter, the same way: TeamSelect over WAREHOUSE teams — a search select, since the
// warehouses grow with the company. The page sends the pick as SupplierList's `warehouse_id`: only the rows narrow,
// Terjual and Siap stay the supplier's whole (`the-warehouse-filter-narrows-only-the-rows`).
//
// THE PICK IS ITS NAME ALONE (owner: *"select gudang tidak perlu badge di select activenya"*,
// `the-warehouse-filter-shows-its-name-alone`): every option is a warehouse, so a [Gudang] badge on the picked one says
// nothing the field does not. Its × clears it, as every filter's does.
export function SupplierWarehouseFilter({ value, onChange }: { value: bigint; onChange: (id: bigint) => void }) {
  const { t } = useTranslation();

  return (
    <FilterField w="15rem" testId="supplier-warehouse-filter">
      <TeamSelect
        teamType={TeamType.WAREHOUSE}
        value={value > 0n ? value : undefined}
        placeholder={t("suppliers.warehouseAll")}
        showType={false}
        onChange={onChange}
      />
    </FilterField>
  );
}

import { useTranslation } from "react-i18next";
import { Box, Flex } from "@chakra-ui/react";

import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { FilterField } from "../../components/chrome/FilterBar";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { NotImplemented } from "../pending/NotImplemented";
import { SUPPLIER_LIST_PENDING } from "./listPending";

export const description =
  "A supplier list's warehouse filter — the suppliers whose restocks are received at that warehouse. The shared warehouse search select in a filter slot, its ⚠ mark beside it: nothing narrows a list by it yet (`dropped`). Clearing it is 0n, any warehouse.";

// THE WAREHOUSE FILTER (owner: *"di sini ada filter gudang dan di suppliers juga sama, di kiri filter tim"*,
// `the-warehouse-filters-before-the-team`) — on Discover left of the team, on the supplier list where the team would be:
// the first picker after the search.
//
//   [⌕ Cari …] [Semua gudang ⌄] ⚠5 [Semua tim ⌄] …
//
// The orders list's warehouse filter, the same way: TeamSelect over WAREHOUSE teams — a search select, since the
// warehouses grow with the company — and the mark inside the slot, so the strip keeps its widths.
export function SupplierWarehouseFilter({ value, onChange }: { value: bigint; onChange: (id: bigint) => void }) {
  const { t } = useTranslation();

  return (
    <FilterField w="15rem" testId="supplier-warehouse-filter">
      <Flex align="center" gap="1">
        <Box flex="1" minW="0">
          <TeamSelect
            teamType={TeamType.WAREHOUSE}
            value={value > 0n ? value : undefined}
            placeholder={t("suppliers.warehouseAll")}
            onChange={onChange}
          />
        </Box>
        <NotImplemented list={SUPPLIER_LIST_PENDING} id="warehouse" />
      </Flex>
    </FilterField>
  );
}

import { useTranslation } from "react-i18next";
import { Box, Flex, Heading, Spacer, Stack, Text } from "@chakra-ui/react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { WarehouseStockList } from "../../features/inventory/WarehouseStockList";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { idCodec, useUrlState } from "../../lib/urlState";

// The warehouse pick before anybody has made one: the URL carries no `warehouse`, so the screen opens on the current
// team when it IS a warehouse. Never a real id (idCodec reads digits only) and never written to the URL.
const NOT_PICKED = -1n;

// InventoryPage is root and the admin team's INVENTORY (/inventory, #55): pick a warehouse, see what it holds, and adjust
// or move it. The list is WarehouseStockList — every product with a batch in that warehouse, any team's, at 0 too, each
// with its owner and its units on hand (the-stock-screen-lists-what-the-warehouse-has-held).
//
//   Inventory                                                                 [Gudang Pusat ⌄]
//   Every product this warehouse holds or has held — any team's, at 0 too.
//   [⌕ Search products by product code or name                ×]
//   Product code   · Product                 · Owner          · On hand · Actions
//
// A WAREHOUSE reads the same list as its own Products (a-warehouses-products-is-what-it-holds), with no picker — it is
// its own building — and rows that open the warehouse product page. The old Inventories ▸ Stock address forwards there
// (StockForward); it no longer renders this page.
export function InventoryPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  // Default to the current team when it IS a warehouse; otherwise the user picks one.
  //
  // THE WAREHOUSE LIVES IN THE URL (a-lists-filters-live-in-the-url) — a refresh opens the same warehouse's stock; the
  // search is the list's own. The pick is kept as an id with 0n for none, so a cleared picker survives a refresh too;
  // this page's "no warehouse" is still `undefined` (it shows the pick-a-warehouse prompt instead of reading warehouse 0).
  //
  // The default is read on EVERY render, not once at mount: the current team arrives after the page mounts on a fresh
  // load (TeamProvider loads the memberships), and a default taken at mount read "no team" — a warehouse's own Admin
  // was asked to pick a warehouse.
  const [warehousePick, setWarehousePick] = useUrlState("warehouse", NOT_PICKED, idCodec);
  const ownWarehouse = current?.teamType === TeamType.WAREHOUSE ? current.teamId : 0n;
  const pick = warehousePick === NOT_PICKED ? ownWarehouse : warehousePick;
  const warehouseId = pick === 0n ? undefined : pick;

  return (
    <Stack gap="section" data-testid="inventory-page">
      <Flex align="start" gap="card" wrap="wrap">
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <Heading size="md">{t("inventory.title")}</Heading>
          <Text color="fg.muted" fontSize="sm">
            {t("inventory.stockLead")}
          </Text>
        </Stack>
        <Spacer />
        <Box minW="14rem">
          <TeamSelect
            value={warehouseId}
            teamType={TeamType.WAREHOUSE}
            showType={false}
            // A cleared picker emits 0n — kept as the pick, read as "no warehouse" above. The list starts again at page
            // one for another building on its own.
            onChange={setWarehousePick}
            placeholder={t("inventory.pickWarehousePlaceholder")}
          />
        </Box>
      </Flex>

      {warehouseId === undefined ? (
        <Text color="fg.muted" data-testid="inventory-pick-warehouse">
          {t("inventory.pickWarehousePrompt")}
        </Text>
      ) : (
        <WarehouseStockList warehouseId={warehouseId} />
      )}
    </Stack>
  );
}

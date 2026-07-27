import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Button, Flex, HStack, Icon, Input, Separator, Spacer, Stack, Tabs, Text } from "@chakra-ui/react";
import { Archive, Package } from "lucide-react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { TeamSelect } from "../../components/TeamSelect";
import { useProductStats } from "../../features/products/queries";
import { ProductStats } from "./components/ProductStats";
import { ProductsTable } from "./components/ProductsTable";

// ProductsPage lists the CURRENT TEAM's catalogue. Every RPC carries `current.teamId` in its body —
// the team is the scope, and a selling/warehouse team only ever sees its own products. Create and
// edit are a dedicated PAGE (issue #60), reached from here.
//
// A selling team gets two tabs: ACTIVE and ARCHIVED. Archiving is a soft delete that already existed
// (`deleted` on the row) but had nowhere to be seen — those products were unreachable forever, and
// any stock still sitting under them with it. A tab makes them visible and restorable, and is why
// every word on this screen now says Archive rather than Delete: the row is not gone.
//
// A WAREHOUSE gets neither tab. It owns no products, so it has nothing to archive — what it sees is
// the arrangement of other teams' goods on its shelves, which is a different RPC (see useProducts).
export function ProductsPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;

  // The search is ABOVE the tabs and shared by both, because "find KPH-L-001" is one question about
  // the catalogue, not two about two lists. Typing it, finding nothing, and switching tab with the
  // term still in the box is how you discover the product you were looking for was archived.
  const [q, setQ] = useState("");

  // The WAREHOUSE lens. 0n = all of them.
  //
  // It is not a row filter — it does not remove products from your catalogue, because the catalogue
  // is yours wherever the goods sit. It changes what every stock figure MEANS: ready, reserved,
  // ongoing, the cost range and the oldest batch become that one warehouse's, and the column headers
  // say so. Stock is held per warehouse, so a total is only ever an answer to "everywhere".
  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  // Just for the labels — a cache hit on the list TeamSelect has already loaded.
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100, enabled: !isWarehouse });
  const warehouseName =
    warehouseId === 0n
      ? undefined
      : warehouses.data?.teams.find((w) => w.id === warehouseId)?.name;

  // The stat row describes the CATALOGUE, so it lives here — above the tabs, outside both tables.
  // Its own query for the same reason: switching to Archived or searching changes which rows you
  // are looking at, and must not change what the headline says you own. The warehouse lens DOES
  // reach it, because "ready stock" narrowed to one building is still a fact about the catalogue.
  const stats = useProductStats({
    teamId: isWarehouse ? undefined : current?.teamId,
    warehouseId,
  });

  // No current team means there is no scope to list against — the whole page is meaningless.
  if (!current) {
    return (
      <Stack gap="section">
        <Text color="fg.muted" data-testid="products-no-team">
          {t("products.noTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {/* No heading and no team badge: the shell's breadcrumb already reads "Dev Selling › My
          Product", so both were the same two words a second time, pushing the numbers down the
          page for nothing. */}
      <Flex align="center" gap="card">
        <Spacer />
        {/* A warehouse team stocks products but does not create them (#101) — no create action. */}
        {!isWarehouse && (
          <Button
            size="xs"
            colorPalette="brand"
            data-testid="open-create-product"
            onClick={() => navigate("/products/new")}
          >
            {t("products.newProduct")}
          </Button>
        )}
      </Flex>

      {/* The warehouse list is somebody else's catalogue on our shelves — a product count is not the
          headline there, and the stock figures it would want are the ones its own screens show. */}
      {!isWarehouse && (
        <>
          <ProductStats
            totalItems={stats.data?.activeProducts ?? 0}
            ready={stats.data?.ready}
            ongoing={stats.data?.ongoing}
            lastOrderUnix={stats.data?.lastOrderUnix}
            lastRestockUnix={stats.data?.lastRestockUnix}
            warehouseName={warehouseName}
          />
          {/* The headline numbers describe the catalogue; everything below is one list of it. The
              rule says which is which — without it the stats read as a caption on the Active tab. */}
          <Separator />
        </>
      )}

      {/* No search for a warehouse (#142): WarehouseProductList takes no query, so the box would
          look like a working control and do nothing. A dead input is worse than an absent one. */}
      {!isWarehouse && (
        <HStack gap="card" align="center" flexWrap="wrap">
          <Input
            maxW="sm"
            placeholder={t("products.searchPlaceholder")}
            value={q}
            data-testid="product-search"
            onChange={(e) => setQ(e.target.value)}
          />

          {/* The shared team picker, restricted to WAREHOUSE teams (filtered server-side by
              TeamList) — not a second warehouse dropdown of this page's own. */}
          <Box minW="16rem" data-testid="product-warehouse-filter">
            <TeamSelect
              value={warehouseId}
              onChange={setWarehouseId}
              teamType={TeamType.WAREHOUSE}
              placeholder={t("products.allWarehouses")}
            />
          </Box>
          {/* No separate "clear" button — TeamSelect carries its own ✕, and a second control saying
              the same thing is how two ways of doing one thing start behaving differently. */}
        </HStack>
      )}

      {isWarehouse ? (
        <ProductsTable mode="warehouse" teamId={current.teamId} q="" warehouseId={0n} />
      ) : (
        // lazyMount + unmountOnExit: only the visible tab's table is mounted, so exactly one product
        // list is fetched and the shared `products-table` testid is never duplicated.
        <Tabs.Root defaultValue="active" lazyMount unmountOnExit>
          <Tabs.List>
            <Tabs.Trigger value="active" data-testid="products-tab-active">
              <Icon as={Package} boxSize="4" />
              {t("products.tab.active")}
            </Tabs.Trigger>
            <Tabs.Trigger value="archived" data-testid="products-tab-archived">
              <Icon as={Archive} boxSize="4" />
              {t("products.tab.archived")}
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="active">
            <ProductsTable mode="active" teamId={current.teamId} q={q} warehouseId={warehouseId} warehouseName={warehouseName} />
          </Tabs.Content>
          <Tabs.Content value="archived">
            <ProductsTable mode="archived" teamId={current.teamId} q={q} warehouseId={warehouseId} warehouseName={warehouseName} />
          </Tabs.Content>
        </Tabs.Root>
      )}
    </Stack>
  );
}

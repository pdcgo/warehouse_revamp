import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Flex, Heading, Icon, Spinner, Stack, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft, Boxes, ClipboardList, ListChecks } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { useTeam } from "../../features/team/TeamContext";
import { bulkPickAnswerOf, bulkPickIdsOf, groupByOrder, groupByProduct } from "../../features/picking/bulkPick";
import { useBulkPick } from "../../features/picking/queries";
import { NO_SHOPS, useShopsByIds } from "../../features/shops/queries";
import { useIsMobile } from "../../layouts/shell";
import { cameFrom, fromHere } from "../../lib/cameFrom";
import { oneOfCodec, useUrlState } from "../../lib/urlState";
import { ByOrderView } from "./components/ByOrderView";
import { ByProductView } from "./components/ByProductView";

type BulkPickView = "product" | "order";
const VIEW_CODEC = oneOfCodec<BulkPickView>(["product", "order"]);

/** Where Back goes when the page was reached by a link: the list's Dikonfirmasi tab. */
const LIST_CONFIRMED = "/warehouse-orders?step=confirm";

// BulkPickPage — `/warehouse-orders/bulk-pick?ids=103,104,…` (the-bulk-pick-list-prototype-is-accepted, acceptance
// inventory/order.md *bulk pick order*): the goods of the orders ticked on the Dikonfirmasi tab, gathered for ONE walk of
// the racks. Opened by the bulk bar's Daftar Ambil (pages/pick-queue).
//
//   · ITS READ (useBulkPick): OrderPickLines — the ids' orders that ship from this warehouse, with their takes and lines,
//     no money — then StockPickLocations for every take at once; the shops' names from ShopByIds. The contract is
//     written at the head of `features/picking/bulkPick.ts`. An id that is not this building's is simply not listed.
//   · TWO VIEWS, as line tabs under the title (a-page-picks-its-view-over-its-filters): Per Produk — each product with
//     its total and its racks, each rack's quantity — and Per Pesanan — each order with its products and racks. Only the
//     open one is mounted; the pick is kept in the address (`view=order`), as a list's filters are
//     (a-lists-filters-live-in-the-url), and the ids are the page's one address, as Cetak Label's are.
//   · A READ: it moves no status — the orders stay Dikonfirmasi, and each parcel is still checked by its item scan on its
//     own pick page before Sudah diambil (the-item-scans-live-on-the-page). The page says so, and offers no move.
//   · The racks are the ones each take already drew from (the-placement-page-reads-racks-by-transaction-id); the list
//     names them and nobody confirms them (a-wrong-rack-pick-waits-for-the-count).
//   · No print: the single pick page has none, and the printed paper is the shipping label (order_clarify, the owner's
//     correction) — accepted without one (the-bulk-pick-list-prototype-is-accepted).
export function BulkPickPage() {
  const { current } = useTeam();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const mobile = useIsMobile();

  const [view, setView] = useUrlState<BulkPickView>("view", "product", VIEW_CODEC);
  const ids = useMemo(() => bulkPickIdsOf(location.search), [location.search]);
  // EVERY WAY OUT GOES WHERE THE PAGE WAS OPENED (a-form-returns-where-it-was-opened) — the list with its tab and
  // filters; the Dikonfirmasi tab when reached by a link. Read once: the view's own writes replace the address.
  const [openedFrom] = useState(() => cameFrom(location));

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;
  const query = useBulkPick({ warehouseId, ids });
  const shops = useShopsByIds({ shopIds: (query.data?.orders ?? []).map((order) => order.shopId) }).data ?? NO_SHOPS;

  const answer = useMemo(
    () => (query.data ? bulkPickAnswerOf(query.data.orders, query.data.locations, shops) : undefined),
    [query.data, shops],
  );
  const products = useMemo(() => (answer ? groupByProduct(answer) : []), [answer]);
  const picks = useMemo(() => (answer ? groupByOrder(answer) : []), [answer]);
  const units = picks.reduce((n, pick) => n + pick.units, 0);
  const loading = query.isPending && warehouseId !== undefined && ids.length > 0;
  const error = query.isError ? rpcError(query.error) : "";

  const back = (
    <Button
      size="xs"
      variant="ghost"
      alignSelf="flex-start"
      onClick={() => navigate(openedFrom ?? LIST_CONFIRMED)}
      data-testid="bulk-pick-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {t("picking.detail.back")}
    </Button>
  );

  if (!current || !isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("bulkPick.title")}</Heading>
        <Text color="fg.muted" data-testid="bulk-pick-not-warehouse">
          {t(current ? "picking.warehouseOnly" : "picking.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Stack gap="section">
        {back}
        <Spinner colorPalette="brand" data-testid="bulk-pick-loading" />
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack gap="section">
        {back}
        <Text color="error.fg" data-testid="bulk-pick-error">
          {error}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" animationStyle="enter" data-testid="bulk-pick-page">
      {back}

      <Flex align="center" gap="card" wrap="wrap" rowGap="1">
        <Heading size="md" data-testid="bulk-pick-title">
          {t("bulkPick.title")}
        </Heading>
        {picks.length > 0 && (
          <Badge colorPalette="brand" data-testid="bulk-pick-count">
            {t("bulkPick.summary", { count: picks.length, units })}
          </Badge>
        )}
      </Flex>

      {picks.length === 0 ? (
        <EmptyHint
          icon={ClipboardList}
          title={t("bulkPick.empty.title")}
          description={t("bulkPick.empty.hint")}
          action={
            <Button size="xs" variant="outline" data-testid="bulk-pick-empty-back" onClick={() => navigate(openedFrom ?? LIST_CONFIRMED)}>
              <Icon as={ArrowLeft} boxSize="4" />
              {t("picking.detail.back")}
            </Button>
          }
          testId="bulk-pick-empty"
        />
      ) : (
        <Tabs.Root
          value={view}
          onValueChange={(e) => setView(e.value as BulkPickView)}
          // Only the open view is mounted — never both lists at once.
          lazyMount
          unmountOnExit
          data-testid="bulk-pick-tabs"
        >
          <Stack gap="section">
            <Tabs.List data-testid="bulk-pick-views">
              <Tabs.Trigger value="product" flexShrink="0" data-testid="bulk-pick-view-product">
                <Icon as={Boxes} boxSize="4" />
                {t("bulkPick.view.product")}
              </Tabs.Trigger>
              <Tabs.Trigger value="order" flexShrink="0" data-testid="bulk-pick-view-order">
                <Icon as={ListChecks} boxSize="4" />
                {t("bulkPick.view.order")}
              </Tabs.Trigger>
              <Tabs.Indicator />
            </Tabs.List>

            {/* THE ORDERS STAY DIKONFIRMASI — said where the crew reads it, since nothing on the page moves them. */}
            <Alert.Root status="info" size="sm" data-testid="bulk-pick-stays-note">
              <Alert.Indicator />
              <Alert.Description>{t("bulkPick.staysNote")}</Alert.Description>
            </Alert.Root>

            <Tabs.Content value="product" p="0">
              <ByProductView products={products} mobile={mobile} />
            </Tabs.Content>
            <Tabs.Content value="order" p="0">
              <ByOrderView
                picks={picks}
                mobile={mobile}
                onOpen={(orderId) => navigate(`/warehouse-orders/${orderId}`, { state: fromHere(location) })}
              />
            </Tabs.Content>
          </Stack>
        </Tabs.Root>
      )}
    </Stack>
  );
}

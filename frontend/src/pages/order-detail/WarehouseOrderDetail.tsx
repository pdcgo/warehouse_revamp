import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Flex, Heading, Icon, IconButton, Spacer, Stack, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft, Ban, PackageCheck, PackageSearch, Undo2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useOrder, useCancelOrder } from "../../features/orders/queries";
import { SettlementTab } from "./components/SettlementTab";
import { useActors } from "../../features/users/queries";
import { OrderStatusBadge } from "../../components/badges/OrderStatusBadge";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { CompactActions } from "../../components/chrome/CompactActions";
import { toaster } from "../../components/feedback/Toaster";
import { InfoPanel } from "./components/InfoPanel";
import { NotesSection, noteWriter } from "./components/NotesSection";
import { TimelinePanel } from "./components/TimelinePanel";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { useOpenReturnAccept } from "../../features/orders/returnAccept";
import { canForceReturn, useForceReturn } from "../../features/orders/useForceReturn";
import { useOrderTags } from "../../features/orders/tags/tagQueries";
import { tagsOfOrder } from "../../features/orders/tags/orderTags";
import { OrderTagsBox } from "../../features/orders/tags/OrderTagsBox";
import { ReportFoundFromOrderDialog } from "../../features/inventory/ReportFoundFromOrderDialog";
import { canReportFound } from "../../lib/roles";
import { useIsMobile } from "../../layouts/shell";

function parseOrderId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// OrderDetailPage is the read-only detail route for an order (#68) — a PAGE, not a dialog. It shows
// the customer, status, shipping, the frozen money totals, the line items and the order's history,
// scoped to the current team via OrderDetail.
export function WarehouseOrderDetailPage() {
  const { t } = useTranslation();
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  // A PHONE READS THE TABS ACROSS THE TOP (backlog #104). Before the early returns: a hook may not be conditional.
  const mobile = useIsMobile();

  const id = parseOrderId(orderId);
  const teamId = current?.teamId;

  const query = useOrder({ teamId, orderId: id });
  const cancelMutation = useCancelOrder();
  // THE RETURN, from the warehouse's side (a-return-is-received-by-search-then-forced, A): Force Return for an order that
  // left the building, confirmed — then the order re-reads in `return` and Accept Return is offered, as on the pick screen.
  const forceReturn = useForceReturn({ teamId });
  // …and Accept Return opens its page (the-return-accept-page-is-accepted).
  const openReturnAccept = useOpenReturnAccept();
  // A LOST ORDER'S PARCEL, FOUND (a-found-lost-parcel-is-a-found-stock-in): Report Found, prefilled with the order — as on
  // the pick page.
  const [reportingFound, setReportingFound] = useState(false);
  // On a phone Cancel is an icon (CompactActions), so its confirm is opened from here rather than from its own trigger.
  const [cancelling, setCancelling] = useState(false);
  const order = query.data ?? null;
  // THE ORDER'S TAGS (backlog #100): the Info tab's Tag card — the warehouse sees and tags the same set the selling team
  // does, when it is the warehouse shipping the order (useOrderTags).
  const tagsApi = useOrderTags(order ?? undefined);
  const loading = query.isPending && id !== 0n;

  // THE PEOPLE ON THE TIMELINE AND IN THE NOTES. The ids come from the timeline rows — a note is one too
  // (a-note-is-a-timeline-row) — and the order row itself records no actor at all. Deduplicated into one
  // lookup: the same person often takes several steps and writes several notes.
  const actors = useActors(order?.timelineLogs.map((log) => log.actorId) ?? []);

  // Names an actor the lookup could not resolve. 0 is "not recorded" — every event backfilled by
  // 00011 is in that state — and gets nothing, because inventing a name there would be worse than the
  // gap. A set-but-unresolved id names its number, exactly as an unresolved rack does.
  function actorFallback(userId: bigint): string {
    if (userId === 0n) return "";

    return actors.data?.get(userId.toString())
      ? ""
      : t("orders.timeline.userRef", { id: userId.toString() });
  }

  // A malformed id never reaches the server (the query is disabled for it), so its message comes
  // from here rather than from an error no request produced.
  const error =
    id === 0n ? t("orders.invalidOrderId") : query.isError ? rpcError(query.error) : "";

  // Cancel INVALIDATES rather than writing the response into local state: the status it changes is also
  // a column in the orders list, and setting it here would leave that list holding the previous value
  // until its own cache lapsed. Pressing back would show an order still PLACED that had just been
  // cancelled. Invalidating also re-reads the history, so the new step appears on the Timeline tab.
  //
  // Cancel is terminal, so it goes through the ConfirmDialog. On error we surface a toast and let the
  // dialog close; the status simply stays as it was.
  async function cancelOrder() {
    if (teamId === undefined || !order) return;

    try {
      await cancelMutation.mutateAsync({ teamId, orderId: order.id });
      toaster.create({ type: "success", title: t("orders.orderCancelled") });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orders.title")}</Heading>
        <Text color="fg.muted" data-testid="order-detail-no-team">
          {t("orders.selectTeamView")}
        </Text>
      </Stack>
    );
  }

  // The page's shape while the order loads, not a spinner on an empty page (motion-is-small-quick-and-shared).
  if (loading) {
    return <ListSkeleton heading testId="order-detail-loading" />;
  }

  if (error || !order) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="order-detail-back"
          onClick={() => navigate("/orders")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("orders.backToOrders")}
        </Button>
        <Text color="error.fg" data-testid="order-detail-error">
          {error || t("orders.orderNotFound")}
        </Text>
      </Stack>
    );
  }

  const cancellable = order.status === OrderStatus.PENDING && canWrite(current);
  const forceable = canForceReturn(order.status) && canWrite(current);
  const acceptable = order.status === OrderStatus.RETURN && canWrite(current);
  const reportable =
    order.status === OrderStatus.LOST && order.warehouseId === current.teamId && canWrite(current) &&
    canReportFound(current.role);

  return (
    // The page arrives — a fade and a short rise (`motion-is-small-quick-and-shared`).
    <Stack gap="section" animationStyle="enter" data-testid="order-detail-page">
      {/* ON A PHONE THE HEADER IS ONE ROW (backlog #105, the-phone-header-is-one-row): back as its icon, the number, the
          status, the actions — as the seller's order page and the rack, batch and restock pages draw theirs. A labelled
          back button over the title and a labelled action beside it took two rows. The actions are their ICONS
          (a-phone-header-action-is-an-icon, CompactActions): each keeps its desktop test id and is named by its label;
          the four never meet (pending, on its way, return, lost), so the row holds one at most. The desktop below is
          unchanged. A JS breakpoint, never CSS hiding. */}
      {mobile ? (
        <Flex align="center" gap="2" minW="0">
          <IconButton
            size="sm"
            variant="ghost"
            flexShrink={0}
            aria-label={t("orders.backToOrders")}
            title={t("orders.backToOrders")}
            data-testid="order-detail-back"
            onClick={() => navigate("/orders")}
          >
            <Icon as={ArrowLeft} boxSize="4" />
          </IconButton>
          {/* The number and its status take what the back arrow and the actions leave; at 320px a long number is cut
              before anything runs past the edge (nothing-runs-past-a-phones-edge). */}
          <Flex align="center" gap="2" flex="1" minW="0">
            <Heading size="md" truncate minW="0" data-testid="order-detail-title">
              {t("orders.orderTitle", { id: order.id.toString() })}
            </Heading>
            <OrderStatusBadge status={order.status} />
          </Flex>
          <CompactActions
            menuLabel={t("orders.actions")}
            actions={[
              cancellable && {
                id: "cancel",
                label: t("orders.cancelOrder"),
                icon: Ban,
                danger: true,
                testId: "order-cancel",
                onClick: () => setCancelling(true),
              },
              forceable && {
                id: "forceReturn",
                label: t("picking.action.forceReturn"),
                icon: Undo2,
                danger: true,
                disabled: forceReturn.busy,
                testId: "order-force-return",
                onClick: () => forceReturn.ask({ id: order.id, status: order.status }),
              },
              acceptable && {
                id: "acceptReturn",
                label: t("picking.action.acceptReturn"),
                icon: PackageCheck,
                primary: true,
                testId: "order-accept-return",
                onClick: () => openReturnAccept(order.id),
              },
              reportable && {
                id: "reportFound",
                label: t("picking.action.reportFound"),
                icon: PackageSearch,
                testId: "order-report-found",
                onClick: () => setReportingFound(true),
              },
            ]}
          />
          {cancellable && (
            <ConfirmDialog
              open={cancelling}
              onOpenChange={setCancelling}
              title={t("orders.cancelOrder")}
              message={t("orders.cancelMessage", { id: order.id.toString() })}
              confirmLabel={t("orders.cancelOrder")}
              onConfirm={cancelOrder}
            />
          )}
        </Flex>
      ) : (
        <>
          <Button
            size="xs"
            variant="ghost"
            alignSelf="flex-start"
            data-testid="order-detail-back"
            onClick={() => navigate("/orders")}
          >
            <Icon as={ArrowLeft} boxSize="4" />
            {t("orders.backToOrders")}
          </Button>

          {/* The header sits ABOVE the tabs, and stays put whichever one is open. The number, the status
              and the two actions are properties of the ORDER, not of a section of it — an action that
              moves the order would be strange to find filed under "Info". */}
          <Flex align="center" gap="card">
            <Heading size="md" data-testid="order-detail-title">
              {t("orders.orderTitle", { id: order.id.toString() })}
            </Heading>
            <OrderStatusBadge status={order.status} />
            <Spacer />

            {/* NO CONFIRM BUTTON HERE ANY MORE (owner). Confirming is the WAREHOUSE accepting the job, and
                it happens on that team's order screen — this seat can no longer do it, and the RPC would
                refuse it anyway: OrderStatusChange lets only the order's warehouse move pending → processed.

                The status still reads PENDING here until the building acts, which is the honest thing for
                this screen to show: it is waiting on somebody else. Cancel stays — calling an order off is
                still this team's decision, from PENDING only: a processed or picked order is handed back to
                pending by the warehouse first (who-may-cancel-a-pending-order). */}

            {cancellable && (
              <ConfirmDialog
                title={t("orders.cancelOrder")}
                message={t("orders.cancelMessage", { id: order.id.toString() })}
                confirmLabel={t("orders.cancelOrder")}
                onConfirm={cancelOrder}
                trigger={
                  <Button variant="outline" colorPalette="error" data-testid="order-cancel">
                    <Icon as={Ban} boxSize="4" />
                    {t("orders.cancel")}
                  </Button>
                }
              />
            )}

            {forceable && (
              <Button
                variant="outline"
                colorPalette="error"
                loading={forceReturn.busy}
                onClick={() => forceReturn.ask({ id: order.id, status: order.status })}
                data-testid="order-force-return"
              >
                <Icon as={Undo2} boxSize="4" />
                {t("picking.action.forceReturn")}
              </Button>
            )}

            {acceptable && (
              <Button colorPalette="brand" onClick={() => openReturnAccept(order.id)} data-testid="order-accept-return">
                <Icon as={PackageCheck} boxSize="4" />
                {t("picking.action.acceptReturn")}
              </Button>
            )}

            {/* A LOST ORDER'S PARCEL TURNED UP HERE — back in stock as a found naming the order; the order stays lost. */}
            {reportable && (
              <Button variant="outline" onClick={() => setReportingFound(true)} data-testid="order-report-found">
                <Icon as={PackageSearch} boxSize="4" />
                {t("picking.action.reportFound")}
              </Button>
            )}
          </Flex>
        </>
      )}

      {forceReturn.dialog}
      {order.status === OrderStatus.LOST && order.warehouseId === current.teamId && (
        <ReportFoundFromOrderDialog
          key={order.id.toString()}
          warehouseId={current.teamId}
          orderId={order.id}
          lines={order.items.map((i) => ({
            productId: i.productId,
            productCode: i.productCode,
            name: i.name,
            quantity: i.quantity,
          }))}
          open={reportingFound}
          onOpenChange={setReportingFound}
        />
      )}

      {/* VERTICAL tabs down the left, content beside them (owner) — the same shape the product, rack,
          batch and restock detail pages use, because they are the same kind of screen: one record,
          read section by section.
          Info first because it is WHAT THE ORDER IS, and it is where the lines live: the warehouse
          opens an order to pick it, and its pick list is those lines. Timeline second because it is
          what has happened to it so far.

          ON A PHONE THE TABS GO ACROSS THE TOP (backlog #104), as the order detail's preview does
          (the-ledger-is-blocks-on-a-phone): beside the panel the list left every card ~190px wide — Tambah Catatan ran
          past its card and the Tags hint was cut. The row is one line that scrolls sideways and a tab never shrinks
          (nothing-runs-past-a-phones-edge), as the warehouse's order list's status tabs do. The page keeps its tabs —
          the warehouse keeps the tabbed detail (the-detail-preview-became-the-order-detail). A JS breakpoint, never
          CSS hiding; every phone-only prop is `undefined` on a desktop, so the desktop draws exactly as before. */}
      <Tabs.Root
        defaultValue="info"
        orientation={mobile ? "horizontal" : "vertical"}
        data-testid="order-detail-tabs"
      >
        <Tabs.List
          minW={mobile ? undefined : "40"}
          flexWrap={mobile ? "nowrap" : undefined}
          overflowX={mobile ? "auto" : undefined}
          overflowY={mobile ? "hidden" : undefined}
          maxW={mobile ? "full" : undefined}
        >
          <Tabs.Trigger
            value="info"
            flexShrink={mobile ? 0 : undefined}
            whiteSpace={mobile ? "nowrap" : undefined}
            data-testid="order-detail-tab-info"
          >
            {t("orders.detail.tab.info")}
          </Tabs.Trigger>
          <Tabs.Trigger
            value="timeline"
            flexShrink={mobile ? 0 : undefined}
            whiteSpace={mobile ? "nowrap" : undefined}
            data-testid="order-detail-tab-timeline"
          >
            {t("orders.detail.tab.timeline")}
          </Tabs.Trigger>
          {/* THIRD, and last, because it is the money AFTER the fact — the order exists and has
              happened before the marketplace pays anything against it
              (order-detail-manages-the-ledger). */}
          <Tabs.Trigger
            value="settlement"
            flexShrink={mobile ? 0 : undefined}
            whiteSpace={mobile ? "nowrap" : undefined}
            data-testid="order-detail-tab-settlement"
          >
            {t("orders.detail.tab.settlement")}
          </Tabs.Trigger>
          {/* The line slides down the list to the picked tab, and the panel fades in (motion-is-small-quick-and-shared). */}
          <Tabs.Indicator />
        </Tabs.List>

        {/* minW="0" ON EVERY PANEL. A vertical Tabs.Root is a flex ROW, and a flex child defaults to
            min-width:auto — it refuses to shrink below its content, so the wide line table inside does
            not overflow its panel, it WIDENS it, and the whole page gains a horizontal scrollbar. The
            table's own scroll area can only work once the panel is allowed to be narrower than what it
            holds. */}
        <Tabs.Content value="info" flex="1" minW="0" animationStyle="swap">
          {/* The warehouse writes notes too — with ITS team id, which the server records as `from = warehouse`:
              "stok kosong di Rak A" is the building telling the seller something. */}
          <InfoPanel
            order={order}
            teamId={teamId}
            tags={<OrderTagsBox orderId={order.id} tags={tagsOfOrder(order)} api={tagsApi} />}
            notes={
              <NotesSection
                key={order.id.toString()}
                teamId={noteWriter(teamId, order)}
                orderId={order.id}
                logs={order.timelineLogs}
                actors={actors.data}
              />
            }
          />
        </Tabs.Content>

        <Tabs.Content value="timeline" flex="1" minW="0" animationStyle="swap">
          <TimelinePanel order={order} actors={actors.data} actorFallback={actorFallback} />
        </Tabs.Content>

        {/* The four values passed down are the ones settlement is forbidden to know — it never sees
            the marketplace reference, and the names and goodsCost belong to selling_service. This page
            already holds all of them. */}
        <Tabs.Content value="settlement" flex="1" minW="0" animationStyle="swap">
          <SettlementTab
            orderId={order.id}
            shopId={order.shopId}
            orderRef={order.orderExternalRefId || String(order.id)}
          />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

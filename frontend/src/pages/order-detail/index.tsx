import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Flex, Heading, Icon, Spacer, Spinner, Stack, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft, Ban } from "lucide-react";
import { rpcError } from "../../api/clients";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useOrder, useCancelOrder } from "../../features/orders/queries";
import { useActors } from "../../features/users/queries";
import { OrderStatusBadge } from "../../components/badges/OrderStatusBadge";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { InfoPanel } from "./components/InfoPanel";
import { TimelinePanel } from "./components/TimelinePanel";

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
export function OrderDetailPage() {
  const { t } = useTranslation();
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();

  const id = parseOrderId(orderId);
  const teamId = current?.teamId;

  const query = useOrder({ teamId, orderId: id });
  const cancelMutation = useCancelOrder();

  const order = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  // THE PEOPLE ON THE TIMELINE. The ids come from the EVENTS (00011) — the order row itself records no
  // actor at all, which is precisely why the history had to become a table before this tab could exist.
  // Deduplicated into one lookup: the same person often takes several steps.
  const actors = useActors(order?.events.map((event) => event.actorUserId) ?? []);

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

  if (loading) {
    return <Spinner colorPalette="brand" />;
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
        <Text color="red.fg" data-testid="order-detail-error">
          {error || t("orders.orderNotFound")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="order-detail-page">
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
            refuse it anyway now that OrderConfirm is scoped to the order's warehouse.

            The status still reads PLACED here until the building acts, which is the honest thing for
            this screen to show: it is waiting on somebody else. Cancel stays — calling an order off is
            still this team's decision, right up until the goods leave the building. */}

        {(order.status === OrderStatus.PLACED || order.status === OrderStatus.CONFIRMED) && (
          <ConfirmDialog
            title={t("orders.cancelOrder")}
            message={t("orders.cancelMessage", { id: order.id.toString() })}
            confirmLabel={t("orders.cancelOrder")}
            onConfirm={cancelOrder}
            trigger={
              <Button variant="outline" colorPalette="red" data-testid="order-cancel">
                <Icon as={Ban} boxSize="4" />
                {t("orders.cancel")}
              </Button>
            }
          />
        )}
      </Flex>

      {/* VERTICAL tabs down the left, content beside them (owner) — the same shape the product, rack,
          batch and restock detail pages use, because they are the same kind of screen: one record,
          read section by section.
          Info first because it is WHAT THE ORDER IS, and it is where the lines live: the warehouse
          opens an order to pick it, and its pick list is those lines. Timeline second because it is
          what has happened to it so far. */}
      <Tabs.Root defaultValue="info" orientation="vertical" data-testid="order-detail-tabs">
        <Tabs.List minW="40">
          <Tabs.Trigger value="info" data-testid="order-detail-tab-info">
            {t("orders.detail.tab.info")}
          </Tabs.Trigger>
          <Tabs.Trigger value="timeline" data-testid="order-detail-tab-timeline">
            {t("orders.detail.tab.timeline")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* minW="0" ON EVERY PANEL. A vertical Tabs.Root is a flex ROW, and a flex child defaults to
            min-width:auto — it refuses to shrink below its content, so the wide line table inside does
            not overflow its panel, it WIDENS it, and the whole page gains a horizontal scrollbar. The
            table's own scroll area can only work once the panel is allowed to be narrower than what it
            holds. */}
        <Tabs.Content value="info" flex="1" minW="0">
          <InfoPanel order={order} teamId={teamId} />
        </Tabs.Content>

        <Tabs.Content value="timeline" flex="1" minW="0">
          <TimelinePanel order={order} actors={actors.data} actorFallback={actorFallback} />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Flex,
  Heading,
  Icon,
  Spacer,
  Spinner,
  Stack,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Ban, Pencil } from "lucide-react";
import { rpcError } from "../../api/clients";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamDetail } from "../../features/teams/queries";
import { useSupplier } from "../../features/suppliers/queries";
import {
  useCancelRestockRequest,
  useRestockActors,
  useRestockRequest,
} from "../../features/restock/queries";
import { askedQuantity, receivedQuantity } from "../../features/restock/summary";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { toaster } from "../../components/feedback/Toaster";
import { InfoPanel } from "./components/InfoPanel";
import { ProductsPanel } from "./components/ProductsPanel";
import { TimelinePanel } from "./components/TimelinePanel";

function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// RestockSellingDetailPage — ONE RESTOCK AS THE BUYER SEES IT (#105/#125).
//
// The detail half of the split the list started: what this page owes its reader is the PURCHASE —
// who it was bought from, what was agreed, what it cost, and whether what arrived matched what was
// paid for. The warehouse's copy (RestockWarehouseDetailPage) answers a different question entirely.
//
// What that buys, beyond the columns: every gate that used to read "am I the requester?" is gone.
// On this page you always are — RestockRequestDetail is scoped to the requester AND the target
// warehouse, and a selling team is never a warehouse target — so Edit and Cancel are gated on the
// STATUS alone (#131), which is the only thing that actually varies.
//
// THREE TABS, and the split is by the QUESTION being asked, not by how much fits on a screen:
//
//   Info      — what was agreed, and with whom. The terms of the purchase.
//   Product   — what was ordered, what arrived, what it cost.
//   Timeline  — who did what, and when.
//
// Vertically, down the left (#198) — the same shape the rack, batch and warehouse-product details
// use, because they are the same kind of screen: one record, read section by section. What stays
// OUTSIDE the tabs is the identity and the actions: the number, the status, and Edit/Cancel are true
// of the whole restock, and a person who came here to cancel one should not have to guess which tab
// hid the button.
export function RestockSellingDetailPage() {
  const { t } = useTranslation();
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();

  const id = parseRequestId(requestId);
  const teamId = current?.teamId;

  const query = useRestockRequest({ teamId, requestId: id });
  const cancelMutation = useCancelRestockRequest();

  const request = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  // A malformed id never reaches the server (the query is disabled for it), so its message comes
  // from here rather than from an error no request produced.
  const error =
    id === 0n ? t("restock.detail.invalidId") : query.isError ? rpcError(query.error) : "";

  const supplierId = request?.supplierId ?? 0n;
  const warehouseId = request?.warehouseId ?? 0n;

  // The supplier belongs to THIS team's catalogue, so this team is exactly who can resolve it —
  // the warehouse side could not, which is why its page does not try.
  const supplier = useSupplier({ teamId, supplierId });

  // TeamDetail is unscoped (`allow_only_authenticated`), so the destination warehouse's NAME is
  // readable here. "Warehouse #3" is not somewhere goods go.
  const warehouse = useTeamDetail({ teamId: warehouseId, enabled: warehouseId > 0n });

  // THE PEOPLE ON THE TIMELINE. The ids come from the EVENTS now (00019), not from the two actor
  // columns: a restock edited three times has three more people to name — often the same person, which
  // is why they are deduplicated into one lookup — and reading the columns would miss every one.
  //
  // The columns are still the right source for the LIST's two cells; here the history is the subject.
  const actors = useRestockActors(request?.events.map((event) => event.actorUserId) ?? []);

  // Names an actor the lookup could not resolve. 0 is "not recorded" — a backfilled event whose actor
  // the old columns never captured — and gets nothing, because inventing a name there would be worse
  // than the gap. A set-but-unresolved id names its number, exactly as an unresolved rack does.
  function actorFallback(userId: bigint): string {
    if (userId === 0n) return "";
    return actors.data?.get(userId.toString())
      ? ""
      : t("restock.table.userRef", { id: userId.toString() });
  }

  // Cancel INVALIDATES rather than re-rendering off the response: cancelling moves this request
  // between STATUS TABS on the list, and writing the new status only into this page's state would
  // leave that list — and its per-tab counts — showing the request where it no longer belongs.
  async function cancelRequest() {
    if (teamId === undefined || !request) return;

    try {
      await cancelMutation.mutateAsync({ teamId, requestId: request.id });
      toaster.create({ type: "success", title: t("restock.toast.cancelled") });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("restock.toast.cancelFailed"),
        description: rpcError(err),
      });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.detail.title")}</Heading>
        <Text color="fg.muted" data-testid="restock-detail-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !request) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="restock-detail-back"
          onClick={() => navigate("/inventories/restock")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("restock.detail.back")}
        </Button>
        <Text color="red.fg" data-testid="restock-detail-error">
          {error || t("restock.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const isPending = request.status === RestockRequestStatus.PENDING;

  // Only a FULFILLED request has been counted, so it is the only one that can be short — see
  // `shortfall`. The badge sits in the header rather than on the Product tab because it is a fact
  // about the whole delivery, and the reader must not have to open a tab to find out it went wrong.
  const isFulfilled = request.status === RestockRequestStatus.FULFILLED;
  const askedTotal = askedQuantity(request.items);
  const receivedTotal = receivedQuantity(request.items);
  const short = isFulfilled && receivedTotal < askedTotal ? askedTotal - receivedTotal : 0n;

  return (
    <Stack gap="section" data-testid="restock-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="restock-detail-back"
        onClick={() => navigate("/inventories/restock")}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        {t("restock.detail.back")}
      </Button>

      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md" data-testid="restock-detail-title">
          {t("restock.detail.requestTitle", { id: request.id.toString() })}
        </Heading>
        <RestockStatusBadge status={request.status} />
        {short > 0n && (
          <Badge colorPalette="orange" data-testid="restock-detail-short">
            {t("restock.table.shortBy", { count: Number(short) })}
          </Badge>
        )}
        <Spacer />

        {/* Both actions are gated on PENDING alone, and for the physical reason behind #131: until
            the warehouse accepts, nothing has moved and the request is still an intention its author
            owns. Once accepted it is a record of something that happened, and RestockRequestUpdate
            refuses it with FailedPrecondition — offering a button that can only fail is worse than
            not offering it. */}
        {isPending && (
          <Button
            variant="outline"
            data-testid="restock-detail-edit"
            onClick={() => navigate(`/inventories/restock/${request.id}/edit`)}
          >
            <Icon as={Pencil} boxSize="4" />
            {t("restock.edit")}
          </Button>
        )}

        {isPending && (
          <ConfirmDialog
            title={t("restock.cancel.title")}
            message={t("restock.cancel.message")}
            confirmLabel={t("restock.cancel.confirm")}
            onConfirm={cancelRequest}
            trigger={
              <Button variant="outline" colorPalette="red" data-testid="restock-detail-cancel">
                <Icon as={Ban} boxSize="4" />
                {t("restock.cancel.action")}
              </Button>
            }
          />
        )}
      </Flex>

      {/* Info first because it is what the request IS; Product second because it is what the request
          is FOR; Timeline last because it is what has happened to it so far. */}
      <Tabs.Root defaultValue="info" orientation="vertical" data-testid="restock-detail-tabs">
        <Tabs.List minW="40">
          <Tabs.Trigger value="info" data-testid="restock-detail-tab-info">
            {t("restock.detail.tab.info")}
          </Tabs.Trigger>
          <Tabs.Trigger value="products" data-testid="restock-detail-tab-products">
            {t("restock.detail.tab.products")}
          </Tabs.Trigger>
          <Tabs.Trigger value="timeline" data-testid="restock-detail-tab-timeline">
            {t("restock.detail.tab.timeline")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* minW="0" ON EVERY PANEL. A vertical Tabs.Root is a flex ROW, and a flex child defaults to
            min-width:auto — it refuses to shrink below its content, so a wide table inside one does
            not overflow the panel, it WIDENS it, and the whole page gains a horizontal scrollbar.
            This is the fix people reach for last and it is the one that matters: the card's maxW and
            the table's scroll area can only work once the panel is allowed to be narrower than what
            it holds. */}
        <Tabs.Content value="info" flex="1" minW="0">
          <InfoPanel
            request={request}
            warehouseName={
              warehouse.data?.name ||
              t("restock.warehouseRef", { id: request.warehouseId.toString() })
            }
            supplierName={
              supplierId === 0n
                ? ""
                : (supplier.data?.name ??
                  t("restock.detail.supplierRef", { id: supplierId.toString() }))
            }
          />
        </Tabs.Content>

        <Tabs.Content value="products" flex="1" minW="0">
          <ProductsPanel request={request} teamId={teamId} />
        </Tabs.Content>

        <Tabs.Content value="timeline" flex="1" minW="0">
          <TimelinePanel
            request={request}
            actors={actors.data}
            actorFallback={actorFallback}
          />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

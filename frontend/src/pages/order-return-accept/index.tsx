import { useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Card,
  Field,
  Flex,
  Heading,
  Icon,
  Input,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, PackageCheck } from "lucide-react";

import { rpcError } from "../../api/clients";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { OrderStatusBadge, orderStatusLabelKey } from "../../components/badges/OrderStatusBadge";
import { CompactActions } from "../../components/chrome/CompactActions";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { CharCount } from "../../components/inputs/CharCount";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { useAcceptReturn, useReturnAcceptOrder } from "../../features/orders/queries";
import type { ReturnAcceptEntryState } from "../../features/orders/returnAccept";
import { useProductsByIds } from "../../features/products/queries";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useIsMobile } from "../../layouts/shell";
import { ReturnLineCard } from "./components/ReturnLineCard";
import type { ReturnTotals } from "./components/ReturnSummary";
import { ReturnSummary } from "./components/ReturnSummary";
import type { ReturnLineDraft } from "./draft";
import { acceptLine, emptyReturnLine, returnLineState } from "./draft";

/** The note's limit — the proto's `courier_charge_note` max_len, so the box stops where the server would refuse. */
const NOTE_MAX = 200;

function parseOrderId(raw: string | undefined): bigint {
  if (!raw) return 0n;

  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

export const description =
  "Accept Return: the return warehouse's crew has the parcel in its hands. Per line it types what is missing and what is broken, with a note if it wants one; the sound units are worked out and go onto its racks, split if they need to; a borrowed line says the code to print. The courier's ask at the door is entered only if it asked one. Accept waits until every sound unit has a rack. Another warehouse holding the parcel is told where it goes, and has no Accept.";

// A PAGE, as Accept Delivery and a transfer's accept are (a-counted-line-is-three-columns), at
// `/warehouse-orders/:orderId/accept-return` (the-return-accept-page-is-accepted). Three screens open it — the pick page,
// the warehouse order detail and Receive a Return's found order (features/orders/returnAccept.ts).
//
// THE RETURN ACCEPT WITH ITS STOCK HALF, in one act (return_decision.md):
//
//   only the return warehouse   anyone else is told where the parcel goes, and has no Accept
//                                (only-the-return-warehouse-accepts-a-return)
//   per line                    missing + broken typed; sound = ordered − broken − missing, onto this warehouse's racks
//   the batches                 the server's: one per batch the order took, price, expiry and supplier kept; the units
//                                that do not come back come off the newest layer (a-return-mints-one-batch-per-batch-the-order-took)
//   broken / missing            door rows, borne by the selling team, named on the order's note for customer service,
//                                with the crew's optional note (a-return-door-row-carries-an-optional-note)
//   borrowed                    the own product's code to print, per sound unit (a-returned-borrowed-unit-is-relabelled-at-the-accept)
//   the courier's ask           an optional amount and its note, as today (a-return-may-carry-the-couriers-ask)
export function OrderReturnAcceptPage() {
  const { current } = useTeam();
  const { orderId: rawId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const mobile = useIsMobile();

  const orderId = parseOrderId(rawId);
  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const teamId = isWarehouse ? current?.teamId : undefined;

  const query = useReturnAcceptOrder({ teamId, orderId });
  const order = query.data?.order ?? null;

  // Only what the crew TYPES is state — the order comes from a query.
  const [drafts, setDrafts] = useState<Record<string, ReturnLineDraft>>({});
  const [charge, setCharge] = useState("");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const accept = useAcceptReturn();

  // Where the return goes — the selling team's return warehouse as configured now, on the order read
  // (the-return-warehouse-is-read-when-the-return-happens) — and the borrowed lines' codes to print.
  const returnWarehouseId = order?.returnWarehouseId ?? 0n;
  const relabels = query.data?.returnLabels ?? [];
  const names = useTeamsByIds({ ids: order ? [order.teamId, returnWarehouseId] : [] }).data;
  const sellingTeamName = order ? (names?.[order.teamId.toString()]?.name ?? `#${order.teamId}`) : "";
  const returnWarehouseName =
    returnWarehouseId > 0n ? (names?.[returnWarehouseId.toString()]?.name ?? `#${returnWarehouseId}`) : "";
  // The cover pictures, in one batch — someone at a box recognises the picture before the SKU.
  const products = useProductsByIds({ teamId, productIds: order?.items.map((i) => i.productId) ?? [] }).data;

  // Back to the screen that opened the page (the pick queue's Receive a Return, the pick page, the order) — else the order.
  const from = (location.state as ReturnAcceptEntryState | null)?.from;
  const goBack = () => navigate(from ?? `/warehouse-orders/${rawId ?? ""}`);
  const openOrder = () => navigate(`/warehouse-orders/${rawId ?? ""}`);

  const back = (
    <Button
      size="xs"
      variant="ghost"
      aria-label={t("picking.returnAccept.back")}
      onClick={goBack}
      data-testid="return-accept-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {mobile ? null : t("picking.returnAccept.back")}
    </Button>
  );

  const title = t("picking.acceptReturn.title", { id: orderId.toString() });

  if (!current || !isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{title}</Heading>
        <Text color="fg.muted" data-testid="return-accept-not-warehouse">
          {t("picking.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  if (query.isPending && orderId !== 0n) {
    return (
      <Stack gap="section">
        {back}
        <Spinner colorPalette="brand" />
      </Stack>
    );
  }

  if (query.isError || !order) {
    return (
      <Stack gap="section">
        {back}
        <Text color="error.fg" data-testid="return-accept-error">
          {query.isError ? rpcError(query.error) : t("orders.invalidOrderId")}
        </Text>
      </Stack>
    );
  }

  const header = (actions: ReactNode) => (
    <Flex align="center" gap={mobile ? "2" : "card"} wrap={mobile ? "nowrap" : "wrap"}>
      {back}
      <Heading size="md" truncate data-testid="return-accept-title">
        {title}
      </Heading>
      <OrderStatusBadge status={order.status} />
      <Spacer />
      {actions}
    </Flex>
  );

  // NOT THIS WAREHOUSE'S TO ACCEPT (only-the-return-warehouse-accepts-a-return) — said plainly, with where it goes, and no
  // Accept: the parcel waits here until it is carried to the return warehouse. A team with none cannot have it accepted.
  const refused = order.status === OrderStatus.RETURN && returnWarehouseId !== current.teamId;
  if (refused) {
    return (
      <Stack gap="section" data-testid="return-accept-page">
        {header(null)}
        <Alert.Root status="warning" maxW="3xl" data-testid="return-accept-refused">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title data-testid="return-accept-refused-title">
              {returnWarehouseId === 0n
                ? t("picking.returnAccept.noReturnWarehouse.title", { team: sellingTeamName })
                : t("picking.returnAccept.elsewhere.title", { warehouse: returnWarehouseName })}
            </Alert.Title>
            <Alert.Description>
              {returnWarehouseId === 0n
                ? t("picking.returnAccept.noReturnWarehouse.description", { team: sellingTeamName })
                : t("picking.returnAccept.elsewhere.description", {
                    team: sellingTeamName,
                    warehouse: returnWarehouseName,
                  })}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
        <Button variant="outline" alignSelf="flex-start" data-testid="return-accept-open-order" onClick={openOrder}>
          {t("picking.returnAccept.openOrder")}
        </Button>
      </Stack>
    );
  }

  // NOT IN RETURN — already accepted, or not claimed back yet (Force Return first, on the order).
  if (order.status !== OrderStatus.RETURN) {
    return (
      <Stack gap="section" data-testid="return-accept-page">
        {header(null)}
        <Alert.Root status="info" maxW="3xl" data-testid="return-accept-not-acceptable">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {order.status === OrderStatus.RETURN_COMPLETED
                ? t("picking.returnAccept.alreadyAccepted", { id: order.id.toString() })
                : t("picking.returnAccept.notInReturn", {
                    id: order.id.toString(),
                    status: t(orderStatusLabelKey(order.status)),
                  })}
            </Alert.Title>
          </Alert.Content>
        </Alert.Root>
        <Button variant="outline" alignSelf="flex-start" data-testid="return-accept-open-order" onClick={openOrder}>
          {t("picking.returnAccept.openOrder")}
        </Button>
      </Stack>
    );
  }

  const draftOf = (itemId: bigint) => drafts[itemId.toString()] ?? emptyReturnLine();
  const updater = (itemId: bigint) => (fn: (d: ReturnLineDraft) => ReturnLineDraft) =>
    setDrafts((prev) => ({ ...prev, [itemId.toString()]: fn(prev[itemId.toString()] ?? emptyReturnLine()) }));

  const lines = order.items.map((item) => {
    const draft = draftOf(item.id);
    return { item, draft, st: returnLineState(item, draft), relabel: relabels.find((r) => r.orderItemId === item.id) };
  });

  const amount = charge === "" ? 0 : Number(charge);
  const charged = amount > 0;
  const noteMissing = charged && note.trim() === "";

  const unfinished = lines.filter((l) => !l.st.ready).length;
  const writable = canWrite(current);
  const ready = lines.length > 0 && unfinished === 0 && !noteMissing && writable;
  const busy = accept.isPending;

  const totals: ReturnTotals = { ordered: 0, sound: 0, broken: 0, missing: 0, labels: 0, byRack: new Map() };
  for (const { st, relabel } of lines) {
    totals.ordered += st.ordered;
    if (st.over > 0) continue;
    totals.sound += st.sound;
    totals.broken += st.broken;
    totals.missing += st.missing;
    if (relabel) totals.labels += st.sound;
    for (const row of st.rows) {
      if (st.sound === 0 || row.rack === "" || row.effective === 0) continue;
      totals.byRack.set(row.rack, (totals.byRack.get(row.rack) ?? 0) + row.effective);
    }
  }

  async function submit() {
    if (!order || !current) return;
    setSubmitError("");

    try {
      await accept.mutateAsync({
        teamId: current.teamId,
        orderId: order.id,
        lines: lines.map((l) => acceptLine(l.item.id, l.st)),
        courierCharge: amount,
        courierChargeNote: charged ? note.trim() : "",
      });

      toaster.create({ type: "success", title: t("picking.acceptReturn.accepted") });
      goBack();
    } catch (err) {
      setSubmitError(rpcError(err));
      toaster.create({ type: "error", title: t("picking.returnAccept.failed"), description: rpcError(err) });
    }
  }

  // How far the crew has got — beside Accept on a desktop, under the sticky row on a phone.
  const progress = (
    <Stack gap="0" textAlign={mobile ? "start" : "end"}>
      <Text fontSize="sm" data-testid="return-accept-count">
        {t("picking.returnAccept.countSummary", {
          placed: [...totals.byRack.values()].reduce((sum, n) => sum + n, 0),
          sound: totals.sound,
        })}
      </Text>
      {unfinished > 0 ? (
        <Text fontSize="xs" color="warning.fg" data-testid="return-accept-progress">
          {t("picking.returnAccept.progress", { count: unfinished })}
        </Text>
      ) : noteMissing ? (
        <Text fontSize="xs" color="warning.fg" data-testid="return-accept-progress">
          {t("picking.acceptReturn.courierNoteRequired")}
        </Text>
      ) : (
        <Text fontSize="xs" color="success.fg" data-testid="return-accept-ready">
          {t("picking.returnAccept.ready")}
        </Text>
      )}
    </Stack>
  );

  return (
    <Stack gap="section" data-testid="return-accept-page">
      {/* The action header rides at the top of the scroll, as Accept Delivery's does: on a long parcel the Accept and the
          reason it will not press stay in reach. On a phone it is ONE row — back, the title, the status, Accept as its
          icon (a-phone-header-action-is-an-icon) — and the progress comes down under it. */}
      <Box position="sticky" top="0" zIndex="1" bg="bg" borderBottomWidth="1px" borderColor="border" py="card">
        {header(
          mobile ? (
            writable && (
              <CompactActions
                menuLabel={t("picking.returnAccept.actions")}
                actions={[
                  {
                    id: "accept",
                    label: t("picking.action.acceptReturn"),
                    icon: PackageCheck,
                    primary: true,
                    disabled: !ready || busy,
                    testId: "return-accept-submit",
                    onClick: () => setConfirmOpen(true),
                  },
                ]}
              />
            )
          ) : (
            <>
              {progress}
              {writable && (
                <Button
                  colorPalette="brand"
                  disabled={!ready}
                  loading={busy}
                  data-testid="return-accept-submit"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Icon as={PackageCheck} boxSize="4" />
                  {t("picking.action.acceptReturn")}
                </Button>
              )}
            </>
          ),
        )}
      </Box>

      {mobile && progress}

      <Text fontSize="sm" color="fg.muted">
        {t("picking.returnAccept.intro")}
      </Text>

      {submitError && (
        <Text color="error.fg" data-testid="return-accept-submit-error">
          {submitError}
        </Text>
      )}

      <ReturnSummary totals={totals} warehouseId={current.teamId} sellingTeamName={sellingTeamName} />

      {lines.map(({ item, draft, st, relabel }) => {
        const product = products?.get(item.productId.toString());

        return (
          <ReturnLineCard
            key={item.id.toString()}
            item={item}
            draft={draft}
            st={st}
            relabel={relabel}
            warehouseId={current.teamId}
            imageUrl={product?.defaultImageUrl}
            thumbnailUrl={product?.defaultImageThumbnailUrl}
            update={updater(item.id)}
          />
        );
      })}

      {/* THE COURIER'S ASK AT THE DOOR — rarely asked, so empty by default; its note required once it is above 0
          (an-incidental-line-must-say-what-it-was-for). The words are the live dialog's. */}
      <Card.Root data-testid="return-accept-courier">
        <Card.Header>
          <Card.Title>{t("picking.acceptReturn.courierTitle")}</Card.Title>
          <Card.Description>{t("picking.acceptReturn.courierHint")}</Card.Description>
        </Card.Header>
        <Card.Body>
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
            <Field.Root>
              <Field.Label>{t("picking.acceptReturn.courierAmount")}</Field.Label>
              <CurrencyInput value={charge} onChange={setCharge} data-testid="return-accept-charge" />
            </Field.Root>
            <Field.Root required={charged} invalid={noteMissing}>
              <Field.Label>
                {t("picking.acceptReturn.courierNote")}
                <Field.RequiredIndicator />
              </Field.Label>
              <Input
                value={note}
                maxLength={NOTE_MAX}
                placeholder={t("picking.acceptReturn.courierNotePlaceholder")}
                data-testid="return-accept-charge-note"
                onChange={(e) => setNote(e.target.value)}
              />
              <Flex w="full" justify="space-between" gap="2">
                {noteMissing ? (
                  <Field.ErrorText data-testid="return-accept-charge-note-error">
                    {t("picking.acceptReturn.courierNoteRequired")}
                  </Field.ErrorText>
                ) : (
                  <Box />
                )}
                <CharCount value={note} max={NOTE_MAX} />
              </Flex>
            </Field.Root>
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      {/* Accepting moves stock and cannot be undone, so it confirms first — Accept Delivery's rule. One dialog for both
          shells. Its message repeats the three outcomes, so the last look is at what will happen. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive={false}
        title={t("picking.returnAccept.confirm.title", { id: order.id.toString() })}
        message={t("picking.returnAccept.confirm.message", {
          sound: totals.sound,
          broken: totals.broken,
          missing: totals.missing,
        })}
        confirmLabel={t("picking.action.acceptReturn")}
        dismissLabel={t("picking.returnAccept.confirm.keepCounting")}
        onConfirm={submit}
      />
    </Stack>
  );
}

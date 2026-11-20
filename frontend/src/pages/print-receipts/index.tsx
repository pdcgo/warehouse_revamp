import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Icon,
  IconButton,
  Spacer,
  Stack,
  Switch,
  Table,
  Text,
  useBreakpointValue,
} from "@chakra-ui/react";
import { ArrowLeft, ExternalLink, FileCheck, FileX, PackageSearch, Printer, X } from "lucide-react";

import { orderClient, rpcError } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import type { OrderPrint } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderLabelReason, OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import type { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { CompactActions } from "../../components/chrome/CompactActions";
import { CopyText } from "../../components/chrome/CopyText";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { toaster } from "../../components/feedback/Toaster";
import { AwbCell, ShopRefCell } from "../../features/orders/OrderRowCells";
import { OrderCourierBadge } from "../../features/orders/OrderCourierBadge";
import { useInvalidateOrders, useOrderStatusChange } from "../../features/orders/queries";
import { NO_SHOPS, useShopsByIds } from "../../features/shops/queries";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useIsMobile } from "../../layouts/shell";
import { cameFrom } from "../../lib/cameFrom";
import { WarehouseStatusBadge } from "../pick-queue/components/WarehouseStatusBadge";
import { printIdsOf, printReceiptsPath } from "./path";
import { loadUnboxing, saveUnboxing } from "./unboxing";
// CETAK ULANG LABEL (a-changed-label-asks-the-warehouse-to-reprint): a marked order's badge under its label and its
// count on the list line — the server's `OrderPrint.reprint_label`. Print records the print, which clears it.
import { ReprintLabelPrintMark } from "../../features/orders/ReprintLabel";

// PRINT RECEIPTS — CETAK RESI — the warehouse's daily confirm step on ONE page (acceptance inventory/order.md:133–142),
// accepted as drawn (the-print-page-and-the-courier-count-prototype-is-accepted) and routed at `/warehouse-orders/print`.
// The list's bulk bar opens it with the ticked orders, and a row's ⋯ Print Label with that one order
// (a-rows-print-label-opens-the-print-page) — the same page, the same switches and rules.
//
// THE OWNER'S FLOW (docs/business/inventory/order.md:113–124): the crew opens the web, prints the order's
// `receipt_file`, and the order is set Processed — *"Staff confirming order, change order status and print receipt"*.
// So the page carries one switch for that move, ON when the page opens:
//
//   Confirm after printing ON   every order still To confirm (pending) whose label made it into the PDF moves to
//                               Confirmed (processed) — one OrderStatusChange for them all, AFTER the PDF is made
//                               (one-status-change-for-every-plain-move); a reprint of an order already Confirmed or
//                               further keeps its step; an order the PDF left out keeps its step too — nothing was
//                               printed for it
//   Confirm after printing OFF  the labels print, every order keeps its step
//
// The labels are the SELLER's files, so the PDF is OrderLabels' — one call, the orders in the list's order, merged into
// one PDF, each order with its own result (a-warehouse-prints-the-labels-of-orders-it-ships). The page lists the chosen
// orders first, each saying whether a label is attached, so an order with none is named BEFORE the print; after it, each
// row and the result say what the server did — in the PDF or left out and why, moved or kept.
//
// THE CHOSEN ORDERS ARE READ IN ONE CALL — OrderPrintByIds, the orders this warehouse ships, each with its step, shop,
// courier and resi and whether a label is attached; an order absent from it is not this warehouse's.
//
// THE UNBOXING WARNING (the-unboxing-warning-is-one-sentence-on-each-label): on, OrderLabels stamps ONE fixed sentence —
// the server's, in Indonesian — on every label page; off, the labels print as they are. The switch is remembered on
// this device (unboxing.ts), like Cetak Label's settings.
//
// A monitoring team (the-admin-team-monitors-read-only) prints — printing is a read — but moves nothing: its switch is
// off and locked.
//
// ON THE SCREEN RULES, as the restock labels page: back is its icon in the title's row and returns where the page was
// opened (a-form-returns-where-it-was-opened); on a phone the header is one row with Print as its icon
// (the-phone-header-is-one-row) and every order is a block (a-phone-reads-each-line-as-a-block); a first load is a
// skeleton. Settings beside the orders from `lg`, above them on a phone (the-label-page-is-settings-and-a-preview).

/** What the last print did to one order. */
interface Printed {
  /** In the merged PDF — or left out, and why. */
  included: boolean;
  reason: OrderLabelReason;
  /** The move after it: moved, refused (with the server's words), or kept (not asked). */
  move: "moved" | "refused" | "kept";
  refusedReason?: string;
}

/** What one press of Print did. */
interface PrintRun {
  url: string;
  byId: Map<string, Printed>;
  /** Whether the run asked for the move (the switch was on, and the team may write). */
  statusChange: boolean;
  /** Whether the run asked for the unboxing warning on every label page. */
  unboxing: boolean;
}

/** Why an order was left out, in a word — its row's second line; the result names it in a sentence (REFUSAL). */
const REASON: Record<OrderLabelReason, string> = {
  [OrderLabelReason.UNSPECIFIED]: "printReceipts.label.reason.refused",
  [OrderLabelReason.NOT_SHIPPED_HERE]: "printReceipts.label.reason.notShippedHere",
  [OrderLabelReason.NO_LABEL]: "printReceipts.label.reason.noLabel",
  [OrderLabelReason.UNREADABLE]: "printReceipts.label.reason.unreadable",
};

/** What the result says of a left-out order — the same sentences the list's toast says (features/orders/labels.ts). */
const REFUSAL: Record<OrderLabelReason, string> = {
  [OrderLabelReason.UNSPECIFIED]: "orders.label.refused",
  [OrderLabelReason.NOT_SHIPPED_HERE]: "orders.label.notShippedHere",
  [OrderLabelReason.NO_LABEL]: "orders.label.noLabel",
  [OrderLabelReason.UNREADABLE]: "orders.label.unreadable",
};

/** One order on the print — its read, and the step it is at now. */
interface Chosen {
  id: bigint;
  order: OrderPrint | null;
  loading: boolean;
  error: unknown;
}

/**
 * Every chosen order, in the page's order — read in ONE call (OrderPrintByIds), where the prototype asked OrderDetail once
 * per order. An order taken off is a new set of ids, so the read runs again; the orders still on the print keep their
 * answer meanwhile (`listQuery` — the same print, refined). It sits under the orders' key, so a status change re-reads it.
 */
function useChosenOrders(teamId: bigint | undefined, ids: bigint[]): Chosen[] {
  const read = useQuery({
    ...listQuery,
    queryKey: key.orders(teamId, { print: ids.join(",") }),
    enabled: teamId !== undefined && ids.length > 0,
    queryFn: async () => {
      const res = await orderClient.orderPrintByIds({ teamId: teamId!, orderIds: ids });
      return new Map(res.orders.map((order) => [order.orderId.toString(), order]));
    },
  });

  return useMemo(
    () =>
      ids.map((id) => ({
        id,
        order: read.data?.get(id.toString()) ?? null,
        loading: read.isPending && teamId !== undefined,
        error: read.error,
      })),
    [ids, read.data, read.isPending, read.error, teamId],
  );
}

export function PrintReceiptsPage() {
  const { current } = useTeam();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const mobile = useIsMobile();
  // From `lg` the settings stand in a column beside the orders, held in view.
  const wide = useBreakpointValue({ base: false, lg: true }) ?? false;

  const [ids, setIds] = useState<bigint[]>(() => printIdsOf(location.search));
  // EVERY WAY OUT GOES WHERE THE PAGE WAS OPENED — the list with its tab and filters. Read once: the address changes as
  // orders are taken off, and the way back must not change with it.
  const [openedFrom] = useState(() => cameFrom(location));
  const backTo = openedFrom ?? "/warehouse-orders";

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const teamId = isWarehouse ? current?.teamId : undefined;
  // A monitoring team prints (a read) and moves nothing (the-admin-team-monitors-read-only).
  const mayWrite = canWrite(current);

  const chosen = useChosenOrders(teamId, ids);
  const shopNames = useShopsByIds({ shopIds: chosen.flatMap((c) => (c.order ? [c.order.shopId] : [])) }).data ?? NO_SHOPS;

  // THE TWO SWITCHES. Confirm after printing is ON when the page opens — the owner's flow is print, then Processed — and
  // is not remembered: a switch left off on Monday must not leave Tuesday's orders unconfirmed without anyone seeing it.
  const [statusChange, setStatusChange] = useState(true);
  // THE UNBOXING WARNING — remembered on this device, sent with the print (the server owns the sentence).
  const [unboxing, setUnboxingState] = useState(loadUnboxing);
  const setUnboxing = (on: boolean) => {
    setUnboxingState(on);
    saveUnboxing(on);
  };
  const moving = statusChange && mayWrite;

  const change = useOrderStatusChange();
  const invalidateOrders = useInvalidateOrders();
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<PrintRun | null>(null);
  // The step each order was moved to by a print on this page — until the read says so itself (a server re-read does
  // at once; it keeps a move on screen while the read is on its way).
  const [movedTo, setMovedTo] = useState<Record<string, OrderStatus>>({});

  const stepOf = (order: OrderPrint): OrderStatus => {
    const moved = movedTo[order.orderId.toString()];
    return moved !== undefined && order.status === OrderStatus.PENDING ? moved : order.status;
  };

  // An order off the print — the address follows, replaced, carrying the way back. The last one stays.
  const remove = (id: bigint) => {
    if (ids.length <= 1) return;
    const next = ids.filter((x) => x !== id);
    setIds(next);
    navigate(printReceiptsPath(next), {
      replace: true,
      preventScrollReset: true,
      state: openedFrom ? { from: openedFrom } : undefined,
    });
  };

  const readOrders = chosen.flatMap((c) => (c.order ? [c.order] : []));
  const withoutLabel = readOrders.filter((order) => !order.hasLabel);
  const waiting = readOrders.filter((order) => stepOf(order) === OrderStatus.PENDING);
  // The orders printed AGAIN because their label changed after the last print (the-reprint-label-prototype-is-accepted).
  const toReprint = readOrders.filter((order) => order.reprintLabel).length;

  // PRINT — ONE OrderLabels for every order on the page, in its order; the PDF opens; then, with the switch on, ONE
  // OrderStatusChange for the To confirm orders the PDF holds. A failure of the move never un-prints the labels: the
  // row says it was not moved, in the server's words.
  async function print() {
    if (teamId === undefined || ids.length === 0) return;

    setBusy(true);
    try {
      // `recordPrint`: THIS is a print — the server stamps every order the PDF includes, which clears its Cetak ulang
      // label (a-changed-label-asks-the-warehouse-to-reprint). The order page's label viewer asks without it.
      const res = await orderClient.orderLabels({ teamId, orderIds: ids, unboxingWarning: unboxing, recordPrint: true });
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");

      const byId = new Map<string, Printed>();
      for (const result of res.results) {
        byId.set(result.orderId.toString(), { included: result.included, reason: result.reason, move: "kept" });
      }
      // The labels in the PDF are printed now: every order read re-reads, so the badge clears everywhere — this page, the
      // list, the pick page, Daftar Ambil (all under the orders' key).
      if (res.results.some((result) => result.included)) void invalidateOrders();

      const movable = moving
        ? readOrders.filter((order) => byId.get(order.orderId.toString())?.included && stepOf(order) === OrderStatus.PENDING)
        : [];

      if (movable.length > 0) {
        try {
          const results = await change.mutateAsync({
            teamId,
            orderIds: movable.map((order) => order.orderId),
            to: OrderStatus.PROCESSED,
            note: "",
          });
          const moved: Record<string, OrderStatus> = {};
          for (const result of results) {
            const row = byId.get(result.orderId.toString());
            if (!row) continue;
            row.move = result.moved ? "moved" : "refused";
            row.refusedReason = result.refusedReason;
            if (result.moved) moved[result.orderId.toString()] = OrderStatus.PROCESSED;
          }
          setMovedTo((prev) => ({ ...prev, ...moved }));
        } catch (err) {
          for (const order of movable) {
            const row = byId.get(order.orderId.toString());
            if (row) Object.assign(row, { move: "refused", refusedReason: rpcError(err) });
          }
        }
      }

      setRun({ url: res.url, byId, statusChange: moving, unboxing });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <IconButton
      size="sm"
      variant="ghost"
      flexShrink={0}
      aria-label={t("printReceipts.back")}
      title={t("printReceipts.back")}
      onClick={() => navigate(backTo)}
      data-testid="print-receipts-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("printReceipts.title")}</Heading>
        <Text color="fg.muted">{t("picking.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("printReceipts.title")}</Heading>
        <Text color="fg.muted" data-testid="print-receipts-not-warehouse">
          {t("printReceipts.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  // NOTHING CHOSEN — an address with no order in it says so, with the way back to tick some.
  if (ids.length === 0) {
    return (
      <Stack gap="section" data-testid="print-receipts-page">
        <Flex align="center" gap="2">
          {back}
          <Heading size="md">{t("printReceipts.title")}</Heading>
        </Flex>
        <EmptyHint
          icon={PackageSearch}
          title={t("printReceipts.none")}
          description={t("printReceipts.noneHint")}
          testId="print-receipts-empty"
        />
      </Stack>
    );
  }

  // The first load shows the page's shape (motion-is-small-quick-and-shared).
  if (chosen.every((c) => c.loading)) {
    return <ListSkeleton heading rows={4} testId="print-receipts-loading" />;
  }

  const total = ids.length;
  const printedCount = run ? [...run.byId.values()].filter((p) => p.included).length : 0;
  const movedCount = run ? [...run.byId.values()].filter((p) => p.move === "moved").length : 0;
  const leftOut = run ? [...run.byId.entries()].filter(([, p]) => !p.included) : [];

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="print-receipts-page">
      {/* THE TITLE'S ROW — back, the title with how many orders, and Print. On a phone ONE row, Print its icon. */}
      <Flex align="center" gap={mobile ? "2" : "card"} wrap={mobile ? "nowrap" : "wrap"} data-testid="print-receipts-header">
        {back}
        <Heading size="md" truncate data-testid="print-receipts-heading">
          {t("printReceipts.heading", { count: total })}
        </Heading>
        <Spacer />
        {mobile ? (
          <CompactActions
            menuLabel={t("orders.actions")}
            actions={[
              {
                id: "print",
                label: t("printReceipts.print"),
                icon: Printer,
                primary: true,
                disabled: busy,
                testId: "print-receipts-print",
                onClick: () => void print(),
              },
            ]}
          />
        ) : (
          <Button colorPalette="brand" loading={busy} onClick={() => void print()} data-testid="print-receipts-print">
            <Icon as={Printer} boxSize="4" />
            {t("printReceipts.print")}
          </Button>
        )}
      </Flex>

      {/* WHAT THE LAST PRINT DID — how many labels the PDF holds, how many orders moved, every order left out named with
          its reason (acceptance: "message names order without label"), and the PDF again, for a blocked pop-up. */}
      {run && (
        <Alert.Root
          status={printedCount === 0 ? "error" : leftOut.length > 0 ? "warning" : "success"}
          data-testid="print-receipts-result"
        >
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title data-testid="print-receipts-result-title">
              {printedCount === 0
                ? t("orders.label.noneToPrint")
                : t("printReceipts.result.printed", { printed: printedCount, total: run.byId.size })}
            </Alert.Title>
            <Alert.Description>
              <Stack gap="1" mt="1">
                <Text data-testid="print-receipts-result-moves">
                  {!run.statusChange
                    ? t("printReceipts.result.statusOff")
                    : movedCount > 0
                      ? t("printReceipts.result.moved", { count: movedCount })
                      : t("printReceipts.result.nothingToMove")}
                </Text>
                {run.unboxing && printedCount > 0 && (
                  <Text data-testid="print-receipts-result-unboxing">{t("printReceipts.result.unboxing")}</Text>
                )}
                {leftOut.length > 0 && (
                  <Stack gap="0.5" data-testid="print-receipts-result-left-out">
                    {leftOut.map(([id, p]) => (
                      <Text key={id} fontSize="sm" data-testid={`print-receipts-result-left-out-${id}`}>
                        {t(REFUSAL[p.reason], { id })}
                      </Text>
                    ))}
                  </Stack>
                )}
                {/* The PDF again — for a pop-up the browser blocked. Under the lines, so a phone keeps their width. */}
                {run.url && (
                  <Button
                    asChild
                    size="xs"
                    variant="outline"
                    alignSelf="flex-start"
                    mt="1"
                    data-testid="print-receipts-open-pdf"
                  >
                    <a href={run.url} target="_blank" rel="noopener noreferrer">
                      <Icon as={ExternalLink} boxSize="4" />
                      {t("printReceipts.result.openPdf")}
                    </a>
                  </Button>
                )}
              </Stack>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {/* THE SETTINGS BESIDE THE ORDERS where there is room, held in view; above them on a phone.

            lg                                  base
            ┌ Print Settings ┐ ┌ Orders on ─┐   Print Settings
            │ (sticky)       │ │ This Print │   Orders on This Print
            └────────────────┘ └────────────┘                                                        */}
      <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "20rem minmax(0, 1fr)" }} gap="section" alignItems="start">
        <Box position={wide ? "sticky" : "static"} top="page" minW="0">
          <Card.Root data-testid="print-receipts-settings">
            <Card.Body>
              <Stack gap="card">
                <Text fontWeight="bold">{t("printReceipts.settings.title")}</Text>

                {/* PRINT, THEN CONFIRMED — the owner's flow, on when the page opens. */}
                <Stack gap="1">
                  <Switch.Root
                    checked={moving}
                    disabled={!mayWrite}
                    onCheckedChange={(e) => setStatusChange(e.checked)}
                    data-testid="print-receipts-status-change"
                  >
                    <Switch.HiddenInput />
                    <Switch.Control />
                    <Switch.Label fontWeight="bold">{t("printReceipts.settings.statusChange")}</Switch.Label>
                  </Switch.Root>
                  <Text fontSize="xs" color="fg.muted" data-testid="print-receipts-status-change-hint">
                    {!mayWrite
                      ? t("printReceipts.settings.monitorHint")
                      : moving
                        ? t("printReceipts.settings.statusChangeOn")
                        : t("printReceipts.settings.statusChangeOff")}
                  </Text>
                </Stack>

                {/* THE UNBOXING WARNING — one sentence on every label page; remembered on this device. A monitor prints, so
                    it may set it too. */}
                <Stack gap="1">
                  <Switch.Root
                    checked={unboxing}
                    onCheckedChange={(e) => setUnboxing(e.checked)}
                    data-testid="print-receipts-unboxing"
                  >
                    <Switch.HiddenInput />
                    <Switch.Control />
                    <Switch.Label fontWeight="bold">{t("printReceipts.settings.unboxing")}</Switch.Label>
                  </Switch.Root>
                  <Text fontSize="xs" color="fg.muted" data-testid="print-receipts-unboxing-hint">
                    {unboxing ? t("printReceipts.settings.unboxingOn") : t("printReceipts.settings.unboxingOff")}
                  </Text>
                </Stack>
              </Stack>
            </Card.Body>
          </Card.Root>
        </Box>

        <Card.Root minW="0" data-testid="print-receipts-orders">
          <Card.Body>
            <Stack gap="card">
              <Flex align="baseline" gap="2" wrap="wrap">
                <Text fontWeight="bold">{t("printReceipts.list.title")}</Text>
                <Text fontSize="xs" color="fg.muted" data-testid="print-receipts-list-line">
                  {t("printReceipts.list.line", { count: total })}
                  {withoutLabel.length > 0 && ` · ${t("printReceipts.list.withoutLabel", { count: withoutLabel.length })}`}
                  {moving && waiting.length > 0 && ` · ${t("printReceipts.list.toConfirm", { count: waiting.length })}`}
                  {toReprint > 0 && ` · ${t("orders.reprintLabel.printLine", { count: toReprint })}`}
                </Text>
              </Flex>

              {mobile ? (
                <Stack gap="2" data-testid="print-receipts-blocks">
                  {chosen.map((c) => (
                    <OrderBlock
                      key={c.id.toString()}
                      chosen={c}
                      step={c.order ? stepOf(c.order) : undefined}
                      shop={c.order ? shopNames.get(c.order.shopId.toString()) : undefined}
                      printed={run?.byId.get(c.id.toString())}
                      canRemove={ids.length > 1}
                      onRemove={() => remove(c.id)}
                    />
                  ))}
                </Stack>
              ) : (
                <Box overflowX="auto" minW="0">
                  <Table.Root size="sm" data-testid="print-receipts-table">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>{t("printReceipts.list.order")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseOrders.col.shop")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseOrders.col.awb")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("picking.table.status")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("printReceipts.list.label")}</Table.ColumnHeader>
                        <Table.ColumnHeader w="1" />
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {chosen.map((c) => {
                        const id = c.id.toString();
                        const printed = run?.byId.get(id);

                        return (
                          <Table.Row key={id} data-testid={`print-receipts-row-${id}`}>
                            <Table.Cell fontWeight="bold">#{id}</Table.Cell>
                            {c.order ? (
                              <>
                                <Table.Cell>
                                  <ShopRefCell
                                    shop={shopNames.get(c.order.shopId.toString())}
                                    orderRefId={c.order.orderExternalRefId}
                                  />
                                </Table.Cell>
                                <Table.Cell>
                                  <AwbCell channelId={c.order.shipmentChannelId} code={c.order.receiptCode} />
                                </Table.Cell>
                                <Table.Cell>
                                  <StepCell id={id} step={stepOf(c.order)} printed={printed} />
                                </Table.Cell>
                                <Table.Cell>
                                  <LabelCell id={id} order={c.order} printed={printed} />
                                  <ReprintLabelPrintMark on={c.order.reprintLabel} orderId={c.id} />
                                </Table.Cell>
                              </>
                            ) : (
                              <Table.Cell colSpan={4}>
                                <ReadState chosen={c} />
                              </Table.Cell>
                            )}
                            <Table.Cell>
                              <RemoveButton id={c.id} disabled={ids.length <= 1} onRemove={() => remove(c.id)} />
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Root>
                </Box>
              )}
            </Stack>
          </Card.Body>
        </Card.Root>
      </Grid>
    </Stack>
  );
}

/** An order whose read is on its way, or failed — not this warehouse's, or no such order. */
function ReadState({ chosen }: { chosen: Chosen }) {
  const { t } = useTranslation();

  if (chosen.loading) {
    return (
      <Text fontSize="sm" color="fg.muted">
        {t("printReceipts.list.loading")}
      </Text>
    );
  }

  return (
    <Text fontSize="sm" color="error.fg" data-testid={`print-receipts-read-error-${chosen.id}`}>
      {chosen.error ? rpcError(chosen.error) : t("printReceipts.list.notFound")}
    </Text>
  );
}

/** The order's step — and, after a print, what the print did to it: moved to Confirmed, kept, or refused and why. */
function StepCell({ id, step, printed }: { id: string; step: OrderStatus; printed?: Printed }) {
  const { t } = useTranslation();

  return (
    <Stack gap="0.5" align="start" data-testid={`print-receipts-step-${id}`} data-status={step}>
      <WarehouseStatusBadge status={step} />
      {printed?.move === "moved" && (
        <Text fontSize="xs" color="success.fg" whiteSpace="nowrap" data-testid={`print-receipts-moved-${id}`}>
          {t("printReceipts.move.moved")}
        </Text>
      )}
      {printed?.move === "refused" && (
        <Text
          fontSize="xs"
          color="error.fg"
          lineClamp={1}
          maxW="14rem"
          title={printed.refusedReason}
          data-testid={`print-receipts-not-moved-${id}`}
        >
          {t("printReceipts.move.refused", { reason: printed.refusedReason ?? "" })}
        </Text>
      )}
    </Stack>
  );
}

/**
 * The order's label — before a print, whether a file is attached (none is named up front); after it, whether the PDF
 * holds it, or the server's reason it does not.
 */
function LabelCell({ id, order, printed }: { id: string; order: OrderPrint; printed?: Printed }) {
  const { t } = useTranslation();

  if (printed) {
    return printed.included ? (
      <Badge colorPalette="success" variant="subtle" data-testid={`print-receipts-label-${id}`} data-label="printed">
        <Icon as={FileCheck} boxSize="3.5" />
        {t("printReceipts.label.printed")}
      </Badge>
    ) : (
      <Stack gap="0.5" align="start" data-testid={`print-receipts-label-${id}`} data-label="leftOut">
        <Badge colorPalette="error" variant="subtle">
          <Icon as={FileX} boxSize="3.5" />
          {t("printReceipts.label.leftOut")}
        </Badge>
        <Text fontSize="xs" color="error.fg" whiteSpace="nowrap">
          {t(REASON[printed.reason])}
        </Text>
      </Stack>
    );
  }

  return order.hasLabel ? (
    <Badge colorPalette="gray" variant="subtle" data-testid={`print-receipts-label-${id}`} data-label="attached">
      <Icon as={FileCheck} boxSize="3.5" />
      {t("printReceipts.label.attached")}
    </Badge>
  ) : (
    <Badge colorPalette="warning" variant="subtle" data-testid={`print-receipts-label-${id}`} data-label="missing">
      <Icon as={FileX} boxSize="3.5" />
      {t("printReceipts.label.missing")}
    </Badge>
  );
}

function RemoveButton({ id, disabled, onRemove }: { id: bigint; disabled: boolean; onRemove: () => void }) {
  const { t } = useTranslation();

  return (
    <IconButton
      size="xs"
      variant="ghost"
      aria-label={t("printReceipts.list.remove", { id: id.toString() })}
      title={t("printReceipts.list.remove", { id: id.toString() })}
      disabled={disabled}
      onClick={onRemove}
      data-testid={`print-receipts-remove-${id}`}
    >
      <Icon as={X} boxSize="4" />
    </IconButton>
  );
}

/** ONE ORDER ON A PHONE — a block (a-phone-reads-each-line-as-a-block): its number and step, the shop, the courier, the label. */
function OrderBlock({
  chosen,
  step,
  shop,
  printed,
  canRemove,
  onRemove,
}: {
  chosen: Chosen;
  step?: OrderStatus;
  shop?: { name: string; marketplace: Marketplace };
  printed?: Printed;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const id = chosen.id.toString();
  const order = chosen.order;
  let body: ReactNode;

  if (!order || step === undefined) {
    body = <ReadState chosen={chosen} />;
  } else {
    body = (
      <>
        <Flex align="center" gap="1.5" minW="0" wrap="wrap">
          {shop && <MarketplaceBadge marketplace={shop.marketplace} size="sm" />}
          <Text fontSize="sm" lineClamp={1}>
            {shop?.name ?? "—"}
          </Text>
          {order.orderExternalRefId && <CopyText value={order.orderExternalRefId} fontSize="xs" />}
        </Flex>
        <Flex align="center" gap="1.5" wrap="wrap">
          {order.shipmentChannelId > 0n && <OrderCourierBadge channelId={order.shipmentChannelId} />}
          {order.receiptCode && <CopyText value={order.receiptCode} mono fontSize="xs" />}
        </Flex>
        {/* In a Box, so the badge keeps its own width instead of the block's. */}
        <Box>
          <LabelCell id={id} order={order} printed={printed} />
          <ReprintLabelPrintMark on={order.reprintLabel} orderId={chosen.id} />
        </Box>
      </>
    );
  }

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="l2" p="3" data-testid={`print-receipts-block-${id}`}>
      <Stack gap="1.5">
        <Flex align="flex-start" gap="2">
          <Text fontWeight="bold" flexShrink={0}>
            #{id}
          </Text>
          {step !== undefined && <StepCell id={id} step={step} printed={printed} />}
          <Spacer />
          <RemoveButton id={chosen.id} disabled={!canRemove} onRemove={onRemove} />
        </Flex>
        {body}
      </Stack>
    </Box>
  );
}

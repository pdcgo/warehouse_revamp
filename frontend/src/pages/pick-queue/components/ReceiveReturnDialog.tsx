import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  CloseButton,
  Dialog,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  Portal,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { CircleSlash, PackageCheck, PackageSearch, Search, Undo2 } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { useIsMobile } from "../../../layouts/shell";
import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatusBadge, orderStatusLabelKey } from "../../../components/badges/OrderStatusBadge";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { AcceptReturnDialog } from "../../../features/orders/AcceptReturnDialog";
import { NO_ORDER_FILTERS, useOrder, useOrders } from "../../../features/orders/queries";
import { canForceReturn, useForceReturn } from "../../../features/orders/useForceReturn";
import { useShopsByIds } from "../../../features/shops/queries";

export const description =
  "Receive a Return: a returned parcel is in the crew's hands. They scan its label or type the order ref or tracking number, and the order is found among this warehouse's orders. In return: Accept Return. Shipping, shipped, in a problem or completed: Force Return, confirmed, then straight on to Accept Return. Any other status says why it cannot be received.";

/** How many matches are shown — a ref or a tracking number names one order; a short typed fragment may match a few. */
const RESULT_LIMIT = 10;

// RECEIVE A RETURN (a-return-is-received-by-search-then-forced, B) — §Who Change The Returns' "Warehouse Person Receive
// Packet First" branch: SEARCH, FORCE IF NEEDED, ACCEPT.
//
//   scan / type ──▶ OrderList q, as this warehouse ──▶ one row per match
//                                                       ├ return                          → Accept Return
//                                                       ├ shipping·shipped·problem·completed → Force Return ▶ confirm ▶ Accept Return
//                                                       └ anything else                   → a sentence: why not
//
// ⚠ THE SEARCH IS OrderList's OWN `q` (it matches the marketplace ref and the tracking number), asked AS THIS WAREHOUSE —
// so the server's own scope decides what is found: the orders shipping from here, and the returns coming back to it as a
// configured return warehouse. A parcel whose order is neither is "not found" (the decision's row), never another
// building's order.
//
// ⚠ THE INPUT IS A SCANNER'S (the pick-queue-next ScanInput precedent): a handheld scanner types the code and presses
// Enter. Enter searches and EMPTIES the field for the next parcel — what was searched stays readable as "Results for …" —
// and focus stays in the field.
//
// ⚠ THE ACCEPT NEEDS THE ORDER'S LINES, which a list row never carries — so pressing Accept (or a force that succeeded)
// reads the order's detail first, and the existing AcceptReturnDialog opens on it.
export function ReceiveReturnDialog({
  open,
  onOpenChange,
  warehouseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** This warehouse — the team searching, forcing and accepting. */
  warehouseId: bigint;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  // FULL SCREEN ONLY ON A PHONE — by the JS breakpoint, never a responsive `size`: Chakra merges a responsive variant, so
  // `{ base: "full", md: "lg" }` kept full's min-height on desktop and stretched the dialog to the window's height.
  const isMobile = useIsMobile();

  const [value, setValue] = useState("");
  // What was searched — set on Enter or the search button, never per keystroke: a scanner types a whole code at once.
  const [term, setTerm] = useState("");
  // The order whose Accept Return is opening — its detail is read first.
  const [accepting, setAccepting] = useState<bigint | null>(null);

  // A fresh search every time it opens.
  useEffect(() => {
    if (!open) return;

    setValue("");
    setTerm("");
    setAccepting(null);
  }, [open]);

  const query = useOrders({
    teamId: term === "" ? undefined : warehouseId,
    page: 1,
    pageSize: RESULT_LIMIT,
    status: OrderStatus.UNSPECIFIED,
    filters: { ...NO_ORDER_FILTERS, search: term },
  });
  const found = term === "" ? [] : (query.data?.orders ?? []);
  const shops = useShopsByIds({ shopIds: found.map((o) => o.shopId) }).data;

  const detail = useOrder({ teamId: accepting === null ? undefined : warehouseId, orderId: accepting ?? 0n });
  const acceptOrder = accepting !== null && detail.data && detail.data.id === accepting ? detail.data : null;

  const force = useForceReturn({ teamId: warehouseId, onForced: (order) => setAccepting(order.id) });

  const searching = term !== "" && query.isFetching;
  const error = query.isError ? rpcError(query.error) : "";

  function search() {
    const next = value.trim();
    if (next === "") return;

    setTerm(next);
    // Ready for the next parcel.
    setValue("");
    inputRef.current?.focus();
  }

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(e) => onOpenChange(e.open)}
        placement="center"
        size={isMobile ? "full" : "lg"}
        initialFocusEl={() => inputRef.current}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content data-testid="receive-return-dialog">
              <Dialog.Header>
                <Dialog.Title>{t("picking.receive.title")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="section">
                  <Text fontSize="sm" color="fg.muted">
                    {t("picking.receive.intro")}
                  </Text>

                  <HStack gap="2">
                    <Input
                      ref={inputRef}
                      value={value}
                      placeholder={t("picking.receive.placeholder")}
                      aria-label={t("picking.receive.placeholder")}
                      fontFamily="mono"
                      data-testid="receive-return-input"
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        search();
                      }}
                    />
                    <IconButton
                      variant="outline"
                      aria-label={t("picking.receive.search")}
                      title={t("picking.receive.search")}
                      loading={searching}
                      data-testid="receive-return-search"
                      onClick={search}
                    >
                      <Icon as={Search} boxSize="4" />
                    </IconButton>
                  </HStack>

                  {error && (
                    <Text color="fg.error" fontSize="sm" data-testid="receive-return-error">
                      {error}
                    </Text>
                  )}

                  {term !== "" && !error && (
                    <RefreshOverlay busy={searching && found.length > 0}>
                      <Stack gap="card" data-testid="receive-return-results">
                        <Text fontSize="xs" color="fg.muted">
                          {t("picking.receive.resultsFor", { term })}
                        </Text>

                        {query.isPending ? (
                          <Spinner colorPalette="brand" />
                        ) : found.length === 0 ? (
                          <NotFound term={term} />
                        ) : (
                          found.map((order) => (
                            <FoundOrder
                              key={order.id.toString()}
                              order={order}
                              shopName={shops?.get(order.shopId.toString())?.name ?? ""}
                              opening={accepting === order.id && !acceptOrder}
                              forcing={force.busy}
                              onAccept={() => setAccepting(order.id)}
                              onForce={() => force.ask({ id: order.id, status: order.status })}
                            />
                          ))
                        )}
                      </Stack>
                    </RefreshOverlay>
                  )}
                </Stack>
              </Dialog.Body>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {force.dialog}

      {/* Mounted once the order's lines are read; closing it leaves the search open for the next parcel. */}
      {acceptOrder && (
        <AcceptReturnDialog
          open
          onOpenChange={(next) => {
            if (next) return;
            setAccepting(null);
            inputRef.current?.focus();
          }}
          teamId={warehouseId}
          order={acceptOrder}
        />
      )}
    </>
  );
}

// ONE MATCH — what the crew checks against the parcel in their hands (the ref, the shop, the customer), its status, and
// the one thing they can do with it, or why there is nothing.
function FoundOrder({
  order,
  shopName,
  opening,
  forcing,
  onAccept,
  onForce,
}: {
  order: Order;
  shopName: string;
  opening: boolean;
  forcing: boolean;
  onAccept: () => void;
  onForce: () => void;
}) {
  const { t } = useTranslation();
  const id = order.id.toString();
  const reason = whyNot(order.status);

  return (
    <Stack
      gap="2"
      borderWidth="1px"
      borderColor="border.muted"
      rounded="md"
      px="3"
      py="2"
      data-testid={`receive-return-row-${id}`}
      data-status={order.status}
    >
      <Flex gap="2" align="center" wrap="wrap">
        <Text fontWeight="bold">#{id}</Text>
        {order.orderExternalRefId && (
          <Text fontFamily="mono" fontSize="sm" truncate minW="0">
            {order.orderExternalRefId}
          </Text>
        )}
        <OrderStatusBadge status={order.status} />
      </Flex>

      <Stack gap="0.5" fontSize="sm">
        <Text truncate>
          <Text as="span" color="fg.muted">
            {t("picking.receive.shop")}:{" "}
          </Text>
          <Text as="span" data-testid={`receive-return-shop-${id}`}>
            {shopName || "—"}
          </Text>
        </Text>
        <Text truncate>
          <Text as="span" color="fg.muted">
            {t("picking.receive.customer")}:{" "}
          </Text>
          {order.customerName}
        </Text>
        {order.receiptCode && (
          <Text truncate>
            <Text as="span" color="fg.muted">
              {t("picking.receive.tracking")}:{" "}
            </Text>
            <Text as="span" fontFamily="mono">
              {order.receiptCode}
            </Text>
          </Text>
        )}
      </Stack>

      {order.status === OrderStatus.RETURN ? (
        <Button
          colorPalette="brand"
          alignSelf={{ base: "stretch", md: "flex-end" }}
          loading={opening}
          data-testid={`receive-return-accept-${id}`}
          onClick={onAccept}
        >
          <Icon as={PackageCheck} boxSize="4" />
          {t("picking.action.acceptReturn")}
        </Button>
      ) : canForceReturn(order.status) ? (
        <Button
          colorPalette="brand"
          alignSelf={{ base: "stretch", md: "flex-end" }}
          loading={opening || forcing}
          data-testid={`receive-return-force-${id}`}
          onClick={onForce}
        >
          <Icon as={Undo2} boxSize="4" />
          {t("picking.action.forceReturn")}
        </Button>
      ) : (
        <Flex gap="2" align="flex-start" color="fg.muted" fontSize="sm" data-testid={`receive-return-reason-${id}`}>
          <Icon as={CircleSlash} boxSize="4" mt="0.5" flexShrink={0} />
          <Text>{t(reason, { id, status: t(orderStatusLabelKey(order.status)) })}</Text>
        </Flex>
      )}
    </Stack>
  );
}

/** The sentence for a status the warehouse cannot receive a parcel in (a-forced-return-follows-the-status-move). */
function whyNot(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.RETURN_COMPLETED:
      return "picking.receive.alreadyAccepted";
    case OrderStatus.CANCEL:
      return "picking.receive.cancelled";
    case OrderStatus.LOST:
      return "picking.receive.lost";
    default:
      // pending, processed, picked — the goods never left.
      return "picking.receive.notLeft";
  }
}

function NotFound({ term }: { term: string }) {
  const { t } = useTranslation();

  return (
    <Flex gap="3" align="flex-start" py="4" data-testid="receive-return-empty">
      <Icon as={PackageSearch} boxSize="6" color="fg.muted" flexShrink={0} />
      <Box>
        <Text fontWeight="bold">{t("picking.receive.notFound", { term })}</Text>
        <Text fontSize="sm" color="fg.muted">
          {t("picking.receive.notFoundHint")}
        </Text>
      </Box>
    </Flex>
  );
}

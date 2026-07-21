import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Ban, PackageCheck, Pencil } from "lucide-react";
import { rackClient, restockClient, rpcError, supplierClient } from "../api/clients";
import type { RestockRequest, RestockRequestItem } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { deltaLabel } from "./counting";
import { RestockStatusBadge } from "../components/RestockStatusBadge";
import { paymentTypeLabel } from "../components/PaymentTypeSelect";
import { ShippingBadge } from "../components/ShippingBadge";
import { toaster } from "../components/Toaster";
import { formatRupiah } from "../lib/money";

function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// `value` is a ReactNode, not a string: most fields are plain text, but some render a component (the
// courier is a ShippingBadge). An empty string still falls back to the muted "—" every other detail
// page shows; a component decides its own empty state.
function Field({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text as="div" fontSize="sm" lineClamp={3} data-testid={testId}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// A line's money is now STORED as the total (#140) — the number typed off the invoice — so there is
// nothing left to compute.
function lineTotal(item: RestockRequestItem): bigint {
  return item.totalPrice;
}

// What one piece cost, DERIVED and openly a rounding: 10.000 over 3 pieces shows 3.333 while the line
// still totals 10.000. The two columns can therefore look a rupiah apart, and that is the honest
// picture — the invoice said 10.000, and no per-piece figure divides it exactly.
function unitPrice(item: RestockRequestItem): bigint {
  if (item.quantity <= 0n) return 0n;

  return item.totalPrice / item.quantity;
}

// Where a line's goods ended up, as a person would say it (#137). Three cases, and collapsing any
// two of them would misreport where the stock physically is:
//
//   nothing arrived → "" (rendered "—"). There are no placements at all, and saying "Unplaced" would
//                     invent a pile of nothing for someone to go looking for.
//   unplaced        → the not-yet-shelved pile — a REAL place, not an absence. Worded by RackSelect's
//                     own key, so the receive dialog and this page cannot phrase one state two ways.
//   a rack id       → the rack's CODE. "A-01-3" is painted on the aisle; "7" is not, so an id we
//                     cannot resolve (the list failed, or the rack has since been deleted) says
//                     exactly that instead of showing a number nobody can walk to. It must not fall
//                     back to "Unplaced" either — that is a different fact, and it would send someone
//                     to the wrong end of the warehouse.
//
// SEVERAL PLACES ARE ORDINARY NOW (#154): a delivery of 100 across three shelves reads as
// "A-01-1 (60), B-02-1 (30), Unplaced (10)". The quantity is shown per place because "it is on three
// shelves" without saying how many are on each is not enough to go and pick it.
function rackLabel(t: TFunction, item: RestockRequestItem, codes: Record<string, string>): string {
  return item.placements
    .map((p) => {
      const where =
        p.place.case === "rackId"
          ? (codes[p.place.value.toString()] ?? t("restock.detail.rackUnknown"))
          : t("racks.select.unplaced");

      return `${where} (${p.quantity})`;
    })
    .join(", ");
}

// RestockRequestDetailPage is the dedicated detail route for a restock request (#125) — a PAGE, not a
// dialog. It is the ONE screen both sides of a restock read: RestockRequestDetail is scoped to the
// requester AND the target warehouse, so the same route serves both, and the actions are gated on
// which side you are (the requester may Cancel, the warehouse may Fulfil) exactly as the list is.
//
// #124 made a request a header plus MANY priced lines, which is what earns it a page: the list can
// only summarise the lines, and the per-line price/subtotal breakdown lives here.
export function RestockRequestDetailPage() {
  const { t } = useTranslation();
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();

  const id = parseRequestId(requestId);
  const teamId = current?.teamId;

  const [request, setRequest] = useState<RestockRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [rackCodes, setRackCodes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (teamId === undefined || id === 0n) {
      setError(id === 0n ? t("restock.detail.invalidId") : "");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await restockClient.restockRequestDetail({ teamId, requestId: id });
      setRequest(res.request ?? null);
    } catch (err) {
      setError(rpcError(err));
      setRequest(null);
    } finally {
      setLoading(false);
    }
  }, [teamId, id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const supplierId = request?.supplierId ?? 0n;
  const requestingTeamId = request?.requestingTeamId ?? 0n;

  // Only a FULFILLED request has been counted, so it is the only one whose `receivedQuantity` and
  // `receivedRackId` mean anything. On a cancelled request they are 0 for the same reason they are 0
  // on a pending one — nobody ever counted — so neither gets an Arrived column.
  //
  // Read off the optional `request` rather than the narrowed one below, because the rack lookup is a
  // hook: it has to be declared above the early returns, where `request` may still be null.
  const isFulfilled = request?.status === RestockRequestStatus.FULFILLED;
  const warehouseId = request?.warehouseId ?? 0n;

  // Both sides read this page, and they are NOT symmetric here. Compared explicitly against 0n/
  // undefined rather than `request?.warehouseId === current?.teamId`, which is true when both are
  // undefined — the loading state would briefly claim the viewer owns the warehouse.
  const isWarehouse = teamId !== undefined && warehouseId !== 0n && warehouseId === teamId;

  // The PLACE is the warehouse's own business, and the mirror image of the supplier above: racks
  // belong to the warehouse, RackList is scoped to it and demands a role IN it, so the requester
  // asking gets refused — the same reason the warehouse does not ask about the supplier. So it is
  // shown to the warehouse only. That is not merely a permission dodge: which shelf inside someone
  // else's building a line went on is not a fact the requester acts on, and rendering "Unknown rack"
  // down the column for them would report a broken lookup where the truth is "not your aisle". What
  // the requester wants to know — did my stock arrive — is the Arrived column, and it stays.
  const showPlaces = isFulfilled && isWarehouse;

  // The supplier belongs to the REQUESTING team's catalogue, and SupplierDetail is team-scoped — so
  // only the requester can resolve the name. The warehouse side asking would get NotFound, so it
  // doesn't ask: it shows "Supplier #<id>", and so does a lookup that fails for any other reason.
  useEffect(() => {
    if (teamId === undefined || supplierId === 0n || requestingTeamId !== teamId) {
      setSupplierName("");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await supplierClient.supplierDetail({ teamId, supplierId });
        if (!cancelled) setSupplierName(res.supplier?.name ?? "");
      } catch {
        if (!cancelled) setSupplierName("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teamId, supplierId, requestingTeamId]);

  // A line records WHERE it was put as a rack id, and an id is unreadable — so the warehouse's racks
  // are fetched once to turn each `receivedRackId` into the code someone can actually walk to.
  //
  // Scoped to the racks of the request's OWN warehouse, which is the only warehouse a line of it can
  // have been shelved in (the server refuses another's rack outright). Asked for only when the column
  // is actually shown: not before the request is fulfilled (nothing has been counted, so there is no
  // place to resolve), and not for the requester (see `showPlaces` — the call would only be denied).
  useEffect(() => {
    if (!showPlaces) {
      setRackCodes({});
      return;
    }

    let ignore = false;

    rackClient
      .rackList({ teamId: warehouseId, q: "", page: { page: 1, limit: 200 } })
      .then((res) => {
        if (ignore) return;

        const codes: Record<string, string> = {};
        for (const rack of res.racks) {
          codes[rack.id.toString()] = rack.code;
        }
        setRackCodes(codes);
      })
      .catch(() => {
        // Swallowed on purpose. The places are a detail OF this page, not the page — a rack list that
        // fails must not take the request down with it, and every line degrades on its own to
        // `rackLabel`'s unresolved wording.
        if (!ignore) setRackCodes({});
      });

    return () => {
      ignore = true;
    };
  }, [showPlaces, warehouseId]);

  const productsTotal = useMemo(
    () => (request?.items ?? []).reduce((sum, item) => sum + lineTotal(item), 0n),
    [request],
  );

  // Pieces, not money: what was asked for against what the count actually put on the shelf. Only
  // meaningful once the request is fulfilled — see `isFulfilled` above, which gates the display.
  const askedTotal = useMemo(
    () => (request?.items ?? []).reduce((sum, item) => sum + item.quantity, 0n),
    [request],
  );
  const receivedTotal = useMemo(
    () => (request?.items ?? []).reduce((sum, item) => sum + item.receivedQuantity, 0n),
    [request],
  );

  // The same arithmetic the create form's G does (#127): the goods, plus the freight on top.
  const grandTotal = productsTotal + (request?.shippingCost ?? 0n);

  // Cancel returns the updated request, so the page re-renders off the response rather than
  // re-fetching — the same move OrderDetailPage makes. (Accepting goes through
  // RestockReceiveDialog, which owns its own call and asks us to reload when it lands.)
  async function cancelRequest() {
    if (teamId === undefined || !request) return;

    try {
      const res = await restockClient.restockRequestCancel({ teamId, requestId: request.id });
      setRequest(res.request ?? request);
      toaster.create({ type: "success", title: t("restock.toast.cancelled") });
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.toast.cancelFailed"), description: rpcError(err) });
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
  const isRequester = request.requestingTeamId === current.teamId;

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

      <Flex align="center" gap="card">
        <Heading size="md" data-testid="restock-detail-title">
          {t("restock.detail.requestTitle", { id: request.id.toString() })}
        </Heading>
        <RestockStatusBadge status={request.status} />
        <Spacer />

        {/* Accepting is COUNTING (#133) — and since #154 it is also saying WHERE each part of a line
            went and what arrived broken, with the COD fee (#155) changing what it all cost. That is a
            form with sections, so it is a PAGE (#157), not a dialog. */}
        {isPending && isWarehouse && teamId !== undefined && (
          <Button
            colorPalette="brand"
            data-testid="restock-detail-fulfil"
            onClick={() => navigate(`/inventories/restock/${request.id}/accept`)}
          >
            <Icon as={PackageCheck} boxSize="4" />
            {t("restock.receive.title")}
          </Button>
        )}

        {/* Editing is gated exactly as Cancel is, and for the same two reasons: RestockRequestUpdate
            is scoped to the REQUESTING team (the warehouse asking gets NotFound), and it is refused
            with FailedPrecondition once the request leaves PENDING — the goods have moved by then.
            Offering a button that can only fail is worse than not offering it. */}
        {isPending && isRequester && (
          <Button
            variant="outline"
            data-testid="restock-detail-edit"
            onClick={() => navigate(`/inventories/restock/${request.id}/edit`)}
          >
            <Icon as={Pencil} boxSize="4" />
            {t("restock.edit")}
          </Button>
        )}

        {isPending && isRequester && (
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

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.request")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <Field
                label={t("restock.table.warehouse")}
                value={t("restock.warehouseRef", { id: request.warehouseId.toString() })}
              />
              <Field
                label={t("restock.table.requestedBy")}
                value={t("restock.teamRef", { id: request.requestingTeamId.toString() })}
              />
              <Field
                label={t("restock.table.shipment")}
                value={<ShippingBadge code={request.shippingCode} />}
              />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* The order the goods came from, mirroring the create form's B. Each field is legitimately
          absent (0n / ""), and an absent one renders the same muted "—" as anywhere else. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.form.orderDetails")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <Field
                label={t("restock.form.supplier")}
                value={
                  supplierId === 0n
                    ? ""
                    : supplierName || t("restock.detail.supplierRef", { id: supplierId.toString() })
                }
              />
              <Field label={t("restock.form.receipt")} value={request.receipt} />
              {/* #127: a free-text reference to an order living somewhere else (a marketplace, a
                  chat), not an id into this system — so it is shown verbatim, not as "Order #n". */}
              <Field
                label={t("restock.form.orderRef")}
                value={request.orderRef}
                testId="restock-detail-order-ref"
              />
              <Field
                label={t("restock.form.shippingCost")}
                value={formatRupiah(request.shippingCost)}
                testId="restock-detail-shipping-cost"
              />
              <Field
                label={t("restock.form.paymentType")}
                value={paymentTypeLabel(t, request.paymentType)}
                testId="restock-detail-payment-type"
              />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* The restock note (#127) — the create form's C. Free text up to 1000 chars, so it gets its
          own full-width card rather than a cell in the grid above. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.form.note")}
            </Text>
            <Text fontSize="sm" whiteSpace="pre-wrap" data-testid="restock-detail-note">
              {request.note || "—"}
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.form.products")}
            </Text>

            {/* The Arrived column exists only once the count HAS been made. `receivedQuantity` is 0
                on a pending request because nobody has opened the box yet — rendering that would
                read as "nothing came", when the truth is "not counted yet". So the asked quantity
                is the only meaningful number until the request is fulfilled, and it keeps its
                neutral "Qty" heading until there is a second number to tell it apart from. */}
            <Table.Root size="sm" data-testid="restock-detail-items">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("restock.detail.sku")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("restock.detail.name")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {isFulfilled ? t("restock.detail.asked") : t("restock.table.qty")}
                  </Table.ColumnHeader>
                  {isFulfilled && (
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.detail.arrived")}
                    </Table.ColumnHeader>
                  )}
                  {/* Fulfilled AND the warehouse's own — see `showPlaces`. Counting and shelving are
                      one act (#137), so Place sits beside Arrived; but only one of the two teams
                      reading this page can resolve a rack, or has any use for one. */}
                  {showPlaces && (
                    <Table.ColumnHeader>{t("restock.detail.place")}</Table.ColumnHeader>
                  )}
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.unitPrice")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.lineTotal")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {request.items.map((item) => {
                  const delta = isFulfilled ? deltaLabel(t, item.quantity, item.receivedQuantity) : "";

                  return (
                    <Table.Row
                      key={item.id.toString()}
                      data-testid={`restock-detail-item-${item.productId}`}
                    >
                      <Table.Cell>{item.sku}</Table.Cell>
                      <Table.Cell>{item.name}</Table.Cell>
                      <Table.Cell textAlign="end">{item.quantity.toString()}</Table.Cell>
                      {isFulfilled && (
                        <Table.Cell
                          textAlign="end"
                          data-testid={`restock-detail-received-${item.productId}`}
                        >
                          <Flex align="center" justify="end" gap="2" wrap="wrap">
                            <Text as="span" fontWeight={delta ? "semibold" : "normal"}>
                              {item.receivedQuantity.toString()}
                            </Text>
                            {/* Short and over are BOTH worth chasing, but they are not the same
                                problem: red is stock that never arrived, orange is stock that
                                arrived unasked. */}
                            {delta && (
                              <Badge
                                colorPalette={item.receivedQuantity < item.quantity ? "red" : "orange"}
                                data-testid={`restock-detail-delta-${item.productId}`}
                              >
                                {delta}
                              </Badge>
                            )}
                          </Flex>
                        </Table.Cell>
                      )}
                      {showPlaces && (
                        <Table.Cell data-testid={`restock-detail-place-${item.productId}`}>
                          {rackLabel(t, item, rackCodes) || "—"}
                        </Table.Cell>
                      )}
                      <Table.Cell textAlign="end">{formatRupiah(unitPrice(item))}</Table.Cell>
                      <Table.Cell textAlign="end">{formatRupiah(lineTotal(item))}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>

            <Separator />

            {/* The create form's E/F/G breakdown, read back: the goods, the freight, the sum. */}
            <Stack gap="1" align="end">
              {/* What the warehouse is actually holding because of this restock — the one number
                  the money breakdown below cannot tell you, since the money is what was ORDERED. */}
              {isFulfilled && (
                <Text fontSize="sm" color="fg.muted">
                  {t("restock.detail.receivedTotal")}:{" "}
                  <Text as="span" fontWeight="medium" data-testid="restock-detail-received-total">
                    {receivedTotal.toString()} / {askedTotal.toString()}
                  </Text>
                </Text>
              )}
              <Text fontSize="sm" color="fg.muted">
                {t("restock.summary.productsTotal")}:{" "}
                <Text as="span" data-testid="restock-detail-products-total">
                  {formatRupiah(productsTotal)}
                </Text>
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {t("restock.form.shippingCost")}:{" "}
                <Text as="span" data-testid="restock-detail-shipping">
                  {formatRupiah(request.shippingCost)}
                </Text>
              </Text>
              <Text fontSize="md" fontWeight="semibold" data-testid="restock-detail-total">
                {t("restock.summary.grandTotal")}: {formatRupiah(grandTotal)}
              </Text>
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}

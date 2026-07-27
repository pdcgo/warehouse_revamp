import { useMemo } from "react";
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
import { ArrowLeft, Ban, Pencil } from "lucide-react";
import { rpcError } from "../../api/clients";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamDetail } from "../../features/teams/queries";
import { useSupplier } from "../../features/suppliers/queries";
import { useRestockRequest, useCancelRestockRequest } from "../../features/restock/queries";
import { DetailField } from "../../features/restock/DetailField";
import { deltaLabel } from "../../features/restock/counting";
import { lineTotal, unitPrice } from "../../features/restock/lines";
import { askedQuantity, goodsTotal, receivedQuantity } from "../../features/restock/summary";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { RestockStatusBadge } from "../../components/RestockStatusBadge";
import { paymentTypeLabel } from "../../components/PaymentTypeSelect";
import { ShippingBadge } from "../../components/ShippingBadge";
import { toaster } from "../../components/Toaster";
import { formatUnixDate } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";

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
// The PLACE a line was shelved on is deliberately absent, and it is not a permissions dodge: RackList
// is scoped to the warehouse and would refuse this team outright, but more to the point, which shelf
// inside somebody else's building a line went on is not a fact a buyer acts on. What the buyer wants
// to know — did my stock arrive, and how much of it — is the Arrived column, and that stays.
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

  // Only a FULFILLED request has been counted, so it is the only one whose `receivedQuantity` means
  // anything. On a pending or cancelled request it is 0 because nobody ever opened the box — showing
  // that would read as "nothing came" when the truth is "not counted yet".
  const isFulfilled = request?.status === RestockRequestStatus.FULFILLED;

  const items = useMemo(() => request?.items ?? [], [request]);
  const productsTotal = useMemo(() => goodsTotal(items), [items]);
  const askedTotal = useMemo(() => askedQuantity(items), [items]);
  const receivedTotal = useMemo(() => receivedQuantity(items), [items]);

  // The goods plus EVERY freight charge on them — the same arithmetic the list's Value column does,
  // so a row and the page it opens can never disagree about what a restock cost.
  //
  // `cod_shipping_fee` is what the courier charged at the door (#155). The warehouse pays and enters
  // it, but it is freight on this team's goods, so it belongs in this team's total; it is 0 until a
  // delivery is accepted, and its row is hidden until there is one.
  const codFee = request?.codShippingFee ?? 0n;
  const grandTotal = productsTotal + (request?.shippingCost ?? 0n) + codFee;

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

      {/* WHERE IT IS GOING. No "Requested by" — every restock this page can open was raised by the
          team reading it, so the field could only repeat the team switcher. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.request")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 3 }} gap="card">
              <DetailField
                label={t("restock.table.destination")}
                value={
                  warehouse.data?.name ||
                  t("restock.warehouseRef", { id: request.warehouseId.toString() })
                }
                testId="restock-detail-warehouse"
              />
              <DetailField
                label={t("restock.table.shipment")}
                value={<ShippingBadge code={request.shippingCode} />}
              />
              <DetailField
                label={t("restock.detail.created")}
                value={formatUnixDate(request.createdAtUnix)}
              />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* WHAT WAS AGREED, AND WITH WHOM (#127) — the buying side's own card, and the one the
          warehouse's copy of this page does not have at all. Each field is legitimately absent
          (0n / ""), and an absent one renders the same muted "—" as anywhere else. */}
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.form.orderDetails")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <DetailField
                label={t("restock.form.supplier")}
                value={
                  supplierId === 0n
                    ? ""
                    : (supplier.data?.name ??
                      t("restock.detail.supplierRef", { id: supplierId.toString() }))
                }
                testId="restock-detail-supplier"
              />
              <DetailField label={t("restock.form.receipt")} value={request.receipt} />
              {/* #127: a free-text reference to an order living somewhere else (a marketplace, a
                  chat), not an id into this system — so it is shown verbatim, not as "Order #n". */}
              <DetailField
                label={t("restock.form.orderRef")}
                value={request.orderRef}
                testId="restock-detail-order-ref"
              />
              <DetailField
                label={t("restock.form.shippingCost")}
                value={formatRupiah(request.shippingCost)}
                testId="restock-detail-shipping-cost"
              />
              <DetailField
                label={t("restock.form.paymentType")}
                value={paymentTypeLabel(t, request.paymentType)}
                testId="restock-detail-payment-type"
              />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* The restock note (#127). Free text up to 1000 chars, so it gets its own full-width card
          rather than a cell in the grid above. */}
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

            {/* The Arrived column exists only once the count HAS been made — see `isFulfilled`. The
                asked quantity keeps its neutral "Qty" heading until there is a second number to tell
                it apart from. */}
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
                  <Table.ColumnHeader textAlign="end">
                    {t("restock.detail.unitPrice")}
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {t("restock.detail.lineTotal")}
                  </Table.ColumnHeader>
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
                                colorPalette={
                                  item.receivedQuantity < item.quantity ? "red" : "orange"
                                }
                                data-testid={`restock-detail-delta-${item.productId}`}
                              >
                                {delta}
                              </Badge>
                            )}
                          </Flex>
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

            {/* What was ordered, what it cost, and — once counted — what actually landed against it. */}
            <Stack gap="1" align="end">
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
              {/* Hidden until there IS one: most deliveries are not COD, and a "Rp 0" row would
                  invite the reader to wonder what they had missed. */}
              {codFee > 0n && (
                <Text fontSize="sm" color="fg.muted">
                  {t("restock.accept.codFee")}:{" "}
                  <Text as="span" data-testid="restock-detail-cod-fee">
                    {formatRupiah(codFee)}
                  </Text>
                </Text>
              )}
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

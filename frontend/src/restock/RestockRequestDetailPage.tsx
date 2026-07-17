import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
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
import { restockClient, rpcError, supplierClient } from "../api/clients";
import type { RestockRequest, RestockRequestItem } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
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

// A line's money: whole rupiah per unit × quantity. Both are bigint, so this never loses precision.
function lineTotal(item: RestockRequestItem): bigint {
  return item.quantity * item.price;
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

  const productsTotal = useMemo(
    () => (request?.items ?? []).reduce((sum, item) => sum + lineTotal(item), 0n),
    [request],
  );

  // The same arithmetic the create form's G does (#127): the goods, plus the freight on top.
  const grandTotal = productsTotal + (request?.shippingCost ?? 0n);

  // Both actions return the updated request, so the page re-renders off the response rather than
  // re-fetching — the same move OrderDetailPage makes.
  async function fulfilRequest() {
    if (teamId === undefined || !request) return;

    try {
      const res = await restockClient.restockRequestFulfill({ teamId, requestId: request.id });
      setRequest(res.request ?? request);
      toaster.create({ type: "success", title: t("restock.toast.fulfilled") });
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.toast.fulfilFailed"), description: rpcError(err) });
    }
  }

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
  const isWarehouse = request.warehouseId === current.teamId;

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

        {isPending && isWarehouse && (
          <ConfirmDialog
            title={t("restock.fulfil.title")}
            message={t("restock.fulfil.message")}
            confirmLabel={t("restock.fulfil.confirm")}
            destructive={false}
            onConfirm={fulfilRequest}
            trigger={
              <Button colorPalette="brand" data-testid="restock-detail-fulfil">
                <Icon as={PackageCheck} boxSize="4" />
                {t("restock.fulfil.action")}
              </Button>
            }
          />
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

            <Table.Root size="sm" data-testid="restock-detail-items">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("restock.detail.sku")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("restock.detail.name")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.table.qty")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.unitPrice")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.lineTotal")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {request.items.map((item) => (
                  <Table.Row
                    key={item.id.toString()}
                    data-testid={`restock-detail-item-${item.productId}`}
                  >
                    <Table.Cell>{item.sku}</Table.Cell>
                    <Table.Cell>{item.name}</Table.Cell>
                    <Table.Cell textAlign="end">{item.quantity.toString()}</Table.Cell>
                    <Table.Cell textAlign="end">{formatRupiah(item.price)}</Table.Cell>
                    <Table.Cell textAlign="end">{formatRupiah(lineTotal(item))}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>

            <Separator />

            {/* The create form's E/F/G breakdown, read back: the goods, the freight, the sum. */}
            <Stack gap="1" align="end">
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

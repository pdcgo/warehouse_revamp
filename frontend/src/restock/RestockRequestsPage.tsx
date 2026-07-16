import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Spacer,
  Spinner,
  Span,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Ban, PackageCheck } from "lucide-react";
import { restockClient, rpcError } from "../api/clients";
import type {
  RestockRequest,
  RestockRequestItem,
} from "../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Pagination } from "../components/Pagination";
import { RestockStatusBadge } from "../components/RestockStatusBadge";
import { ShippingBadge } from "../components/ShippingBadge";
import { toaster } from "../components/Toaster";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// The lines' total quantity — what the Qty column shows now that a request carries many products.
function totalQuantity(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.quantity, 0n);
}

// ItemsSummary condenses a request's lines into one table cell (#124). A request is multi-line now,
// but a LIST row is a scanning surface, not a breakdown: it shows the first line and counts the rest.
// The full per-line detail belongs to the detail page (#125). `items` is defensively allowed to be
// empty — the contract requires at least one line, so an empty one means a request written before
// #124 or a partial response, and neither should blank the whole table.
function ItemsSummary({ items }: { items: RestockRequestItem[] }) {
  const { t } = useTranslation();
  const [first, ...rest] = items;

  if (!first) {
    return (
      <Span fontSize="xs" color="fg.muted">
        {t("restock.table.noProducts")}
      </Span>
    );
  }

  return (
    <Stack gap="0">
      <Span fontWeight="medium">{first.sku}</Span>
      <Span fontSize="xs" color="fg.muted">
        {first.name}
      </Span>
      {rest.length > 0 && (
        <Span fontSize="xs" color="fg.muted">
          {t("restock.table.moreProducts", { count: rest.length })}
        </Span>
      )}
    </Stack>
  );
}

// RestockRequestsPage (#105) is the ONE screen both sides of a restock use. A single list serves
// both roles: RestockRequestList returns requests the CURRENT team MADE (requestingTeamId == teamId)
// AND requests TARGETING it as the warehouse (warehouseId == teamId). Per-row actions are gated on
// that same identity — the requester may Cancel a pending request, the target warehouse may Fulfil
// it. The team is the scope: current.teamId travels in every request body.
export function RestockRequestsPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [requests, setRequests] = useState<RestockRequest[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const teamId = current?.teamId;

  const load = useCallback(async () => {
    if (teamId === undefined) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await restockClient.restockRequestList({ teamId, page: { page, limit: pageSize } });

      setRequests(res.requests);
      setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
    } catch (err) {
      setError(rpcError(err));
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelRequest(request: RestockRequest) {
    if (teamId === undefined) {
      return;
    }

    try {
      await restockClient.restockRequestCancel({ teamId, requestId: request.id });
      toaster.create({ type: "success", title: t("restock.toast.cancelled") });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.toast.cancelFailed"), description: rpcError(err) });
    }
  }

  async function fulfilRequest(request: RestockRequest) {
    if (teamId === undefined) {
      return;
    }

    try {
      await restockClient.restockRequestFulfill({ teamId, requestId: request.id });
      toaster.create({ type: "success", title: t("restock.toast.fulfilled") });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.toast.fulfilFailed"), description: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.title")}</Heading>
        <Text color="fg.muted" data-testid="restock-requests-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("restock.title")}</Heading>
        <Badge colorPalette="brand">
          {current.teamName || t("restock.teamRef", { id: current.teamId.toString() })}
        </Badge>
        <Spacer />
        {/* Only a SELLING team creates restock requests; a warehouse team only fulfils them. */}
        {current.teamType === TeamType.SELLING && (
          <Button
            size="xs"
            colorPalette="brand"
            data-testid="open-create-restock"
            onClick={() => navigate("/inventories/restock/new")}
          >
            {t("restock.newRequest")}
          </Button>
        )}
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="restock-requests-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="restock-requests-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("restock.table.status")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.warehouse")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.requestedBy")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.product")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("restock.table.qty")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.shipment")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("restock.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {requests.map((request) => {
              const isPending = request.status === RestockRequestStatus.PENDING;
              const isRequester = request.requestingTeamId === current.teamId;
              const isWarehouse = request.warehouseId === current.teamId;

              return (
                <Table.Row
                  key={request.id.toString()}
                  data-testid={`restock-row-${request.id}`}
                  cursor="pointer"
                  _hover={{ bg: "bg.subtle" }}
                  onClick={() => navigate(`/inventories/restock/${request.id}`)}
                >
                  <Table.Cell data-testid={`restock-open-${request.id}`}>
                    <RestockStatusBadge status={request.status} />
                  </Table.Cell>
                  <Table.Cell>{t("restock.warehouseRef", { id: request.warehouseId.toString() })}</Table.Cell>
                  <Table.Cell>{t("restock.teamRef", { id: request.requestingTeamId.toString() })}</Table.Cell>
                  <Table.Cell>
                    <ItemsSummary items={request.items} />
                  </Table.Cell>
                  <Table.Cell textAlign="end">{totalQuantity(request.items).toString()}</Table.Cell>
                  <Table.Cell>
                    <ShippingBadge code={request.shippingCode} />
                  </Table.Cell>

                  {/* Stop the row's navigate from firing when a row action is used. */}
                  <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                    <HStack justify="end" gap="1">
                      {isPending && isRequester && (
                        <ConfirmDialog
                          title={t("restock.cancel.title")}
                          message={t("restock.cancel.message")}
                          confirmLabel={t("restock.cancel.confirm")}
                          onConfirm={() => cancelRequest(request)}
                          trigger={
                            <IconButton
                              size="xs"
                              variant="ghost"
                              colorPalette="red"
                              aria-label={t("restock.cancel.action")}
                              data-testid={`cancel-${request.id}`}
                            >
                              <Icon as={Ban} boxSize="4" />
                            </IconButton>
                          }
                        />
                      )}

                      {isPending && isWarehouse && (
                        <ConfirmDialog
                          title={t("restock.fulfil.title")}
                          message={t("restock.fulfil.message")}
                          confirmLabel={t("restock.fulfil.confirm")}
                          destructive={false}
                          onConfirm={() => fulfilRequest(request)}
                          trigger={
                            <IconButton
                              size="xs"
                              variant="ghost"
                              colorPalette="green"
                              aria-label={t("restock.fulfil.action")}
                              data-testid={`fulfil-${request.id}`}
                            >
                              <Icon as={PackageCheck} boxSize="4" />
                            </IconButton>
                          }
                        />
                      )}
                    </HStack>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && requests.length === 0 && !error && (
        <Text color="fg.muted" data-testid="restock-requests-empty">
          {t("restock.empty")}
        </Text>
      )}

      {!loading && (
        <Pagination
          count={totalItems}
          pageSize={pageSize}
          page={page}
          onPageChange={setPage}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
    </Stack>
  );
}

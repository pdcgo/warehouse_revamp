import { useState } from "react";
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
  Tabs,
  Text,
} from "@chakra-ui/react";
import { Ban, PackageCheck } from "lucide-react";
import { rpcError } from "../../api/clients";
import type {
  RestockRequest,
  RestockRequestItem,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useRestockRequests, useCancelRestockRequest } from "../../features/restock/queries";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Pagination } from "../../components/Pagination";
import { RestockStatusBadge } from "../../components/RestockStatusBadge";
import { ShippingBadge } from "../../components/ShippingBadge";
import { toaster } from "../../components/Toaster";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// The status tabs (#130). "All Status" leads, then one tab per status in lifecycle order.
//
// UNSPECIFIED is not a status a request can hold — it is the ABSENCE of a filter, which is exactly
// what "All Status" means to the RPC. That is why the tab list can be a plain map over statuses
// instead of a special case.
//
// The labels are the EXISTING `restock.status.*` keys — the same strings RestockStatusBadge renders,
// so a tab and the badges under it can never disagree. Only "All Status" needed a new key.
const STATUS_TABS = [
  { value: "all", labelKey: "restock.tab.allStatus", status: RestockRequestStatus.UNSPECIFIED },
  { value: "pending", labelKey: "restock.status.pending", status: RestockRequestStatus.PENDING },
  { value: "fulfilled", labelKey: "restock.status.fulfilled", status: RestockRequestStatus.FULFILLED },
  { value: "cancelled", labelKey: "restock.status.cancelled", status: RestockRequestStatus.CANCELLED },
];

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

  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const teamId = current?.teamId;

  // The tab IS the filter: it decides the `status` the RPC gets, and nothing else. Keeping the tab
  // (a string, what Tabs speaks) as the state and deriving everything else from it means they can
  // never drift out of sync — the status the server filters on and the label the empty state names
  // both come from this one row.
  const activeTab = STATUS_TABS.find((item) => item.value === tab) ?? STATUS_TABS[0];
  const status = activeTab.status;

  // The status filter is SERVER-side: the list is paginated, so filtering the loaded page here would
  // show only the matching rows that happened to land in this page — and `totalItems` would still
  // count the unfiltered set, misreporting the pager on every tab. It is in the query key for the
  // same reason: each tab is a different question with its own count.
  const query = useRestockRequests({ teamId, status, page, pageSize });
  const cancelMutation = useCancelRestockRequest();

  const requests = query.data?.requests ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // Switching tab restarts at page 1 — the page number belongs to the OLD filter, and page 5 of
  // "All Status" is very likely past the end of "Cancelled". Same reason the page-size control
  // resets it.
  function selectTab(value: string) {
    setTab(value);
    setPage(1);
  }

  async function cancelRequest(request: RestockRequest) {
    if (teamId === undefined) {
      return;
    }

    try {
      await cancelMutation.mutateAsync({ teamId, requestId: request.id });
      toaster.create({ type: "success", title: t("restock.toast.cancelled") });
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.toast.cancelFailed"), description: rpcError(err) });
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

      {/* One panel, whose value tracks the active tab: every tab shows the SAME table — only the
          `status` sent to the RPC differs — so there is nothing to duplicate per tab, and no
          lazyMount dance needed to keep one `restock-requests-table` in the DOM. */}
      <Tabs.Root value={tab} onValueChange={(e) => selectTab(e.value)}>
        <Tabs.List>
          {STATUS_TABS.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} data-testid={`restock-tab-${item.value}`}>
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <Stack gap="section">
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
                        <Table.Cell>
                          {t("restock.warehouseRef", { id: request.warehouseId.toString() })}
                        </Table.Cell>
                        <Table.Cell>
                          {t("restock.teamRef", { id: request.requestingTeamId.toString() })}
                        </Table.Cell>
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

                            {/* Accepting is COUNTING (#133), and since #154 also placing and
                                writing off — a form with sections, so the row action opens the
                                Accept PAGE (#157). There is still no one-click "as asked": the
                                contract has no such call. */}
                            {isPending && isWarehouse && teamId !== undefined && (
                              <IconButton
                                size="xs"
                                variant="ghost"
                                colorPalette="green"
                                aria-label={t("restock.receive.title")}
                                data-testid={`fulfil-${request.id}`}
                                onClick={() => navigate(`/inventories/restock/${request.id}/accept`)}
                              >
                                <Icon as={PackageCheck} boxSize="4" />
                              </IconButton>
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
                {/* "…none yet" is only true of the whole list. Under a tab the list is not empty,
                    THIS STATUS is — so say which one, reusing the tab's OWN labelKey rather than
                    rebuilding it from the tab value: a key spelled by concatenation breaks silently
                    the day a tab value stops matching a status key (#130). */}
                {activeTab.status === RestockRequestStatus.UNSPECIFIED
                  ? t("restock.empty")
                  : t("restock.emptyFiltered", { status: t(activeTab.labelKey).toLowerCase() })}
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
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

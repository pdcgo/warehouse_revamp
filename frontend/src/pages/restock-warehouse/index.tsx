import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
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
import { PackageCheck, Printer, Receipt } from "lucide-react";
import { rpcError } from "../../api/clients";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { useRestockRequests } from "../../features/restock/queries";
import { RestockItemsCell } from "../../features/restock/RestockItemsCell";
import { RESTOCK_STATUS_TABS, restockTab } from "../../features/restock/statusTabs";
import { shortfall } from "../../features/restock/summary";
import { Pagination } from "../../components/Pagination";
import { RestockStatusBadge } from "../../components/RestockStatusBadge";
import { ShippingBadge } from "../../components/ShippingBadge";
import { formatUnixDate } from "../../lib/datetime";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// How many names to resolve for the "From" column — see the same constant on the selling page.
const NAME_LOOKUP_SIZE = 200;

// RestockWarehousePage — the RESTOCK LIST AS THE RECEIVING WAREHOUSE SEES IT (#133).
//
// The other half of the screen that used to serve both sides (#122). A warehouse is not buying
// anything: it is working an INBOUND QUEUE. The job on this page is to find what is waiting and
// accept it — count what actually turned up and say which shelf it went on (#133/#137/#154) — and
// afterwards to print the labels and the receipt for what it shelved.
//
// So the money is deliberately ABSENT. Line totals, freight and committed value belong to the team
// that spent them; a warehouse needs to know what arrived and where it goes, and putting another
// team's purchase prices on the receiving crew's work queue would be showing them somebody else's
// invoice to do a counting job.
//
// There is no "Destination" column for the mirror-image reason the selling list has no "Requested
// by": every row here targets the warehouse reading it, so the column could only repeat the team
// switcher. What varies — and therefore what leads — is WHO the goods are coming FROM.
export function RestockWarehousePage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const teamId = current?.teamId;

  const activeTab = restockTab(tab);
  const status = activeTab.status;

  const query = useRestockRequests({ teamId, status, page, pageSize });

  // Every team type, not just SELLING: a root team can raise a restock too, and a "From" column that
  // silently failed to name one would read as a missing team rather than an unfiltered lookup.
  const teams = useTeams({ page: 1, pageSize: NAME_LOOKUP_SIZE });

  const teamNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const team of teams.data?.teams ?? []) out[team.id.toString()] = team.name;
    return out;
  }, [teams.data]);

  const requests = query.data?.requests ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  function selectTab(value: string) {
    setTab(value);
    setPage(1);
  }

  function teamLabel(id: bigint): string {
    return teamNames[id.toString()] ?? t("restock.teamRef", { id: id.toString() });
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.inbound.title")}</Heading>
        <Text color="fg.muted" data-testid="restock-inbound-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Stack gap="0">
          <Heading size="md">{t("restock.inbound.title")}</Heading>
          <Text fontSize="sm" color="fg.muted">
            {t("restock.inbound.subtitle")}
          </Text>
        </Stack>
        <Badge colorPalette="brand">
          {current.teamName || t("restock.teamRef", { id: current.teamId.toString() })}
        </Badge>
        <Spacer />
        {/* No "New restock" here, and that is the rule rather than an omission: a warehouse does not
            order goods for itself — it receives what a selling team bought (#105). */}
      </Flex>

      <Tabs.Root value={tab} onValueChange={(e) => selectTab(e.value)}>
        <Tabs.List>
          {RESTOCK_STATUS_TABS.map((item) => (
            <Tabs.Trigger
              key={item.value}
              value={item.value}
              data-testid={`restock-tab-${item.value}`}
            >
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <Stack gap="section">
            {error && (
              <Text color="red.fg" data-testid="restock-inbound-error">
                {error}
              </Text>
            )}

            {loading ? (
              <Spinner colorPalette="brand" />
            ) : (
              <Table.Root size="sm" data-testid="restock-inbound-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("restock.table.restock")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.from")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.status")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.product")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.shipment")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.table.actions")}
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>

                <Table.Body>
                  {requests.map((request) => {
                    const isPending = request.status === RestockRequestStatus.PENDING;
                    const isFulfilled = request.status === RestockRequestStatus.FULFILLED;
                    const short = shortfall(request);

                    return (
                      <Table.Row
                        key={request.id.toString()}
                        data-testid={`restock-row-${request.id}`}
                        cursor="pointer"
                        _hover={{ bg: "bg.subtle" }}
                        onClick={() => navigate(`/inventories/restock/${request.id}`)}
                      >
                        <Table.Cell data-testid={`restock-open-${request.id}`}>
                          <Stack gap="0">
                            <Span fontWeight="medium">#{request.id.toString()}</Span>
                            <Span fontSize="xs" color="fg.muted">
                              {formatUnixDate(request.createdAtUnix)}
                            </Span>
                          </Stack>
                        </Table.Cell>
                        <Table.Cell>{teamLabel(request.requestingTeamId)}</Table.Cell>
                        <Table.Cell>
                          <Stack gap="1" align="start">
                            <RestockStatusBadge status={request.status} />
                            {/* The warehouse's OWN count is what produced this gap, so it belongs on
                                its list too — it is the record of what it reported at the door. */}
                            {short > 0n && (
                              <Badge
                                colorPalette="orange"
                                data-testid={`restock-short-${request.id}`}
                              >
                                {t("restock.table.shortBy", { count: Number(short) })}
                              </Badge>
                            )}
                          </Stack>
                        </Table.Cell>
                        <Table.Cell>
                          {/* Unpriced here, deliberately — see the money note in this page's header
                              comment. The warehouse's DETAIL page still prices the same lines. */}
                          <RestockItemsCell items={request.items} showPrices={false} />
                        </Table.Cell>
                        <Table.Cell>
                          <Stack gap="0" align="start">
                            <ShippingBadge code={request.shippingCode} />
                            {request.receipt && (
                              <Span fontSize="xs" color="fg.muted">
                                {request.receipt}
                              </Span>
                            )}
                          </Stack>
                        </Table.Cell>

                        {/* Stop the row's navigate from firing when a row action is used. */}
                        <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                          <HStack justify="end" gap="1">
                            {/* Accepting is COUNTING (#133), and since #154 also placing and writing
                                off — a form with sections, so the row action opens the Accept PAGE
                                (#157). There is deliberately no one-click "as asked". */}
                            {isPending && (
                              <IconButton
                                size="xs"
                                variant="ghost"
                                colorPalette="green"
                                aria-label={t("restock.receive.title")}
                                data-testid={`fulfil-${request.id}`}
                                onClick={() =>
                                  navigate(`/inventories/restock/${request.id}/accept`)
                                }
                              >
                                <Icon as={PackageCheck} boxSize="4" />
                              </IconButton>
                            )}

                            {/* What the crew does immediately AFTER accepting: stick a label on each
                                shelved placement (#207), and file the goods-received document. */}
                            {isFulfilled && (
                              <IconButton
                                size="xs"
                                variant="ghost"
                                aria-label={t("restock.labels.action")}
                                data-testid={`labels-${request.id}`}
                                onClick={() =>
                                  navigate(`/inventories/restock/${request.id}/labels`)
                                }
                              >
                                <Icon as={Printer} boxSize="4" />
                              </IconButton>
                            )}

                            {isFulfilled && (
                              <IconButton
                                size="xs"
                                variant="ghost"
                                aria-label={t("restock.table.receipt")}
                                data-testid={`receipt-${request.id}`}
                                onClick={() =>
                                  navigate(`/inventories/restock/${request.id}/receipt`)
                                }
                              >
                                <Icon as={Receipt} boxSize="4" />
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
              <Text color="fg.muted" data-testid="restock-inbound-empty">
                {activeTab.status === RestockRequestStatus.UNSPECIFIED
                  ? t("restock.inbound.empty")
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

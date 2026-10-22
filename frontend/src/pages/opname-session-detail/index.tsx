import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Heading,
  HStack,
  Icon,
  IconButton,
  Menu,
  Portal,
  Span,
  Spinner,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, ClipboardList, Flag, MoreHorizontal, Undo2, XCircle } from "lucide-react";

import { rpcError } from "../../api/clients";
import { type OpnameRow, OpnameRowStatus, OpnameSessionStatus } from "../../gen/warehouse/inventory/v1/opname_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { differenceOf } from "../../features/opname/adapt";
import {
  OpnameDifference,
  OpnameDrafts,
  OpnamePlanBadge,
  OpnameRowStateBadge,
  OpnameSessionStatusBadge,
} from "../../features/opname/OpnameBadges";
import {
  useCancelOpnameSession,
  useOpnameRows,
  useOpnameSession,
  useSendBackOpnameRow,
} from "../../features/opname/queries";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { RackSelect } from "../../components/pickers/RackSelect";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDateTime } from "../../lib/datetime";
import { canManageOpname } from "../../lib/roles";

const ROW_TABS = [
  { value: "all", status: OpnameRowStatus.UNSPECIFIED, labelKey: "opnameSession.detail.tabs.all" },
  { value: "created", status: OpnameRowStatus.CREATED, labelKey: "opnameSession.detail.tabs.created" },
  { value: "counted", status: OpnameRowStatus.COUNTED, labelKey: "opnameSession.detail.tabs.counted" },
] as const;

// OpnameSessionDetailPage — THE ADMIN'S WATCH PAGE (opname.md §How Staff Work On Session: "admin watch page and refresh
// opname session detail periodically"). Every row arrives here as staff mark it counted, WITH the book figure and the
// drafts' reasons — which is why it is the admin's, never staff's (a-count-is-blind-then-revealed). From here the admin
// sends a doubtful row back to counting (a-counted-row-is-read-only-until-sent-back), cancels an abandoned count
// (an-abandoned-count-waits-for-the-admin), or goes on to Finalize once every row is counted.
//
// ⚠ PROTOTYPE until design_accept — Storybook's stub plays it.
export function OpnameSessionDetailPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const params = useParams();
  const sessionId = BigInt(params.sessionId ?? "0");

  const [tab, setTab] = useState<(typeof ROW_TABS)[number]["value"]>("all");
  const [q, setQ] = useState("");
  const [rack, setRack] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sendingBack, setSendingBack] = useState<OpnameRow | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const teamId = current?.teamId;
  const placementId = rack !== "" ? BigInt(rack) : 0n;
  const status = ROW_TABS.find((x) => x.value === tab)!.status;

  const detail = useOpnameSession({ teamId, sessionId });
  const rows = useOpnameRows({ teamId, sessionId, placementId, status, onlyDifferences, q, page, pageSize });
  const sendBack = useSendBackOpnameRow();
  const cancel = useCancelOpnameSession();
  const teams = useTeamsByIds({ ids: (rows.data?.rows ?? []).map((r) => r.teamId) });

  const refilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  if (!current || teamId === undefined) {
    return <Text color="fg.muted">{t("opnameSession.selectTeam")}</Text>;
  }
  if (!canManageOpname(current.role)) {
    return (
      <Text color="fg.muted" data-testid="opname-detail-forbidden">
        {t("opnameSession.detail.managersOnly")}
      </Text>
    );
  }

  const session = detail.data?.session ?? null;
  const sessionActors = detail.data?.actors ?? new Map<string, PublicUser>();
  const rowActors = rows.data?.actors ?? new Map<string, PublicUser>();
  const nameOf = (actors: Map<string, PublicUser>, id: bigint) => (id > 0n ? (actors.get(id.toString())?.name ?? `#${id}`) : "");
  const teamName = (id: bigint) => teams.data?.[id.toString()]?.name ?? `#${id}`;
  const error = detail.isError ? rpcError(detail.error) : rows.isError ? rpcError(rows.error) : "";

  if (detail.isPending) return <Spinner colorPalette="brand" />;
  if (!session) {
    return (
      <Text color="error.fg" data-testid="opname-detail-error">
        {error || t("opnameSession.detail.notFound")}
      </Text>
    );
  }

  const active = session.status === OpnameSessionStatus.ACTIVE;
  const allCounted = session.rowCount > 0n && session.countedRowCount === session.rowCount;
  const filtering = (q !== "" ? 1 : 0) + (placementId > 0n ? 1 : 0) + (onlyDifferences ? 1 : 0);
  const list = rows.data?.rows ?? [];

  async function confirmSendBack() {
    if (!sendingBack) return;
    try {
      await sendBack.mutateAsync({ teamId: teamId!, rowId: sendingBack.id });
      toaster.create({ type: "success", title: t("opnameSession.detail.sentBack", { code: sendingBack.placementCode }) });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  async function confirmCancel() {
    try {
      await cancel.mutateAsync({ teamId: teamId!, sessionId });
      toaster.create({ type: "success", title: t("opnameSession.detail.cancelled", { id: sessionId.toString() }) });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  const actionButtons = active && (
    <>
      <Button size="xs" variant="outline" onClick={() => navigate(`/inventories/opname/sessions/${sessionId}/count`)} data-testid="opname-detail-count">
        <Icon as={ClipboardList} boxSize="4" />
        {t("opnameSession.active.count")}
      </Button>
      <Button size="xs" variant="outline" colorPalette="red" onClick={() => setCancelling(true)} data-testid="opname-detail-cancel">
        <Icon as={XCircle} boxSize="4" />
        {t("opnameSession.detail.cancel")}
      </Button>
      <Button
        size="xs"
        colorPalette="brand"
        disabled={!allCounted}
        onClick={() => navigate(`/inventories/opname/sessions/${sessionId}/finalize`)}
        data-testid="opname-detail-finalize"
      >
        <Icon as={Flag} boxSize="4" />
        {t("opnameSession.detail.finalize")}
      </Button>
    </>
  );

  return (
    <Stack gap="section" data-testid="opname-detail-page">
      <Flex align="flex-start" gap="card" wrap="wrap">
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <HStack gap="2" wrap="wrap">
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("opnameSession.back")}
              onClick={() => navigate("/inventories/opname/sessions")}
              data-testid="opname-detail-back"
            >
              <Icon as={ArrowLeft} boxSize="4" />
            </IconButton>
            <Heading size="md" data-testid="opname-detail-heading">
              {t("opnameSession.detail.title", { id: session.id.toString() })}
            </Heading>
            <OpnameSessionStatusBadge status={session.status} />
            <OpnamePlanBadge plan={session.plan} />
            {isMobile && active && (
              <Box ms="auto">
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <IconButton size="xs" variant="ghost" aria-label={t("opnameSession.detail.actions")} data-testid="opname-detail-menu">
                      <Icon as={MoreHorizontal} boxSize="4" />
                    </IconButton>
                  </Menu.Trigger>
                  <Portal>
                    <Menu.Positioner>
                      <Menu.Content>
                        <Menu.Item value="count" onClick={() => navigate(`/inventories/opname/sessions/${sessionId}/count`)}>
                          <Icon as={ClipboardList} boxSize="4" />
                          {t("opnameSession.active.count")}
                        </Menu.Item>
                        <Menu.Item
                          value="finalize"
                          disabled={!allCounted}
                          onClick={() => navigate(`/inventories/opname/sessions/${sessionId}/finalize`)}
                        >
                          <Icon as={Flag} boxSize="4" />
                          {t("opnameSession.detail.finalize")}
                        </Menu.Item>
                        <Menu.Item value="cancel" color="fg.error" onClick={() => setCancelling(true)}>
                          <Icon as={XCircle} boxSize="4" />
                          {t("opnameSession.detail.cancel")}
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Positioner>
                  </Portal>
                </Menu.Root>
              </Box>
            )}
          </HStack>
          <Text fontSize="sm" color="fg.muted" data-testid="opname-detail-started">
            {t("opnameSession.detail.started", {
              who: nameOf(sessionActors, session.createdById),
              when: formatUnixDateTime(session.createdAtUnix),
            })}
            {session.finalizedById > 0n &&
              ` · ${t("opnameSession.detail.finalizedBy", {
                who: nameOf(sessionActors, session.finalizedById),
                when: formatUnixDateTime(session.finalizedAtUnix),
              })}`}
          </Text>
        </Stack>
        {!isMobile && (
          <HStack gap="2" wrap="wrap">
            {actionButtons}
          </HStack>
        )}
      </Flex>

      {active && !allCounted && (
        <Text fontSize="sm" color="fg.muted" data-testid="opname-detail-finalize-wait">
          {t("opnameSession.detail.finalizeWaits", {
            left: (session.rowCount - session.countedRowCount).toString(),
          })}
        </Text>
      )}

      <SummaryStrip testId="opname-detail-summary">
        <SummaryCard
          label={t("opnameSession.detail.summary.counted")}
          value={`${session.countedRowCount} / ${session.rowCount}`}
          line={t("opnameSession.detail.summary.countedLine")}
          emphasis
          testId="opname-summary-counted"
        />
        <SummaryCard
          label={t("opnameSession.detail.summary.differences")}
          value={session.differenceRowCount.toString()}
          line={t("opnameSession.detail.summary.differencesLine")}
          testId="opname-summary-differences"
        />
        <SummaryCard label={t("opnameSession.detail.summary.racks")} value={session.rackCount.toString()} testId="opname-summary-racks" />
        <SummaryCard
          label={t("opnameSession.detail.summary.products")}
          value={session.productCount.toString()}
          testId="opname-summary-products"
        />
      </SummaryStrip>

      <FilterBar
        active={filtering > 0}
        count={filtering}
        testId="opname-detail-filters"
        onClear={() =>
          refilter(() => {
            setQ("");
            setRack("");
            setOnlyDifferences(false);
          })
        }
      >
        <FilterSearch
          value={q}
          onChange={(value) => refilter(() => setQ(value))}
          placeholder={t("opnameSession.detail.search")}
          testId="opname-detail-search"
        />
        <FilterField w="14rem" testId="opname-detail-rack-filter">
          <RackSelect
            warehouseId={teamId}
            value={rack}
            onChange={(v) => refilter(() => setRack(v))}
            placeholder={t("opnameSession.detail.rackAll")}
          />
        </FilterField>
        <FilterField testId="opname-detail-differences-filter">
          <Checkbox.Root
            checked={onlyDifferences}
            onCheckedChange={(e) => refilter(() => setOnlyDifferences(!!e.checked))}
            data-testid="opname-detail-only-differences"
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>{t("opnameSession.detail.onlyDifferences")}</Checkbox.Label>
          </Checkbox.Root>
        </FilterField>
      </FilterBar>

      <Tabs.Root value={tab} onValueChange={(e) => refilter(() => setTab(e.value as typeof tab))}>
        <Tabs.List overflowX="auto">
          {ROW_TABS.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} data-testid={`opname-detail-tab-${item.value}`}>
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <RefreshOverlay busy={rows.isFetching && !rows.isPending}>
            <Stack gap="section">
              {error && (
                <Text color="error.fg" data-testid="opname-detail-rows-error">
                  {error}
                </Text>
              )}

              {rows.isPending ? (
                <Spinner colorPalette="brand" />
              ) : list.length === 0 ? (
                <Text color="fg.muted" data-testid="opname-detail-empty">
                  {t("opnameSession.detail.empty")}
                </Text>
              ) : isMobile ? (
                <Stack gap="2" data-testid="opname-detail-blocks">
                  {list.map((row) => (
                    <Card.Root key={row.id.toString()} variant="outline" size="sm" data-testid={`opname-row-${row.id}`}>
                      <Card.Body gap="2">
                        <HStack justify="space-between" gap="2" align="flex-start">
                          <Stack gap="0" minW="0">
                            <Span fontWeight="bold">{row.productName}</Span>
                            <Span fontSize="xs" color="fg.muted">
                              {row.placementCode} · {row.productSku} · {teamName(row.teamId)}
                            </Span>
                          </Stack>
                          <OpnameRowStateBadge row={row} />
                        </HStack>
                        {row.revealed && (
                          <Text fontSize="sm">
                            {t("opnameSession.detail.bookCount", {
                              book: row.systemStockCount.toString(),
                              count: row.recountedStockCount.toString(),
                            })}{" "}
                            <OpnameDifference value={differenceOf(row)} />
                          </Text>
                        )}
                        <OpnameDrafts drafts={row.drafts} />
                        {row.countedById > 0n && (
                          <Span fontSize="xs" color="fg.muted">
                            {t("opnameSession.detail.countedBy", { who: nameOf(rowActors, row.countedById) })}
                          </Span>
                        )}
                        {active && row.status === OpnameRowStatus.COUNTED && (
                          <Button size="xs" variant="outline" alignSelf="flex-start" onClick={() => setSendingBack(row)} data-testid={`opname-row-send-back-${row.id}`}>
                            <Icon as={Undo2} boxSize="4" />
                            {t("opnameSession.detail.sendBack")}
                          </Button>
                        )}
                      </Card.Body>
                    </Card.Root>
                  ))}
                </Stack>
              ) : (
                <Box overflowX="auto">
                  <Table.Root size="sm" data-testid="opname-detail-table">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>{t("opnameSession.detail.table.rack")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("opnameSession.detail.table.product")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("opnameSession.detail.table.state")}</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">{t("opnameSession.detail.table.book")}</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">{t("opnameSession.detail.table.count")}</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">{t("opnameSession.detail.table.difference")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("opnameSession.detail.table.drafts")}</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">{t("opnameSession.detail.table.actions")}</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {list.map((row) => (
                        <Table.Row key={row.id.toString()} _hover={{ bg: "bg.subtle" }} data-testid={`opname-row-${row.id}`}>
                          <Table.Cell fontWeight="medium" whiteSpace="nowrap">
                            {row.placementCode}
                          </Table.Cell>
                          <Table.Cell minW="14rem">
                            <Stack gap="0">
                              <Span>{row.productName}</Span>
                              <Span fontSize="xs" color="fg.muted">
                                {row.productSku} · {teamName(row.teamId)}
                              </Span>
                            </Stack>
                          </Table.Cell>
                          <Table.Cell>
                            <Stack gap="0" align="flex-start">
                              <OpnameRowStateBadge row={row} />
                              {row.countedById > 0n && (
                                <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                                  {nameOf(rowActors, row.countedById)}
                                </Span>
                              )}
                            </Stack>
                          </Table.Cell>
                          <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums" data-testid={`opname-row-book-${row.id}`}>
                            {row.systemStockCount.toString()}
                          </Table.Cell>
                          <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
                            {row.revealed ? row.recountedStockCount.toString() : "—"}
                          </Table.Cell>
                          <Table.Cell textAlign="end">
                            {row.revealed ? <OpnameDifference value={differenceOf(row)} testId={`opname-row-difference-${row.id}`} /> : "—"}
                          </Table.Cell>
                          <Table.Cell minW="16rem">
                            <OpnameDrafts drafts={row.drafts} testId={`opname-row-drafts-${row.id}`} />
                          </Table.Cell>
                          <Table.Cell textAlign="end">
                            {active && row.status === OpnameRowStatus.COUNTED && (
                              <Button size="xs" variant="outline" onClick={() => setSendingBack(row)} data-testid={`opname-row-send-back-${row.id}`}>
                                <Icon as={Undo2} boxSize="4" />
                                {t("opnameSession.detail.sendBack")}
                              </Button>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                </Box>
              )}

              <GrowingPager
                page={page}
                onPageChange={setPage}
                hasNext={rows.data?.hasNext}
                resetKey={`${tab}:${q}:${rack}:${onlyDifferences}:${pageSize}`}
                pageSize={pageSize}
                pageSizeOptions={[20, 50, 100]}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
                testId="opname-detail-pager"
              />
            </Stack>
          </RefreshOverlay>
        </Tabs.Content>
      </Tabs.Root>

      <ConfirmDialog
        open={sendingBack !== null}
        onOpenChange={(open) => !open && setSendingBack(null)}
        title={t("opnameSession.detail.sendBackTitle")}
        message={
          sendingBack
            ? t("opnameSession.detail.sendBackMessage", { product: sendingBack.productName, code: sendingBack.placementCode })
            : ""
        }
        confirmLabel={t("opnameSession.detail.sendBack")}
        dismissLabel={t("opnameSession.create.dismiss")}
        onConfirm={confirmSendBack}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("opnameSession.detail.cancelTitle", { id: sessionId.toString() })}
        message={t("opnameSession.detail.cancelMessage")}
        confirmLabel={t("opnameSession.detail.cancel")}
        dismissLabel={t("opnameSession.create.dismiss")}
        onConfirm={confirmCancel}
      />
    </Stack>
  );
}

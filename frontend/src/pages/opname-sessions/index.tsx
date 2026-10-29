import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Button, Card, Flex, Heading, HStack, Icon, Span, Spinner, Stack, Table, Tabs, Text } from "@chakra-ui/react";
import { ClipboardList, Eye, Plus } from "lucide-react";

import { rpcError } from "../../api/clients";
import { type OpnameSession, OpnameSessionStatus } from "../../gen/warehouse/inventory/v1/opname_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useActiveOpnameSession, useOpnameSessions } from "../../features/opname/queries";
import { OpnamePlanBadge, OpnameSessionStatusBadge } from "../../features/opname/OpnameBadges";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { canManageOpname } from "../../lib/roles";
import { NewSessionDialog } from "./components/NewSessionDialog";

const TABS = [
  { value: "all", status: OpnameSessionStatus.UNSPECIFIED, labelKey: "opnameSession.tabs.all" },
  { value: "active", status: OpnameSessionStatus.ACTIVE, labelKey: "opnameSession.status.active" },
  { value: "finish", status: OpnameSessionStatus.FINISH, labelKey: "opnameSession.status.finish" },
  { value: "cancel", status: OpnameSessionStatus.CANCEL, labelKey: "opnameSession.status.cancel" },
] as const;

// OpnameSessionsPage — A WAREHOUSE'S STOCK COUNTS (docs/business/inventory/opname.md). The admin plans a count here; staff
// come here to find the ONE active count and start counting (one-active-count-per-warehouse), so that count stands at the
// top, above the history, with its own Count button.
//
// ⚠ PROTOTYPE until design_accept: it runs against Storybook's stub; in the app OpnameService answers Unimplemented. It
// sits BESIDE the old one-rack opname page (/inventories/opname), which the backend step replaces.
export function OpnameSessionsPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [creating, setCreating] = useState(false);

  const teamId = current?.teamId;
  const status = TABS.find((x) => x.value === tab)!.status;
  const manager = canManageOpname(current?.role);

  const list = useOpnameSessions({ teamId, status, page, pageSize });
  const active = useActiveOpnameSession(teamId);

  if (!current || teamId === undefined) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("opnameSession.title")}</Heading>
        <Text color="fg.muted">{t("opnameSession.selectTeam")}</Text>
      </Stack>
    );
  }

  const sessions = list.data?.sessions ?? [];
  const actors = list.data?.actors ?? new Map<string, PublicUser>();
  const nameOf = (id: bigint) => (id > 0n ? (actors.get(id.toString())?.name ?? `#${id}`) : "");
  const error = list.isError ? rpcError(list.error) : active.isError ? rpcError(active.error) : "";
  const activeSession = active.data ?? null;

  // A manager opens the watch page; staff can only count, and only the active one.
  const open = (s: OpnameSession) => {
    if (manager) navigate(`/inventories/opname/sessions/${s.id}`);
    else if (s.status === OpnameSessionStatus.ACTIVE) navigate(`/inventories/opname/sessions/${s.id}/count`);
  };

  return (
    <Stack gap="section" data-testid="opname-sessions-page">
      <Flex align="flex-start" gap="card" wrap="wrap">
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <Heading size="md" data-testid="opname-sessions-heading">
            {t("opnameSession.title")}
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            {t("opnameSession.subtitle")}
          </Text>
        </Stack>
        {manager && (
          <Button
            size="xs"
            colorPalette="brand"
            disabled={!!activeSession}
            onClick={() => setCreating(true)}
            data-testid="opname-new-session"
          >
            <Icon as={Plus} boxSize="4" />
            {t("opnameSession.create.open")}
          </Button>
        )}
      </Flex>

      {error && (
        <Text color="error.fg" data-testid="opname-sessions-error">
          {error}
        </Text>
      )}

      {activeSession && (
        <Card.Root variant="outline" borderColor="blue.muted" bg="blue.subtle" data-testid="opname-active-session">
          <Card.Body gap="2">
            <HStack gap="2" wrap="wrap">
              <Text fontWeight="bold">{t("opnameSession.active.title", { id: activeSession.id.toString() })}</Text>
              <OpnamePlanBadge plan={activeSession.plan} />
            </HStack>
            <Text fontSize="sm" color="fg.muted" data-testid="opname-active-progress">
              {t("opnameSession.active.progress", {
                counted: activeSession.countedRowCount.toString(),
                rows: activeSession.rowCount.toString(),
                racks: activeSession.rackCount.toString(),
              })}
            </Text>
            {manager && (
              <Text fontSize="sm" color="fg.muted">
                {t("opnameSession.active.oneAtATime")}
              </Text>
            )}
            <HStack gap="2" pt="1" wrap="wrap">
              <Button
                size="xs"
                colorPalette="brand"
                onClick={() => navigate(`/inventories/opname/sessions/${activeSession.id}/count`)}
                data-testid="opname-active-count"
              >
                <Icon as={ClipboardList} boxSize="4" />
                {t("opnameSession.active.count")}
              </Button>
              {manager && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => navigate(`/inventories/opname/sessions/${activeSession.id}`)}
                  data-testid="opname-active-open"
                >
                  <Icon as={Eye} boxSize="4" />
                  {t("opnameSession.active.open")}
                </Button>
              )}
            </HStack>
          </Card.Body>
        </Card.Root>
      )}

      <Tabs.Root
        value={tab}
        onValueChange={(e) => {
          setTab(e.value as typeof tab);
          setPage(1);
        }}
      >
        <Tabs.List overflowX="auto">
          {TABS.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} data-testid={`opname-tab-${item.value}`}>
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <RefreshOverlay busy={list.isFetching && !list.isPending}>
            <Stack gap="section">
              {list.isPending ? (
                <Spinner colorPalette="brand" />
              ) : sessions.length === 0 ? (
                <Text color="fg.muted" data-testid="opname-sessions-empty">
                  {t("opnameSession.empty")}
                </Text>
              ) : isMobile ? (
                <Stack gap="2" data-testid="opname-sessions-blocks">
                  {sessions.map((s) => (
                    <Card.Root
                      key={s.id.toString()}
                      variant="outline"
                      size="sm"
                      cursor="pointer"
                      onClick={() => open(s)}
                      data-testid={`opname-session-row-${s.id}`}
                    >
                      <Card.Body gap="1">
                        <HStack justify="space-between" gap="2">
                          <Span fontWeight="bold">#{s.id.toString()}</Span>
                          <OpnameSessionStatusBadge status={s.status} />
                        </HStack>
                        <HStack gap="2" wrap="wrap">
                          <OpnamePlanBadge plan={s.plan} />
                          <Span fontSize="sm" color="fg.muted">
                            {t("opnameSession.table.progressValue", {
                              counted: s.countedRowCount.toString(),
                              rows: s.rowCount.toString(),
                            })}
                          </Span>
                        </HStack>
                        <Span fontSize="xs" color="fg.muted">
                          {formatUnixDateTimeShort(s.createdAtUnix)} · {nameOf(s.createdById)}
                        </Span>
                      </Card.Body>
                    </Card.Root>
                  ))}
                </Stack>
              ) : (
                <Box overflowX="auto">
                  <Table.Root size="sm" data-testid="opname-sessions-table">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>{t("opnameSession.table.session")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("opnameSession.table.plan")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("opnameSession.table.status")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("opnameSession.table.progress")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("opnameSession.table.createdBy")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("opnameSession.table.finalized")}</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {sessions.map((s) => (
                        <Table.Row
                          key={s.id.toString()}
                          cursor={manager || s.status === OpnameSessionStatus.ACTIVE ? "pointer" : undefined}
                          _hover={{ bg: "bg.subtle" }}
                          onClick={() => open(s)}
                          data-testid={`opname-session-row-${s.id}`}
                        >
                          <Table.Cell>
                            <Stack gap="0">
                              <Span fontWeight="medium">#{s.id.toString()}</Span>
                              <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                                {formatUnixDateTimeShort(s.createdAtUnix)}
                              </Span>
                            </Stack>
                          </Table.Cell>
                          <Table.Cell>
                            <OpnamePlanBadge plan={s.plan} />
                          </Table.Cell>
                          <Table.Cell>
                            <OpnameSessionStatusBadge status={s.status} />
                          </Table.Cell>
                          <Table.Cell data-testid={`opname-session-progress-${s.id}`}>
                            <Stack gap="0">
                              <Span>
                                {t("opnameSession.table.progressValue", {
                                  counted: s.countedRowCount.toString(),
                                  rows: s.rowCount.toString(),
                                })}
                              </Span>
                              <Span fontSize="xs" color="fg.muted">
                                {t("opnameSession.table.scope", {
                                  racks: s.rackCount.toString(),
                                  products: s.productCount.toString(),
                                })}
                              </Span>
                            </Stack>
                          </Table.Cell>
                          <Table.Cell>{nameOf(s.createdById)}</Table.Cell>
                          <Table.Cell>
                            {s.finalizedById > 0n ? (
                              <Stack gap="0">
                                <Span>{nameOf(s.finalizedById)}</Span>
                                <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                                  {formatUnixDateTimeShort(s.finalizedAtUnix)}
                                </Span>
                              </Stack>
                            ) : (
                              <Span color="fg.muted">—</Span>
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
                hasNext={list.data?.hasNext}
                resetKey={`${tab}:${pageSize}`}
                pageSize={pageSize}
                pageSizeOptions={[10, 20, 50]}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
                testId="opname-sessions-pager"
              />
            </Stack>
          </RefreshOverlay>
        </Tabs.Content>
      </Tabs.Root>

      {manager && (
        <NewSessionDialog
          warehouseId={teamId}
          open={creating}
          onOpenChange={setCreating}
          onCreated={(id) => navigate(`/inventories/opname/sessions/${id}`)}
        />
      )}
    </Stack>
  );
}

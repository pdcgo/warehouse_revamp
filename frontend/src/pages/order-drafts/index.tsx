import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Icon,
  IconButton,
  Menu,
  Portal,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Eye, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import type { OrderDraft } from "../../gen/warehouse/selling/v1/order_draft_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { draftGaps } from "../../features/orderDrafts/draftReadiness";
import {
  useDeleteOrderDrafts,
  useOldestOrderDraft,
  useOrderDrafts,
} from "../../features/orderDrafts/queries";
import { NO_ORDER_FILTERS, useOrderStat } from "../../features/orders/queries";
import { summariseOrderStat } from "../../features/orders/stat";
import { ORDER_STATUS_TABS, orderTab } from "../../features/orders/statusTabs";
import { OrderTabs } from "../../features/orders/OrderTabs";
import { DRAFTS_TAB, StageTabs } from "../../features/orders/StageTabs";
import { ALL_STAGE, ORDER_STAGES, orderStage } from "../../features/orders/stages";
import { CreatedCell, DateCell, OrderRefCell, OwnerCell } from "../../features/orders/OrderRowCells";
import { useShopOptions } from "../../features/shops/queries";
import { useActors } from "../../features/users/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ORDER_DRAFTS_PENDING } from "./pending";
import { DraftSummary } from "./components/DraftSummary";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// OrderDraftsPage lists the CALLER'S OWN drafts (#195) — incomplete orders pushed in by a
// third-party app or saved from the order form, waiting for somebody here to finish them.
//
// IT IS THE DRAFTS TAB OF THE ORDER LIST (owner: *"draft sesuaikan dengan all, tapi jelas tidak
// selengkap di sana"* — `the-draft-list-is-the-drafts-tab`). Same heading, same tab strip, same row
// grammar as the seller's `/orders`: the reference with a second line under it, the shop, when it was
// written and by whom, a kebab. Only the columns a draft can honestly fill — a draft has no status, no
// resi, no marketplace date, no cost and no marketplace total, so those columns are simply absent
// rather than a row of dashes. Nothing on the row is invented, so nothing on it carries a ⚠.
//
// It keeps its OWN ROUTE — deep links, the draft detail's Back and the order form's redirect all point
// here — and the one thing the order table does not have: selection and bulk delete. Nothing expires,
// and an app pushing continuously fills this list far faster than a person finishes one, so pruning is
// load-bearing, not a convenience.
export function OrderDraftsPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState<OrderDraft | null>(null);

  const teamId = current?.teamId;

  const query = useOrderDrafts({ teamId, page, pageSize });
  const oldest = useOldestOrderDraft(teamId);
  const remove = useDeleteOrderDrafts();

  // The counts on the strip's other tabs. The same query the order list runs with no filters, so the
  // two strips cannot show different numbers for the same team.
  const statQuery = useOrderStat({ teamId, filters: NO_ORDER_FILTERS });
  const stat = summariseOrderStat(statQuery.data);

  const drafts = query.data?.drafts ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // The shop a draft was pushed for, and the person who wrote it — both real fields, both resolved in
  // one batched read each, like the order list does for its rows.
  const shopOptions = useShopOptions({ teamId: teamId ?? 0n });
  const shopOf = (id: bigint) => shopOptions.data?.find((shop) => shop.id === id);
  const actors = useActors(drafts.map((d) => d.authorUserId));

  // ⚠ A WAREHOUSE KEEPS THE OLD STRIP. Its own order list still draws the six proto statuses
  // (`the-two-ends-are-two-screens`); swapping the strip on the way in here would be the same jolt this
  // page was rebuilt to remove, only from the other side.
  const warehouse = current?.teamType === TeamType.WAREHOUSE;

  // A stage sums every proto status it covers — the seller list's rule, copied because it is the same
  // strip and must count the same way.
  function stageCount(value: string): number {
    if (value === ALL_STAGE) {
      return ORDER_STAGES.reduce(
        (sum, item) => sum + item.statuses.reduce((n, s) => n + stat.count(s), 0),
        0,
      );
    }

    const item = orderStage(value);

    return item ? item.statuses.reduce((n, s) => n + stat.count(s), 0) : 0;
  }

  function statusCount(value: string): number {
    const item = orderTab(value);

    if (item.value === "all") {
      return ORDER_STATUS_TABS.reduce(
        (sum, other) => (other.value === "all" ? sum : sum + stat.count(other.status)),
        0,
      );
    }

    return stat.count(item.status);
  }

  // Any other tab LEAVES, and lands on the tab that was clicked — `?status=` carries it.
  function leaveTo(value: string) {
    if (value !== DRAFTS_TAB) {
      void navigate(`/orders?status=${value}`);
    }
  }

  // The selection is held as ids rather than as a per-row flag so it survives a refetch — a delete
  // that reorders the page must not silently transfer a tick from one draft to another.
  const allOnPageSelected = drafts.length > 0 && drafts.every((d) => selected.has(d.id.toString()));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);

      for (const draft of drafts) {
        const id = draft.id.toString();

        if (allOnPageSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });
  }

  async function deleteDrafts(ids: bigint[]) {
    if (!teamId) {
      return;
    }

    try {
      const res = await remove.mutateAsync({ teamId, draftIds: ids });

      setSelected((prev) => {
        const next = new Set(prev);

        for (const id of ids) {
          next.delete(id.toString());
        }

        return next;
      });
      toaster.create({
        type: "success",
        title: t("orderDrafts.deleted", { count: res.deleted }),
      });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orderDrafts.title")}</Heading>
        <Text color="fg.muted" data-testid="order-drafts-no-team">
          {t("orderDrafts.selectTeamView")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {!warehouse && <NotImplementedSummary list={ORDER_DRAFTS_PENDING} />}

      {/* The ORDERS heading, not this screen's own (owner). Drafts is a tab of that screen, and a tab
          that changed the page title would read as having navigated somewhere else. */}
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("orders.title")}</Heading>
        <Badge colorPalette="brand">
          {current.teamName || t("orders.teamFallback", { id: current.teamId.toString() })}
        </Badge>
        <Spacer />

        <Flex gap="2" align="center" wrap="wrap">
          {selected.size > 0 && (
            <Button
              size="xs"
              colorPalette="error"
              data-testid="delete-selected-drafts"
              onClick={() => setConfirmOpen(true)}
            >
              <Icon as={Trash2} boxSize="4" />
              {t("orderDrafts.deleteSelected", { count: selected.size })}
            </Button>
          )}

          {/* The order list's one committing action, in the same place. Export and Import are not
              here — neither means anything for a draft. */}
          {!warehouse && (
            <Button
              size="xs"
              colorPalette="brand"
              data-testid="open-create-order"
              onClick={() => navigate("/orders/new")}
            >
              <Icon as={Plus} boxSize="4" />
              {t("orders.newOrder")}
            </Button>
          )}
        </Flex>
      </Flex>

      {/* THE SAME STRIP AS THE ORDER LIST, with Drafts active. */}
      {warehouse ? (
        <OrderTabs value={DRAFTS_TAB} count={statusCount} draftCount={totalItems} onSelect={leaveTo} />
      ) : (
        <StageTabs
          value={DRAFTS_TAB}
          count={stageCount}
          draftCount={totalItems}
          mark={<NotImplemented list={ORDER_DRAFTS_PENDING} id="statusSet" />}
          onSelect={leaveTo}
        />
      )}

      <Text color="fg.muted" fontSize="sm">
        {t("orderDrafts.intro")}
      </Text>

      {/* Under the strip, where the order list keeps its summary — and, like it, controlling nothing. */}
      {!warehouse && !loading && (
        <DraftSummary total={totalItems} oldest={oldest.data} page={drafts} />
      )}

      {error && (
        <Text color="error.fg" data-testid="order-drafts-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <RefreshOverlay busy={query.isFetching && !query.isPending}>
          {/* A table scrolls inside its own box on a phone; the page never scrolls sideways. */}
          <Box overflowX="auto" w="full" maxW="full" minW="0">
            <Table.Root size="sm" data-testid="order-drafts-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="1">
                    <Checkbox.Root
                      size="sm"
                      checked={allOnPageSelected}
                      onCheckedChange={toggleAllOnPage}
                      aria-label={t("orderDrafts.selectAll")}
                      data-testid="select-all-drafts"
                    >
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                    </Checkbox.Root>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orderDrafts.reference")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orders.shop")}</Table.ColumnHeader>
                  {/* "Dibuat", not the order list's "Dipesan" — nobody has ordered anything yet. */}
                  <Table.ColumnHeader>{t("orderDrafts.created")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orderDrafts.updated")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orderDrafts.lines")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("orders.actions")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {drafts.map((d) => {
                  const gaps = draftGaps(d);
                  const author = actors.data?.get(d.authorUserId.toString())?.name ?? "";

                  return (
                    <Table.Row
                      key={d.id.toString()}
                      cursor="pointer"
                      _hover={{ bg: "bg.muted" }}
                      data-testid={`draft-row-${d.id}`}
                      onClick={() => navigate(`/order-drafts/${d.id}`)}
                    >
                      {/* ⚠ STOPS THE ROW'S NAVIGATE — ticking a box must not open the draft. */}
                      <Table.Cell onClick={(e) => e.stopPropagation()}>
                        <Checkbox.Root
                          size="sm"
                          checked={selected.has(d.id.toString())}
                          onCheckedChange={() => toggle(d.id.toString())}
                          aria-label={t("orderDrafts.selectOne", { id: d.id.toString() })}
                          data-testid={`select-draft-${d.id}`}
                        >
                          <Checkbox.HiddenInput />
                          <Checkbox.Control />
                        </Checkbox.Root>
                      </Table.Cell>

                      {/* THE REFERENCE, and under it WHAT IS LEFT — where the order list puts the
                          stage. A draft has no stage; what somebody scanning forty of them decides on is
                          how much work each one still is. The first gap is named and the rest counted,
                          so the cell stays two lines; the full list is on the badge's title. */}
                      <Table.Cell data-testid={`open-draft-${d.id}`}>
                        <OrderRefCell
                          orderRefId={d.externalId}
                          statusBadge={
                            gaps.length === 0 ? (
                              <Badge colorPalette="success" size="sm" data-testid={`draft-ready-${d.id}`}>
                                {t("orderDrafts.ready")}
                              </Badge>
                            ) : (
                              <Badge
                                colorPalette="gray"
                                size="sm"
                                title={gaps.map((gap) => t(gap.key)).join(" · ")}
                                data-testid={`draft-gaps-${d.id}`}
                              >
                                {t(gaps[0]!.key)}
                                {gaps.length > 1 && ` +${gaps.length - 1}`}
                              </Badge>
                            )
                          }
                        />
                      </Table.Cell>

                      <Table.Cell>
                        <OwnerCell shop={d.shopId > 0n ? shopOf(d.shopId) : undefined} />
                      </Table.Cell>

                      <Table.Cell>
                        <CreatedCell unix={d.createdAtUnix} by={author} />
                      </Table.Cell>

                      <Table.Cell>
                        <DateCell unix={d.updatedAtUnix} testId={`draft-updated-${d.id}`} />
                      </Table.Cell>

                      <Table.Cell>
                        {d.unmappedItemCount > 0 ? (
                          <Badge colorPalette="warning" data-testid={`draft-unmapped-${d.id}`}>
                            {t("orderDrafts.unmappedOf", {
                              unmapped: d.unmappedItemCount,
                              total: d.itemCount,
                            })}
                          </Badge>
                        ) : (
                          <Text>{d.itemCount}</Text>
                        )}
                      </Table.Cell>

                      <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label={t("orders.actions")}
                              data-testid={`draft-actions-${d.id}`}
                            >
                              <Icon as={MoreHorizontal} boxSize="4" />
                            </IconButton>
                          </Menu.Trigger>

                          <Portal>
                            <Menu.Positioner>
                              <Menu.Content>
                                <Menu.Item
                                  value="open"
                                  data-testid={`draft-open-${d.id}`}
                                  onClick={() => navigate(`/order-drafts/${d.id}`)}
                                >
                                  <Icon as={Eye} boxSize="4" />
                                  {t("orders.viewDetail")}
                                </Menu.Item>
                                <Menu.Item
                                  value="delete"
                                  color="fg.error"
                                  data-testid={`draft-delete-${d.id}`}
                                  onClick={() => setDeleting(d)}
                                >
                                  <Icon as={Trash2} boxSize="4" />
                                  {t("orderDrafts.deleteOneTitle")}
                                </Menu.Item>
                              </Menu.Content>
                            </Menu.Positioner>
                          </Portal>
                        </Menu.Root>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Box>
        </RefreshOverlay>
      )}

      {!loading && drafts.length === 0 && !error && (
        <Text color="fg.muted" data-testid="order-drafts-empty">
          {t("orderDrafts.noDrafts")}
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

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("orderDrafts.deleteTitle")}
        message={t("orderDrafts.deleteMessage", { count: selected.size })}
        confirmLabel={t("orderDrafts.deleteConfirm")}
        onConfirm={() => deleteDrafts([...selected].map((id) => BigInt(id)))}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={t("orderDrafts.deleteOneTitle")}
        message={t("orderDrafts.deleteOneMessage", { ref: deleting?.externalId ?? "" })}
        confirmLabel={t("orderDrafts.deleteConfirm")}
        onConfirm={async () => {
          if (deleting) await deleteDrafts([deleting.id]);
          setDeleting(null);
        }}
      />
    </Stack>
  );
}

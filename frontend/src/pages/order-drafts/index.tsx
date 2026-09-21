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
  HStack,
  Icon,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { Pagination } from "../../components/chrome/Pagination";
import { toaster } from "../../components/feedback/Toaster";
import { useTeam } from "../../features/team/TeamContext";
import { draftGaps } from "../../features/orderDrafts/draftReadiness";
import { useDeleteOrderDrafts, useOrderDrafts } from "../../features/orderDrafts/queries";
import { NO_ORDER_FILTERS, useOrderStat } from "../../features/orders/queries";
import { summariseOrderStat } from "../../features/orders/stat";
import { ORDER_STATUS_TABS, orderTab } from "../../features/orders/statusTabs";
import { DRAFTS_TAB, OrderTabs } from "../../features/orders/OrderTabs";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// OrderDraftsPage lists the CALLER'S OWN drafts (#195) — incomplete orders pushed in by a
// third-party app or saved from the order form, waiting for somebody here to finish them.
//
// REACHED FROM THE ORDERS TAB STRIP (owner), no longer from a sidebar item of its own. It keeps its
// own route — deep links, the draft detail's Back, and the order form's redirect all point here, and
// this screen's selection and bulk delete are nothing the orders table has. What changed is the WAY
// IN: the person looking for a half-finished order goes to Orders, so that is where the door is.
// Drafts are still not orders; the strip puts them beside the statuses, not among them.
//
// The screen has two jobs, and the second is easy to under-build: opening a draft to finish it, and
// PRUNING. Nothing expires, and an app pushing continuously fills this list far faster than a person
// finishes one — so bulk delete is load-bearing, not a convenience.
export function OrderDraftsPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const teamId = current?.teamId;

  const query = useOrderDrafts({ teamId, page, pageSize });
  const remove = useDeleteOrderDrafts();

  // The counts on the STATUS tabs of the strip above. The same query the orders list runs, with the
  // same key and no filters — so arriving here from that screen reuses its answer rather than asking
  // again, and the two strips can never show different numbers.
  const statQuery = useOrderStat({ teamId, filters: NO_ORDER_FILTERS });
  const stat = summariseOrderStat(statQuery.data);

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

  const drafts = query.data?.drafts ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

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

  async function deleteSelected() {
    if (!teamId) {
      return;
    }

    try {
      const res = await remove.mutateAsync({
        teamId,
        draftIds: [...selected].map((id) => BigInt(id)),
      });

      setSelected(new Set());
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
      {/* The ORDERS heading, not this screen's own (owner). Drafts is a tab of that screen now, and a
          tab that changed the page title would read as having navigated somewhere else — which is the
          one thing a tab must not do. What the tab is showing is said by the strip below and by the
          intro under it. */}
      <Flex align="center" gap="card">
        <Heading size="md">{t("orders.title")}</Heading>
        <Badge colorPalette="brand">
          {current.teamName || t("orders.teamFallback", { id: current.teamId.toString() })}
        </Badge>
        <Spacer />

        {selected.size > 0 && (
          <Button
            size="xs"
            colorPalette="red"
            data-testid="delete-selected-drafts"
            onClick={() => setConfirmOpen(true)}
          >
            <Icon as={Trash2} boxSize="4" />
            {t("orderDrafts.deleteSelected", { count: selected.size })}
          </Button>
        )}
      </Flex>

      {/* The same strip as the orders list, with Drafts active. Selecting a STATUS goes back to that
          list and lands on the tab that was clicked — `?status=` carries it, so the trip is one click
          rather than "go back, then pick the tab again". */}
      <OrderTabs
        value={DRAFTS_TAB}
        count={statusCount}
        draftCount={totalItems}
        onSelect={(value) => {
          if (value !== DRAFTS_TAB) {
            void navigate(`/orders?status=${value}`);
          }
        }}
      />

      <Text color="fg.muted" fontSize="sm">
        {t("orderDrafts.intro")}
      </Text>

      {error && (
        <Text color="red.fg" data-testid="order-drafts-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
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
              <Table.ColumnHeader>{t("orders.customer")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orderDrafts.lines")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orderDrafts.remaining")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {drafts.map((d) => {
              const gaps = draftGaps(d);

              return (
                <Table.Row key={d.id.toString()} data-testid={`draft-row-${d.id}`}>
                  <Table.Cell>
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

                  <Table.Cell>
                    <Box
                      cursor="pointer"
                      fontWeight="medium"
                      data-testid={`open-draft-${d.id}`}
                      onClick={() => navigate(`/order-drafts/${d.id}`)}
                    >
                      {d.externalId}
                    </Box>
                    {/* WHICH APP pushed it, kept beside the reference: two apps can scrape the same
                        marketplace, and an external id alone does not say whose it is. */}
                    <Text fontSize="xs" color="fg.muted">
                      {d.source}
                    </Text>
                  </Table.Cell>

                  <Table.Cell>{d.customerName || "—"}</Table.Cell>

                  <Table.Cell>
                    {d.unmappedItemCount > 0 ? (
                      <Badge colorPalette="orange" data-testid={`draft-unmapped-${d.id}`}>
                        {t("orderDrafts.unmappedOf", {
                          unmapped: d.unmappedItemCount,
                          total: d.itemCount,
                        })}
                      </Badge>
                    ) : (
                      <Text>{d.itemCount}</Text>
                    )}
                  </Table.Cell>

                  {/* WHAT IS LEFT TO DO, spelled out rather than reduced to ready/not-ready. Somebody
                      scanning forty drafts is deciding which to open next, and "needs a warehouse" is
                      a different amount of work from "three lines unmapped". */}
                  <Table.Cell>
                    {gaps.length === 0 ? (
                      <Badge colorPalette="green" data-testid={`draft-ready-${d.id}`}>
                        {t("orderDrafts.ready")}
                      </Badge>
                    ) : (
                      <HStack gap="1" wrap="wrap">
                        {gaps.map((gap) => (
                          <Badge key={gap.key} colorPalette="gray">
                            {t(gap.key)}
                          </Badge>
                        ))}
                      </HStack>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
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
        onConfirm={deleteSelected}
      />
    </Stack>
  );
}

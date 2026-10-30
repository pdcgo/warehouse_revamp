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
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Eye, FilePen, MoreHorizontal, Trash2 } from "lucide-react";
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
import { CreatedCell, DateCell, OrderRefCell, OwnerCell } from "../../features/orders/OrderRowCells";
import { useShopOptions } from "../../features/shops/queries";
import { useActors } from "../../features/users/queries";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ORDER_DRAFTS_PENDING } from "./pending";
import { DraftSummary } from "./components/DraftSummary";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { useIsMobile } from "../../layouts/shell";
import { CompactActions } from "../../components/chrome/CompactActions";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// OrderDraftsPage lists the CALLER'S OWN drafts (#195) — incomplete orders pushed in by a
// third-party app or saved from the order form, waiting for somebody here to finish them.
//
// A LIST OF ITS OWN (owner: *"draft perlu dipisahkan dari list pesanan, dia jadi list sendiri"*,
// `the-drafts-are-a-list-of-their-own`) — its own title, reached from the menu (Pesanan ▸ Daftar · Draf), no longer a
// tab of the order list. The ROW keeps the order list's grammar (`the-draft-list-is-the-drafts-tab` decided it): the
// reference with a second line under it, the shop, when it was written and by whom, a kebab. Only the columns a draft
// can honestly fill — no status, resi, marketplace date, cost or marketplace total — so nothing on the row is invented.
//
// A row opens the draft IN THE ORDER FORM (`the-draft-opens-in-the-order-form`). The one thing the order table does
// not have: selection and bulk delete. Nothing expires, and an app pushing continuously fills this list far faster than
// a person finishes one, so pruning is load-bearing, not a convenience.
export function OrderDraftsPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
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

  const drafts = query.data?.drafts ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // The shop a draft was pushed for, and the person who wrote it — both real fields, both resolved in
  // one batched read each, like the order list does for its rows.
  const shopOptions = useShopOptions({ teamId: teamId ?? 0n });
  const shopOf = (id: bigint) => shopOptions.data?.find((shop) => shop.id === id);
  const actors = useActors(drafts.map((d) => d.authorUserId));

  // A warehouse never has a draft — no summary or marks for it, only the (empty) list.
  const warehouse = current?.teamType === TeamType.WAREHOUSE;

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
    // The page arrives — a fade and a short rise (`motion-is-small-quick-and-shared`).
    <Stack gap="section" animationStyle="enter">
      {!warehouse && <NotImplementedSummary list={ORDER_DRAFTS_PENDING} />}

      {/* ITS OWN TITLE, the subtitle under it (the-drafts-are-a-list-of-their-own) — no longer the order list's heading over
          a Drafts tab. */}
      <Flex align="flex-start" gap="card" wrap={isMobile ? "nowrap" : "wrap"}>
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <Flex align="center" gap="2" wrap="wrap">
            <Heading size="md" data-testid="order-drafts-heading">
              {t("orderDrafts.title")}
            </Heading>
            <Badge colorPalette="brand">
              {current.teamName || t("orders.teamFallback", { id: current.teamId.toString() })}
            </Badge>
          </Flex>
          <Text color="fg.muted" fontSize="sm" data-testid="order-drafts-subtitle">
            {t("orderDrafts.intro")}
          </Text>
        </Stack>

        {/* ON A PHONE THE ACTIONS ARE ICONS, AND PAST TWO THEY FOLD INTO ⋯ (a-phone-header-action-is-an-icon) — labelled
            buttons wrapped onto rows of their own. The desktop keeps its labelled buttons. */}
        {isMobile ? (
          <CompactActions
            menuLabel={t("orders.actions")}
            actions={[
              selected.size > 0 && {
                id: "delete",
                label: t("orderDrafts.deleteSelected", { count: selected.size }),
                icon: Trash2,
                danger: true,
                testId: "delete-selected-drafts",
                onClick: () => setConfirmOpen(true),
              },
            ]}
          />
        ) : (
          selected.size > 0 && (
            <Button
              size="xs"
              colorPalette="error"
              flexShrink={0}
              data-testid="delete-selected-drafts"
              onClick={() => setConfirmOpen(true)}
            >
              <Icon as={Trash2} boxSize="4" />
              {t("orderDrafts.deleteSelected", { count: selected.size })}
            </Button>
          )
        )}
      </Flex>

      {/* Under the title, as the order list keeps its summary — and, like it, controlling nothing. */}
      {!warehouse && !loading && (
        <DraftSummary total={totalItems} oldest={oldest.data} page={drafts} />
      )}

      {error && (
        <Text color="error.fg" data-testid="order-drafts-error">
          {error}
        </Text>
      )}

      {/* The first load shows the table's shape and its rows fade in, once (motion-is-small-quick-and-shared). */}
      {loading ? (
        <ListSkeleton testId="order-drafts-loading" />
      ) : (
        <Box animationStyle="swap">
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
                      onClick={() => navigate(`/orders/new?draft=${d.id}`)}
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
                        {/* `manual` is the build's form-made draft, not an app, so it names none
                            (the-draft-row-names-the-person-and-the-app). */}
                        <CreatedCell
                          unix={d.createdAtUnix}
                          by={author}
                          via={d.source === "manual" ? "" : d.source}
                        />
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
                                  onClick={() => navigate(`/orders/new?draft=${d.id}`)}
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
        </Box>
      )}

      {!loading && drafts.length === 0 && !error && (
        <EmptyHint
          icon={FilePen}
          title={t("orderDrafts.noDrafts")}
          description={t("orderDrafts.noDraftsHint")}
          testId="order-drafts-empty"
        />
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

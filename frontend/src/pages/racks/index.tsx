import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge, Box, Button, Flex, Heading, HStack, Icon, IconButton, Span, Stack, Table, Text } from "@chakra-ui/react";
import { Pencil, Plus, SearchX, Trash2, Warehouse } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { Rack } from "../../gen/warehouse/inventory/v1/rack_pb";
import type { RackTotals } from "../../features/racks/adapt";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useDeleteRack, useRacks } from "./queries";
import { CompactActions } from "../../components/chrome/CompactActions";
import { FilterBar, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { useIsMobile } from "../../layouts/shell";
import { fromHere } from "../../lib/cameFrom";
import { PRESSABLE } from "../../lib/motion";
import { useDebounced } from "../../lib/useDebounced";
import { textCodec, useUrlState } from "../../lib/urlState";
import { RackFormDialog } from "./components/RackFormDialog";
import { racksPending } from "./pending";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// RacksPage lists the CURRENT team's racks (#129) — the physical places inside ONE warehouse, since
// a warehouse IS a team. Every RPC carries `current.teamId` in its body: the team is the scope, and
// a warehouse only ever sees its own racks.
//
// This is the registry — write down the shelves you have. A row opens the rack's detail page (#138),
// which is where the interesting question is answered: what is actually ON that shelf, and how much.
//
// The Racks menu shows for warehouse teams only, but the page is not gated here — root/admin reach
// the route directly and the server's policy is the real gate.
//
// ON THE SCREEN RULES (owner: *"sekarang inisiasi rack"*, the-racks-follow-the-screen-rules):
//
//   Rak                                                                   [+ Rak Baru]
//   Rak di gudang ini — kode yang tertempel di rak, dan apa isinya.
//   [⌕ Cari kode atau nama            ×]
//   Kode     Nama            Deskripsi              Produk   Stok   Aksi
//   A-01-1   Aisle A bawah   Dekat pintu bongkar         3     25   [✎] [🗑]
//                                                   ‹ [1] ›    ← the growing pager, always on screen
//
// On a phone the header's action is its icon, the search stays in the row, and each rack is a block.
export function RacksPage() {
  const { current } = useTeam();
  const writable = canWrite(current);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  // THE SEARCH LIVES IN THE URL (a-lists-filters-live-in-the-url) — Back from a rack opens the same narrowed list.
  const [q, setQ] = useUrlState("q", "", textCodec);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // The form, open on a new rack (`{}`) or on the rack being edited; null when shut.
  const [form, setForm] = useState<{ rack?: Rack } | null>(null);

  const teamId = current?.teamId;
  // Typed, then settled — a word is one request to the server, not one per key.
  const term = useDebounced(q.trim());

  // The server already orders by code — the code is how a person reads the warehouse.
  const query = useRacks({ teamId, q: term, page, pageSize });
  const deleteRack = useDeleteRack();

  const racks = query.data?.racks ?? [];
  const stockTotals = query.data?.stockTotals ?? new Map<string, RackTotals>();
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";
  const filtering = q.trim() !== "";

  const totalsOf = (rack: Rack) => stockTotals.get(rack.id.toString());
  // An EMPTY rack — nothing on it. The one to put a delivery away into, and the only one that can be deleted.
  const isEmpty = (rack: Rack) => (totalsOf(rack)?.stockCount ?? 0n) === 0n;

  // THE FIGURES OVER THE LIST (owner: *"3, 4"*, the-rack-list-leads-with-its-figures) — how many racks, how many hold
  // something, how many are empty, and the pieces on them all. The racks are the server's total; the other three are
  // summed from the racks this page holds — exact while every rack fits one page, marked when they do not.
  const filled = racks.filter((rack) => !isEmpty(rack)).length;
  const pieces = racks.reduce((sum, rack) => sum + Number(totalsOf(rack)?.stockCount ?? 0n), 0);
  const partial = !loading && totalItems > racks.length;
  const pending = racksPending(partial);
  const pageMark = partial ? <NotImplemented list={pending} id="pageTotals" /> : undefined;
  const figure = (n: number) => (loading ? "—" : String(n));
  // The rack's page, carrying this list — so its back returns here with the search (a-form-returns-where-it-was-opened).
  const open = (rack: Rack) => navigate(`/inventories/racks/${rack.id}`, { state: fromHere(location) });
  const search = (value: string) => {
    setPage(1);
    setQ(value);
  };

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would close
  // while the delete was still in flight. mutateAsync REJECTS on failure, so the catch is not optional
  // here the way it would be with mutate's onError.
  async function remove(rack: Rack) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteRack.mutateAsync({ teamId, rackId: rack.id });
      toaster.create({ type: "success", title: t("racks.deleted", { code: rack.code }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("racks.deleteFailed"), description: rpcError(err) });
    }
  }

  // No current team means there is no warehouse to list against — the whole page is meaningless.
  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("racks.title")}</Heading>
        <Text color="fg.muted" data-testid="racks-no-team">
          {t("racks.selectTeam")}
        </Text>
      </Stack>
    );
  }

  // KOSONG (owner: *"3, 4"*, an-empty-rack-says-so) — a rack holding nothing, said on its row in the plain tone: the one
  // to put a delivery away into, and the only one that can be deleted.
  function emptyBadge(rack: Rack) {
    return (
      <Badge colorPalette="gray" flexShrink={0} data-testid={`rack-empty-${rack.code}`}>
        {t("racks.emptyBadge")}
      </Badge>
    );
  }

  // A row's two acts — Edit and Delete, kept inline (two stay named by their icons). Each stops the row's navigate. None
  // while the admin team monitors the warehouse (the-admin-team-monitors-read-only).
  function rowActions(rack: Rack) {
    if (!writable) return null;

    return (
      <HStack justify="end" gap="1" onClick={(e) => e.stopPropagation()}>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("racks.editOne", { code: rack.code })}
          title={t("racks.editOne", { code: rack.code })}
          data-testid={`edit-rack-${rack.code}`}
          onClick={() => setForm({ rack })}
        >
          <Icon as={Pencil} boxSize="4" />
        </IconButton>

        <ConfirmDialog
          title={t("racks.deleteRack")}
          message={t("racks.deleteConfirm", { code: rack.code })}
          confirmLabel={t("racks.delete")}
          onConfirm={() => remove(rack)}
          trigger={
            <IconButton
              size="xs"
              variant="ghost"
              colorPalette="error"
              aria-label={t("racks.deleteOne", { code: rack.code })}
              title={t("racks.deleteOne", { code: rack.code })}
              data-testid={`delete-rack-${rack.code}`}
            >
              <Icon as={Trash2} boxSize="4" />
            </IconButton>
          }
        />
      </HStack>
    );
  }

  function list() {
    if (racks.length === 0 && !error) {
      // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint) — nothing matches: clear the search; none at all:
      // register the first.
      return filtering ? (
        <EmptyHint
          icon={SearchX}
          title={t("racks.empty")}
          description={t("emptyHint.noMatch")}
          action={
            <Button variant="outline" colorPalette="gray" onClick={() => search("")}>
              {t("common.clearFilters")}
            </Button>
          }
          testId="racks-empty"
        />
      ) : (
        <EmptyHint
          icon={Warehouse}
          title={t("racks.none")}
          description={t("racks.emptyHint")}
          action={
            <Button colorPalette="brand" onClick={() => setForm({})}>
              <Icon as={Plus} boxSize="4" />
              {t("racks.form.newRack")}
            </Button>
          }
          testId="racks-empty"
        />
      );
    }

    if (isMobile) {
      // A PHONE READS EACH RACK AS A BLOCK (a-phone-reads-each-line-as-a-block):
      //
      //   A-01-1  Aisle A bawah                          [✎] [🗑]
      //   3 produk · 25 pcs
      //   Dekat pintu bongkar
      return (
        <Stack gap="3" data-testid="racks-table">
          {racks.map((rack) => {
            const totals = totalsOf(rack);

            return (
              <Stack
                key={rack.id.toString()}
                data-testid={`rack-row-${rack.code}`}
                borderWidth="1px"
                borderRadius="md"
                p="4"
                gap="1"
                // It opens the rack, so it lights up and gives a little under a thumb (a-table-row-lights-up).
                {...PRESSABLE}
                onClick={() => open(rack)}
              >
                <Flex align="center" gap="2">
                  <Text fontWeight="bold" flexShrink={0}>
                    {rack.code}
                  </Text>
                  {isEmpty(rack) && emptyBadge(rack)}
                  <Text fontSize="sm" color="fg.muted" truncate flex="1" minW="0">
                    {rack.name}
                  </Text>
                  {rowActions(rack)}
                </Flex>
                <Text fontSize="sm">
                  <Span data-testid={`rack-products-${rack.code}`}>
                    {t("racks.productCount", { count: totals?.productCount ?? 0 })}
                  </Span>
                  {" · "}
                  <Span fontWeight="bold" data-testid={`rack-stock-${rack.code}`}>
                    {t("racks.stockCount", { count: Number(totals?.stockCount ?? 0n) })}
                  </Span>
                </Text>
                {rack.description && (
                  <Text fontSize="xs" color="fg.muted" lineClamp={2}>
                    {rack.description}
                  </Text>
                )}
              </Stack>
            );
          })}
        </Stack>
      );
    }

    return (
      // The table scrolls inside its own box, never the page.
      <Box overflowX="auto" w="full" maxW="full" minW="0">
        <Table.Root size="sm" data-testid="racks-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("racks.table.code")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("racks.table.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("racks.table.description")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("racks.table.products")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("racks.table.stock")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("racks.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {racks.map((rack) => {
              const totals = totalsOf(rack);

              return (
                <Table.Row
                  key={rack.id.toString()}
                  data-testid={`rack-row-${rack.code}`}
                  cursor="pointer"
                  css={LIGHTS_UP}
                  onClick={() => open(rack)}
                >
                  {/* The code is what is painted on the shelf — it IS the rack's identity, so it carries the row. An
                      empty rack says so UNDER it, where a row's status sits (one-context-per-column-and-never-three-
                      lines). */}
                  <Table.Cell whiteSpace="nowrap">
                    <Stack gap="1" align="start">
                      <Text fontWeight="bold">{rack.code}</Text>
                      {isEmpty(rack) && emptyBadge(rack)}
                    </Stack>
                  </Table.Cell>
                  <Table.Cell maxW="56">
                    <Text lineClamp={1} title={rack.name}>
                      {rack.name}
                    </Text>
                  </Table.Cell>
                  {/* At most two lines, cut, the whole on its hover (one-context-per-column-and-never-three-lines). */}
                  <Table.Cell color="fg.muted" maxW="md">
                    <Text lineClamp={2} title={rack.description}>
                      {rack.description}
                    </Text>
                  </Table.Cell>
                  {/* HOW MANY PRODUCTS, then the rack's STOCK COUNT, its products summed
                      (a-rack-shows-its-stock-count-for-now). Both shown at 0 too: an empty rack is the one that can be
                      deleted, and the one worth knowing about. */}
                  <Table.Cell textAlign="end" data-testid={`rack-products-${rack.code}`}>
                    {totals?.productCount ?? 0}
                  </Table.Cell>
                  <Table.Cell textAlign="end" fontWeight="bold" data-testid={`rack-stock-${rack.code}`}>
                    {(totals?.stockCount ?? 0n).toString()}
                  </Table.Cell>
                  <Table.Cell textAlign="end">{rowActions(rack)}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      </Box>
    );
  }

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="racks-page">
      {/* THE PAGE NAMES ITSELF (the-desktop-shell-has-no-top-bar), a line under it on what it is. No team badge: the
          switcher names the team. Rak Baru carries its icon — on a phone, its icon alone (a-phone-header-action-is-an-
          icon). */}
      <Flex align="flex-start" gap="card">
        <Stack gap="0" flex="1" minW="0">
          <Heading size="md">{t("racks.title")}</Heading>
          <Text fontSize="sm" color="fg.muted">
            {t("racks.subtitle")}
          </Text>
        </Stack>
        {/* Nothing to change while the admin team monitors the warehouse (the-admin-team-monitors-read-only). */}
        {!writable ? null : isMobile ? (
          <CompactActions
            menuLabel={t("racks.table.actions")}
            actions={[
              {
                id: "new",
                label: t("racks.form.newRack"),
                icon: Plus,
                primary: true,
                testId: "open-create-rack",
                onClick: () => setForm({}),
              },
            ]}
          />
        ) : (
          <Button colorPalette="brand" flexShrink={0} data-testid="open-create-rack" onClick={() => setForm({})}>
            <Icon as={Plus} boxSize="4" />
            {t("racks.form.newRack")}
          </Button>
        )}
      </Flex>

      {/* What is not real yet — the three figures, only while the racks run past one page (pending.ts). */}
      <NotImplementedSummary list={pending} />

      {/* THE FIGURES OVER THE LIST, the order list's card strip (a-list-summary-is-the-order-lists-card-strip) — the
          racks lead; then filled, empty, and the pieces on them (the-rack-list-leads-with-its-figures). They describe
          the list as it is narrowed: a search narrows them too. */}
      <SummaryStrip testId="racks-summary">
        <SummaryCard
          emphasis
          label={t("racks.stat.racks")}
          value={figure(totalItems)}
          note={t("racks.stat.racksNote")}
          testId="racks-stat-racks"
        />
        <SummaryCard
          label={t("racks.stat.filled")}
          mark={pageMark}
          value={figure(filled)}
          note={t("racks.stat.filledNote")}
          testId="racks-stat-filled"
        />
        <SummaryCard
          label={t("racks.stat.empty")}
          mark={pageMark}
          value={figure(racks.length - filled)}
          note={t("racks.stat.emptyNote")}
          testId="racks-stat-empty"
        />
        <SummaryCard
          label={t("racks.stat.stock")}
          mark={pageMark}
          value={loading ? "—" : t("racks.stockCount", { count: pieces })}
          note={t("racks.stat.stockNote")}
          testId="racks-stat-stock"
        />
      </SummaryStrip>

      {/* THE SHARED FILTER STRIP (a-phone-filters-from-a-sheet, clear-filters-is-red-and-bold, every-filter-clears-from-
          its-own-x) — the search alone; it stays in the row on a phone. */}
      <FilterBar testId="racks-filter" active={filtering} count={filtering ? 1 : 0} onClear={() => search("")}>
        <FilterSearch value={q} onChange={search} placeholder={t("racks.searchPlaceholder")} testId="rack-search" />
      </FilterBar>

      {error && (
        <Text color="error.fg" data-testid="racks-error">
          {error}
        </Text>
      )}

      {/* THE FIRST LOAD SHOWS THE LIST'S SHAPE, and the rows fade in over it (motion-is-small-quick-and-shared). */}
      {loading ? (
        <ListSkeleton testId="racks-loading" />
      ) : (
        <Box animationStyle="swap">
          <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>
        </Box>
      )}

      {/* THE PAGES GROW AS THEY ARE OPENED, and the pager is always on screen (every-list-pages-with-the-growing-pager,
          the-pager-is-always-on-screen). */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
        resetKey={[term, pageSize].join("|")}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="racks-pager"
      />

      {/* One form, a new rack or the row being edited. Keyed so it opens fresh each time. */}
      {form && (
        <RackFormDialog
          key={form.rack?.id.toString() ?? "new"}
          rack={form.rack}
          open
          onOpenChange={(o) => {
            if (!o) setForm(null);
          }}
        />
      )}
    </Stack>
  );
}

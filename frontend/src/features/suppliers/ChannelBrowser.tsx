import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, HStack, Icon, Link, Stack, Table, Text } from "@chakra-ui/react";
import { ExternalLink, SearchX, Store } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { SupplierChannelRecord } from "./adapt";
import { useSupplierChannelPage } from "./queries";
import { useDebounced } from "../../lib/useDebounced";
import { enumCodec, textCodec, useUrlState } from "../../lib/urlState";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { useIsMobile } from "../../layouts/shell";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { MARKETPLACES, MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { type FigureMarks, SupplierFigureCells, SupplierFigureHeaders, SupplierFigureLines } from "./SupplierFigures";
import { sampleStoreFigures } from "./sampleSupplierFigures";
import { SupplierTabExport } from "./SupplierTabExport";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP under the pointer, every cell of it (owner, on the Toko and Produk tabs: *"toko dan produk hoverable"*,
// `a-supplier-tab-row-lights-up`). On the cells, so the whole width turns; Chakra's `_hover` honours `data-hover`, which
// is how a story drives it.
export const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// A channel's link, opened in a new tab — or a dash, since the link is optional.
function ChannelLink({ uri }: { uri: string }) {
  if (!uri) {
    return <Text color="fg.muted">—</Text>;
  }

  return (
    <Link href={uri} target="_blank" rel="noreferrer" colorPalette="brand" wordBreak="break-all">
      {uri}
      <Icon as={ExternalLink} boxSize="3.5" />
    </Link>
  );
}

// A store as one cell in two lines: its name, then its type — the badge UNDER the reference, so the badges line up
// down the list (a-store-reads-its-name-then-its-type). Bold where the store is the row's subject (the Toko tab),
// plain where it only says where a product was bought (the Produk tab).
export function ChannelName({ channel, bold = true }: { channel: SupplierChannelRecord; bold?: boolean }) {
  return (
    <Stack gap="1" align="start" minW="0">
      <Text fontWeight={bold ? "bold" : undefined}>{channel.name}</Text>
      <MarketplaceBadge marketplace={channel.channelType} />
    </Stack>
  );
}

export interface ChannelBrowserProps {
  /** The CALLER's team — the scope the read is authorised in, not the team that keeps the supplier. */
  teamId: bigint;
  /** Any team's live supplier — reads cross teams. */
  supplierId: bigint;
  /** Page actions in the filter bar's action slot — Add Store on the manage page. */
  actions?: ReactNode;
  /**
   * The empty list's own action — Add Store again, under "no stores yet". ⚠ Its OWN node, never `actions` mounted a
   * second time: the same trigger twice puts two elements behind one test id, which fails every spec that clicks it.
   */
  emptyAction?: ReactNode;
  /** Per-row actions; absent = read-only, as on the discover detail. */
  rowActions?: (channel: SupplierChannelRecord) => ReactNode;
  /** The page's own pending mark for the Description column, if it has one. */
  descriptionMark?: ReactNode;
  /** The page's marks for Terjual and Siap — sample figures, numbered in the page's own pending list. */
  figureMarks: FigureMarks;
  /** The page's mark for the tab's Export (each-supplier-tab-exports-its-own-table). */
  exportMark: ReactNode;
}

// ChannelBrowser is a supplier's CHANNELS tab — on the manage detail and on the discover detail alike
// (supplier-detail-has-channels-and-products-tabs): every store the supplier sells through, ONE list, a
// marketplace badge per row (channel-type-is-the-marketplace-list), searched by name, link or description,
// filtered by channel type and paged (the-channels-tab-searches-filters-and-pages).
//
// It reads for itself: the search, the type and the page go to SupplierChannelList, which searches, filters and
// pages ON THE SERVER (useSupplierChannelPage). The search is debounced, so a word is one request, not one per
// key — the previous rows stay up behind the RefreshOverlay while the answer loads (HARD RULE 10).
//
// EACH STORE'S TERJUAL AND SIAP (owner: *"di channel dan produk ada ready dan sold tadi"*,
// `the-detail-tabs-show-sold-and-ready`) — the supplier list's figures, for what was bought at this store: the last two
// columns before the actions, the last order and the last restock under them; on a phone, a line each.
//
//   Toko pemasok              Link        Deskripsi    Terjual ⚠2          Siap ⚠3           Aksi
//   Sumber Makmur Official    shopee.…    …               1.204                86             [✎ Ubah] …
//   [Shopee]                                         pesanan 5 Okt 2026  restok 20 Sep 2026
//
// ⚠ SAMPLE FIGURES (sampleStoreFigures) — nothing yet says which products were bought at which store.
export function ChannelBrowser({
  teamId,
  supplierId,
  actions,
  emptyAction,
  rowActions,
  descriptionMark,
  figureMarks,
  exportMark,
}: ChannelBrowserProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — `store.`-prefixed, since the Produk and Statistik
  // tabs share the detail page's route and keep their own.
  const [q, setQ] = useUrlState("store.q", "", textCodec);
  const [channelType, setChannelType] = useUrlState("store.type", Marketplace.UNSPECIFIED, enumCodec(MARKETPLACES));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const filtering = q.trim() !== "" || channelType !== Marketplace.UNSPECIFIED;
  const term = useDebounced(q.trim());

  // A filter change is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }
  const clearFilters = () =>
    refilter(() => {
      setQ("");
      setChannelType(Marketplace.UNSPECIFIED);
    });

  const query = useSupplierChannelPage({ teamId, supplierId, q: term, channelType, page, pageSize });
  const channels = query.data?.channels ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const error = query.isError ? rpcError(query.error) : "";
  // What the rows on screen were asked with — the settled search, not the one still being typed.
  const narrowed = term !== "" || channelType !== Marketplace.UNSPECIFIED;

  function list() {
    if (channels.length === 0 && !error) {
      // Nothing at all, or nothing that matches — two different things to tell somebody, each with what to do
      // (an-empty-list-shows-a-hint): clear the filters, or add a store with the page's own action.
      return narrowed ? (
        <EmptyHint
          icon={SearchX}
          size="sm"
          title={t("supplierChannel.filter.none")}
          description={t("emptyHint.noMatch")}
          action={<Button variant="outline" colorPalette="gray" onClick={clearFilters}>
              {t("common.clearFilters")}
            </Button>}
          testId="channels-none-match"
        />
      ) : (
        <EmptyHint
          icon={Store}
          size="sm"
          title={t("supplierChannel.section.empty")}
          description={t("supplierChannel.section.emptyHint")}
          action={emptyAction}
          testId="channels-empty"
        />
      );
    }

    if (isMobile) {
      // A phone reads each channel as a block: the store's name, its type under it, then the link and the
      // description on their own lines — and the row's actions at the foot, so they never squeeze the name
      // into a narrow column (a-supplier-action-is-labelled).
      return (
        <Stack gap="2" data-testid="channels-table">
          {channels.map((ch) => (
            <Stack
              key={ch.id.toString()}
              data-testid={`channel-row-${ch.id}`}
              borderWidth="1px"
              borderRadius="md"
              p="3"
              gap="2"
            >
              <Stack gap="1" minW="0">
                <ChannelName channel={ch} />
                <ChannelLink uri={ch.uri} />
                {ch.description && (
                  <Text fontSize="sm" color="fg.muted">
                    {ch.description}
                  </Text>
                )}
              </Stack>
              <SupplierFigureLines
                figures={sampleStoreFigures(ch.id)}
                marks={figureMarks}
                testId={`channel-row-${ch.id}-figures`}
              />
              {rowActions?.(ch)}
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      <Table.Root size="sm" data-testid="channels-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("supplierChannel.table.channel")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("supplierChannel.table.uri")}</Table.ColumnHeader>
            <Table.ColumnHeader>
              <HStack gap="1">
                {t("supplierChannel.table.description")}
                {descriptionMark}
              </HStack>
            </Table.ColumnHeader>
            <SupplierFigureHeaders marks={figureMarks} />
            {rowActions && <Table.ColumnHeader textAlign="end">{t("supplierChannel.table.actions")}</Table.ColumnHeader>}
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {channels.map((ch) => (
            <Table.Row key={ch.id.toString()} data-testid={`channel-row-${ch.id}`} css={LIGHTS_UP}>
              <Table.Cell>
                <ChannelName channel={ch} />
              </Table.Cell>

              <Table.Cell maxW="xs">
                <ChannelLink uri={ch.uri} />
              </Table.Cell>

              <Table.Cell maxW="xs">
                <Text lineClamp={2} color={ch.description ? undefined : "fg.muted"}>
                  {ch.description || "—"}
                </Text>
              </Table.Cell>

              <SupplierFigureCells figures={sampleStoreFigures(ch.id)} id={ch.id} testIdPrefix="channel" />

              {rowActions && <Table.Cell textAlign="end">{rowActions(ch)}</Table.Cell>}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <Stack gap="card" data-testid="channels-section">
      <FilterBar
        testId="channels-filter"
        active={filtering}
        count={(q.trim() !== "" ? 1 : 0) + (channelType !== Marketplace.UNSPECIFIED ? 1 : 0)}
        onClear={clearFilters}
        // The tab's Export, then the page's own action — the primary one stays rightmost. A phone's Export is in the sheet.
        actions={
          isMobile ? (
            actions
          ) : (
            <>
              <SupplierTabExport mark={exportMark} testId="channels-export" />
              {actions}
            </>
          )
        }
      >
        <FilterSearch
          value={q}
          onChange={(value) => refilter(() => setQ(value))}
          placeholder={t("supplierChannel.filter.search")}
          testId="channels-search"
        />

        {/* Seven types, static — a plain list, not a search (CLAUDE.md: bounded forever). Empty = every type; its ×
            clears it (every-filter-clears-from-its-own-x). */}
        <FilterField w="15rem" testId="channels-type-filter">
          <MarketplaceSelect
            clearable
            value={channelType}
            placeholder={t("supplierChannel.filter.typeAll")}
            onChange={(m) => refilter(() => setChannelType(m))}
          />
        </FilterField>
        {/* On a phone the Export is in the Filter sheet, full width — its row has no room (each-supplier-tab-exports-its-own-table). */}
        {isMobile && <SupplierTabExport mark={exportMark} testId="channels-export" />}
      </FilterBar>

      {error && (
        <Text color="error.fg" data-testid="channels-error">
          {error}
        </Text>
      )}

      {/* The first load shows the list's shape, and the rows fade in over it — once; a refresh keeps them mounted
          (`motion-is-small-quick-and-shared`). */}
      {query.isPending ? (
        <ListSkeleton rows={3} testId="channels-loading" />
      ) : (
        <Box animationStyle="swap">
          <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>
        </Box>
      )}

      {/* every-list-pages-with-the-growing-pager — the pages opened so far, one click back to any of them. */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
        resetKey={[term, channelType, pageSize].join("|")}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="channels-pager"
      />
    </Stack>
  );
}

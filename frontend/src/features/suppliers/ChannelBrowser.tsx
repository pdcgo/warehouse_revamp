import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HStack, Icon, Link, Stack, Table, Text } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { SupplierChannelRecord } from "./adapt";
import { useSupplierChannelPage } from "./queries";
import { useDebounced } from "../../lib/useDebounced";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { useIsMobile } from "../../layouts/shell";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";

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
  /** Per-row actions; absent = read-only, as on the discover detail. */
  rowActions?: (channel: SupplierChannelRecord) => ReactNode;
  /** The page's own pending mark for the Description column, if it has one. */
  descriptionMark?: ReactNode;
}

// ChannelBrowser is a supplier's CHANNELS tab — on the manage detail and on the discover detail alike
// (supplier-detail-has-channels-and-products-tabs): every store the supplier sells through, ONE list, a
// marketplace badge per row (channel-type-is-the-marketplace-list), searched by name, link or description,
// filtered by channel type and paged (the-channels-tab-searches-filters-and-pages).
//
// It reads for itself: the search, the type and the page go to SupplierChannelList, which searches, filters and
// pages ON THE SERVER (useSupplierChannelPage). The search is debounced, so a word is one request, not one per
// key — the previous rows stay up behind the RefreshOverlay while the answer loads (HARD RULE 10).
export function ChannelBrowser({
  teamId,
  supplierId,
  actions,
  rowActions,
  descriptionMark,
}: ChannelBrowserProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const [q, setQ] = useState("");
  const [channelType, setChannelType] = useState<Marketplace>(Marketplace.UNSPECIFIED);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const filtering = q.trim() !== "" || channelType !== Marketplace.UNSPECIFIED;
  const term = useDebounced(q.trim());

  // A filter change is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }

  const query = useSupplierChannelPage({ teamId, supplierId, q: term, channelType, page, pageSize });
  const channels = query.data?.channels ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const error = query.isError ? rpcError(query.error) : "";
  // What the rows on screen were asked with — the settled search, not the one still being typed.
  const narrowed = term !== "" || channelType !== Marketplace.UNSPECIFIED;

  function list() {
    if (channels.length === 0 && !error) {
      // Nothing at all, or nothing that matches — two different things to tell somebody.
      return narrowed ? (
        <Text color="fg.muted" data-testid="channels-none-match">
          {t("supplierChannel.filter.none")}
        </Text>
      ) : (
        <Text color="fg.muted" data-testid="channels-empty">
          {t("supplierChannel.section.empty")}
        </Text>
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
        onClear={() =>
          refilter(() => {
            setQ("");
            setChannelType(Marketplace.UNSPECIFIED);
          })
        }
        actions={actions}
      >
        <FilterSearch
          value={q}
          onChange={(value) => refilter(() => setQ(value))}
          placeholder={t("supplierChannel.filter.search")}
          testId="channels-search"
        />

        {/* Seven types, static — a plain list, not a search (CLAUDE.md: bounded forever). Empty = every type. */}
        <FilterField w="15rem" testId="channels-type-filter">
          <MarketplaceSelect
            value={channelType}
            placeholder={t("supplierChannel.filter.typeAll")}
            onChange={(m) => refilter(() => setChannelType(m))}
          />
        </FilterField>
      </FilterBar>

      {error && (
        <Text color="error.fg" data-testid="channels-error">
          {error}
        </Text>
      )}

      {query.isPending ? null : (
        <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>
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

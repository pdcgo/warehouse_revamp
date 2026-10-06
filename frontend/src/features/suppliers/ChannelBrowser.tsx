import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Flex, HStack, Icon, Link, Stack, Table, Text } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { type SupplierChannelRecord, channelPage } from "./adapt";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { useIsMobile } from "../../layouts/shell";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

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

export interface ChannelBrowserProps {
  /** The supplier's WHOLE channel list — searched, filtered and paged here (see channelPage). */
  channels: SupplierChannelRecord[];
  loading?: boolean;
  /** A refetch is in flight while rows are on screen — the RefreshOverlay's cue. */
  busy?: boolean;
  error?: string;
  /** Page actions in the filter bar's action slot — Add Channel on the manage page. */
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
// ⚠ The search, the filter and the pager run HERE, over the whole list (channelPage in adapt.ts), because the
// old SupplierChannelList can do none of the three. When supplier_service pages on the server, this takes a
// page and its callbacks instead of the whole list — the screen does not change.
export function ChannelBrowser({
  channels: all,
  loading = false,
  busy = false,
  error = "",
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

  // A filter change is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }

  const { channels, totalItems } = channelPage(all, { q, channelType, page, pageSize });

  function list() {
    if (channels.length === 0 && !error) {
      // Nothing at all, or nothing that matches — two different things to tell somebody.
      return filtering ? (
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
      // A phone reads each channel as a block: the type and the name, then the link and the description on
      // their own lines.
      return (
        <Stack gap="2" data-testid="channels-table">
          {channels.map((ch) => (
            <Flex
              key={ch.id.toString()}
              data-testid={`channel-row-${ch.id}`}
              borderWidth="1px"
              borderRadius="md"
              p="3"
              gap="2"
              align="start"
            >
              <Stack gap="1" minW="0" flex="1">
                <HStack gap="2">
                  <MarketplaceBadge marketplace={ch.channelType} />
                  <Text fontWeight="bold">{ch.name}</Text>
                </HStack>
                <ChannelLink uri={ch.uri} />
                {ch.description && (
                  <Text fontSize="sm" color="fg.muted">
                    {ch.description}
                  </Text>
                )}
              </Stack>
              {rowActions?.(ch)}
            </Flex>
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
            <Table.Row key={ch.id.toString()} data-testid={`channel-row-${ch.id}`}>
              <Table.Cell>
                <HStack gap="2">
                  <MarketplaceBadge marketplace={ch.channelType} />
                  <Text>{ch.name}</Text>
                </HStack>
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

      {loading ? null : <RefreshOverlay busy={busy}>{list()}</RefreshOverlay>}

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
    </Stack>
  );
}

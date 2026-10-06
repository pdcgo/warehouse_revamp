import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Flex, HStack, Heading, Stack, Table, Text } from "@chakra-ui/react";
import { rpcError } from "../../api/clients";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { type DiscoverSupplier, useDiscoverSuppliers } from "../../features/suppliers/discover";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useIsMobile } from "../../layouts/shell";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { TeamItem } from "../../components/entity/TeamItem";
import { DISCOVER_SUPPLIERS_PENDING } from "./pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A supplier's stores as badges — one per channel TYPE, so a supplier with three Shopee stores reads "Shopee ×3"
// rather than three identical badges.
function ChannelTypes({ supplier }: { supplier: DiscoverSupplier }) {
  const counts = new Map<Marketplace, number>();
  for (const c of supplier.channels) {
    counts.set(c.channelType, (counts.get(c.channelType) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return <Text color="fg.muted">—</Text>;
  }

  return (
    <HStack gap="1" wrap="wrap">
      {[...counts].map(([type, n]) => (
        <HStack key={type} gap="0.5">
          <MarketplaceBadge marketplace={type} />
          {n > 1 && (
            <Text fontSize="xs" color="fg.muted">
              ×{n}
            </Text>
          )}
        </HStack>
      ))}
    </HStack>
  );
}

// DiscoverSuppliersPage searches suppliers ACROSS EVERY TEAM — "who sells this, anywhere in the company?"
// (manage-and-discover-are-two-pages). It is independent of the Suppliers page, which lists the suppliers THIS
// team keeps and manages: nothing here is editable, each row names the team that keeps the supplier, and a row
// opens the DISCOVER detail (/inventories/suppliers/discover/:id) — never the manage detail, which answers the
// owning team only. Another team sees a supplier in full (another-team-sees-everything-of-a-supplier).
//
// ⚠ SAMPLE ROWS until the cross-team read exists — see features/suppliers/discover.ts and ./pending.ts.
export function DiscoverSuppliersPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [q, setQ] = useState("");
  const [channelType, setChannelType] = useState<Marketplace>(Marketplace.UNSPECIFIED);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const filtering = q.trim() !== "" || channelType !== Marketplace.UNSPECIFIED;

  // A filter change is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }

  const query = useDiscoverSuppliers({ teamId: current?.teamId, q, channelType, page, pageSize });
  const suppliers = query.data?.suppliers ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const error = query.isError ? rpcError(query.error) : "";

  const open = (s: DiscoverSupplier) => navigate(`/inventories/suppliers/discover/${s.id}`);
  const team = (s: DiscoverSupplier) => (
    <TeamItem team={{ teamId: s.teamId, teamName: s.teamName, teamType: TeamType.SELLING }} />
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("suppliers.discover.title")}</Heading>
        <Text color="fg.muted" data-testid="discover-suppliers-no-team">
          {t("suppliers.selectTeam")}
        </Text>
      </Stack>
    );
  }

  function list() {
    if (suppliers.length === 0 && !error) {
      return (
        <Text color="fg.muted" data-testid={filtering ? "discover-suppliers-none-match" : "discover-suppliers-empty"}>
          {filtering ? t("suppliers.discover.none") : t("suppliers.discover.empty")}
        </Text>
      );
    }

    if (isMobile) {
      // A phone reads each supplier as a block: the name, the team, then its stores.
      return (
        <Stack gap="2" data-testid="discover-suppliers-table">
          {suppliers.map((s) => (
            <Stack
              key={s.id.toString()}
              data-testid={`discover-supplier-row-${s.id}`}
              gap="2"
              borderWidth="1px"
              borderRadius="md"
              p="3"
              cursor="pointer"
              onClick={() => open(s)}
            >
              <Text fontWeight="bold">{s.name}</Text>
              {team(s)}
              <ChannelTypes supplier={s} />
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      <Table.Root size="sm" data-testid="discover-suppliers-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("suppliers.discover.table.supplier")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("suppliers.discover.table.team")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("suppliers.discover.table.channels")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("suppliers.discover.table.contact")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {suppliers.map((s) => (
            <Table.Row
              key={s.id.toString()}
              data-testid={`discover-supplier-row-${s.id}`}
              cursor="pointer"
              _hover={{ bg: "bg.subtle" }}
              onClick={() => open(s)}
            >
              <Table.Cell>
                {/* Two lines, one context: the supplier, and where it is. */}
                <Stack gap="0">
                  <Text fontWeight="bold">{s.name}</Text>
                  <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                    {s.address || "—"}
                  </Text>
                </Stack>
              </Table.Cell>
              <Table.Cell>
                <Box maxW="15rem">{team(s)}</Box>
              </Table.Cell>
              <Table.Cell>
                <ChannelTypes supplier={s} />
              </Table.Cell>
              <Table.Cell>{s.contact || "—"}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <Stack gap="section" data-testid="discover-suppliers-page">
      <Stack gap="1">
        <Flex align="center" gap="2">
          <Heading size="md">{t("suppliers.discover.title")}</Heading>
          <NotImplemented list={DISCOVER_SUPPLIERS_PENDING} id="suppliers" />
        </Flex>
        <Text color="fg.muted" fontSize="sm">
          {t("suppliers.discover.lead")}
        </Text>
      </Stack>

      <NotImplementedSummary list={DISCOVER_SUPPLIERS_PENDING} />

      <FilterBar
        testId="discover-suppliers-filter"
        active={filtering}
        count={(q.trim() !== "" ? 1 : 0) + (channelType !== Marketplace.UNSPECIFIED ? 1 : 0)}
        onClear={() =>
          refilter(() => {
            setQ("");
            setChannelType(Marketplace.UNSPECIFIED);
          })
        }
      >
        <FilterSearch
          value={q}
          onChange={(value) => refilter(() => setQ(value))}
          placeholder={t("suppliers.discover.search")}
          testId="discover-suppliers-search"
        />

        {/* "Who sells on Shopee?" — seven types, static, a plain list. Empty = any type. */}
        <FilterField w="15rem" testId="discover-suppliers-type-filter">
          <MarketplaceSelect
            value={channelType}
            placeholder={t("suppliers.discover.typeAll")}
            onChange={(m) => refilter(() => setChannelType(m))}
          />
        </FilterField>
      </FilterBar>

      {error && (
        <Text color="error.fg" data-testid="discover-suppliers-error">
          {error}
        </Text>
      )}

      {query.isPending ? null : <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>}

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

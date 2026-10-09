import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Heading, Stack, Table, Text } from "@chakra-ui/react";
import { rpcError } from "../../api/clients";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { ChannelTypes } from "../../features/suppliers/ChannelTypes";
import { type DiscoverSupplier, useDiscoverSuppliers } from "../../features/suppliers/discover";
import { useIsMobile } from "../../layouts/shell";
import { useDebounced } from "../../lib/useDebounced";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { TeamItem } from "../../components/entity/TeamItem";
import { TeamSelect } from "../../components/teams/TeamSelect";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// DiscoverSuppliersPage searches suppliers ACROSS EVERY TEAM — "who sells this, anywhere in the company?"
// (manage-and-discover-are-two-pages). It is independent of the Suppliers page, which lists the suppliers THIS
// team keeps and manages: nothing here is editable, each row names the team that keeps the supplier, and a row
// opens the DISCOVER detail (/inventories/suppliers/discover/:id) — never the manage detail, which carries the
// owning team's actions. Another team sees a supplier in full (another-team-sees-everything-of-a-supplier).
//
// Real rows — supplier_service's SupplierList across every team (features/suppliers/discover.ts). The search runs
// on the server over the supplier's name, address and contact and its stores' names; ⚠ NOT over the team's
// name, which supplier_service does not hold — the team is PICKED instead (discover-filters-by-the-team-that-keeps-it).
export function DiscoverSuppliersPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [q, setQ] = useState("");
  const [channelType, setChannelType] = useState<Marketplace>(Marketplace.UNSPECIFIED);
  // The team that keeps the supplier — 0n is any team.
  const [ownerTeamId, setOwnerTeamId] = useState(0n);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const filtering = q.trim() !== "" || channelType !== Marketplace.UNSPECIFIED || ownerTeamId !== 0n;
  // Typed, then settled — a word is one request to the server, not one per key.
  const term = useDebounced(q.trim());
  // What the rows on screen were asked with, which is what "nothing matches" is about.
  const narrowed = term !== "" || channelType !== Marketplace.UNSPECIFIED || ownerTeamId !== 0n;

  // A filter change is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }

  const query = useDiscoverSuppliers({ teamId: current?.teamId, q: term, channelType, ownerTeamId, page, pageSize });
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
        <Text color="fg.muted" data-testid={narrowed ? "discover-suppliers-none-match" : "discover-suppliers-empty"}>
          {narrowed ? t("suppliers.discover.none") : t("suppliers.discover.empty")}
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
              <ChannelTypes channels={s.channels} />
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
                <ChannelTypes channels={s.channels} />
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
        <Heading size="md">{t("suppliers.discover.title")}</Heading>
        <Text color="fg.muted" fontSize="sm">
          {t("suppliers.discover.lead")}
        </Text>
      </Stack>

      <FilterBar
        testId="discover-suppliers-filter"
        active={filtering}
        count={(q.trim() !== "" ? 1 : 0) + (channelType !== Marketplace.UNSPECIFIED ? 1 : 0) + (ownerTeamId !== 0n ? 1 : 0)}
        onClear={() =>
          refilter(() => {
            setQ("");
            setChannelType(Marketplace.UNSPECIFIED);
            setOwnerTeamId(0n);
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

        {/* "Whose suppliers?" — the team that keeps them. Selling teams only: only a selling team has suppliers
            (only-a-selling-team-has-suppliers). Empty = any team. */}
        <FilterField w="15rem" testId="discover-suppliers-team-filter">
          <TeamSelect
            value={ownerTeamId}
            teamType={TeamType.SELLING}
            placeholder={t("suppliers.discover.teamAll")}
            onChange={(id) => refilter(() => setOwnerTeamId(id))}
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

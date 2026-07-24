import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Checkbox,
  Flex,
  Heading,
  Icon,
  Input,
  NativeSelect,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Stat,
  Table,
  Text,
} from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";

import { rpcError, teamClient } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useSettlementPositions } from "../../features/settlement/queries";
import { directionCopy, daysSince } from "../../features/settlement/direction";
import { Pagination } from "../../components/Pagination";
import { formatRupiah } from "../../lib/money";

const PAGE_SIZE = 20;

// How the age of the oldest unsettled entry reads — the actionable signal (#221). The colour escalates
// with age; a manager chases the reddening rows first.
function ageColor(days: number): string {
  if (days >= 30) return "red.fg";
  if (days >= 14) return "orange.fg";
  return "fg.subtle";
}

function teamKindKey(type: TeamType): string {
  switch (type) {
    case TeamType.WAREHOUSE:
      return "liability.kindWarehouse";
    case TeamType.SELLING:
      return "liability.kindSelling";
    case TeamType.ROOT:
      return "liability.kindRoot";
    default:
      return "liability.kindOther";
  }
}

// LiabilityListPage is the settlement position list (#221/§5.1 A): one row per counterparty, BOTH
// directions in one list. Direction is words and TWO columns, never a sign; ageing is the point.
export function LiabilityListPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const teamId = current?.teamId;

  const [unsettledOnly, setUnsettledOnly] = useState(true);
  const [awaitingOnly, setAwaitingOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [page, setPage] = useState(1);

  const query = useSettlementPositions({ teamId, page, pageSize: PAGE_SIZE, unsettledOnly });
  const positions = query.data?.positions ?? [];
  const total = query.data?.totalItems ?? 0;
  const awaitingTotal = query.data?.awaitingConfirmation ?? 0;

  // Resolve the counterparties' names and kinds in one batch — they are other teams (#142).
  const ids = useMemo(() => positions.map((p) => p.counterpartyId), [positions]);
  const teamsQuery = useQuery({
    queryKey: ["team-by-ids", ids.map((id) => id.toString()).sort()],
    enabled: ids.length > 0,
    queryFn: () => teamClient.teamByIds({ ids }),
  });
  const teamMap = teamsQuery.data?.data ?? {};

  // Search and team-type filter narrow the LOADED page client-side, as the mock drives them.
  const rows = positions.filter((p) => {
    const team = teamMap[p.counterpartyId.toString()];
    const name = team?.name ?? "";
    if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
    if (kind !== "all" && team && team.type.toString() !== kind) return false;
    if (awaitingOnly && p.awaitingConfirmation === 0) return false;
    return true;
  });

  // The header tiles, computed over the page in view.
  const totalPayable = rows.reduce((s, p) => (p.balance < 0n ? s - p.balance : s), 0n);
  const totalReceivable = rows.reduce((s, p) => (p.balance > 0n ? s + p.balance : s), 0n);
  const oldest = rows
    .filter((p) => p.oldestUnsettledAtUnix > 0n)
    .sort((a, b) => Number(a.oldestUnsettledAtUnix - b.oldestUnsettledAtUnix))[0];

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("liability.title")}</Heading>
        <Text color="fg.muted">{t("settlement.selectTeamView")}</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="liability-list-page">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("liability.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        {awaitingTotal > 0 && (
          <Badge colorPalette="purple" data-testid="liability-awaiting-nav">
            {t("liability.awaitingNav", { count: awaitingTotal })}
          </Badge>
        )}
      </Flex>

      <SimpleGrid columns={{ base: 2, md: 4 }} gap="card">
        <Stat.Root>
          <Stat.Label>{t("liability.totalPayable")}</Stat.Label>
          <Stat.ValueText color="orange.fg" data-testid="liability-total-payable">
            {formatRupiah(totalPayable)}
          </Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("liability.totalReceivable")}</Stat.Label>
          <Stat.ValueText color="green.fg">{formatRupiah(totalReceivable)}</Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("liability.awaitingTile")}</Stat.Label>
          <Stat.ValueText color={awaitingTotal > 0 ? "purple.fg" : undefined}>
            {awaitingTotal.toString()}
          </Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("liability.oldestTile")}</Stat.Label>
          <Stat.ValueText color={oldest ? ageColor(daysSince(oldest.oldestUnsettledAtUnix)) : undefined}>
            {oldest ? t("liability.days", { count: daysSince(oldest.oldestUnsettledAtUnix) }) : "—"}
          </Stat.ValueText>
          {oldest && teamMap[oldest.counterpartyId.toString()] && (
            <Stat.HelpText>{teamMap[oldest.counterpartyId.toString()]?.name}</Stat.HelpText>
          )}
        </Stat.Root>
      </SimpleGrid>

      <Flex gap="card" wrap="wrap" align="center">
        <Input
          maxW="xs"
          placeholder={t("liability.searchPlaceholder")}
          value={search}
          data-testid="liability-search"
          onChange={(e) => setSearch(e.target.value)}
        />
        <NativeSelect.Root maxW="44">
          <NativeSelect.Field
            value={kind}
            data-testid="liability-kind"
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="all">{t("liability.kindAll")}</option>
            <option value={TeamType.WAREHOUSE.toString()}>{t("liability.kindWarehouse")}</option>
            <option value={TeamType.SELLING.toString()}>{t("liability.kindSelling")}</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <Checkbox.Root
          checked={awaitingOnly}
          onCheckedChange={(e) => setAwaitingOnly(!!e.checked)}
          data-testid="liability-awaiting-only"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>{t("liability.awaitingOnly")}</Checkbox.Label>
        </Checkbox.Root>
        <Checkbox.Root
          checked={unsettledOnly}
          onCheckedChange={(e) => {
            setUnsettledOnly(!!e.checked);
            setPage(1);
          }}
          data-testid="liability-unsettled-only"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>{t("liability.unsettledOnly")}</Checkbox.Label>
        </Checkbox.Root>
        <Spacer />
      </Flex>

      {query.isPending ? (
        <Spinner colorPalette="brand" />
      ) : query.isError ? (
        <Text color="red.fg" data-testid="liability-error">
          {rpcError(query.error)}
        </Text>
      ) : (
        <Stack gap="card">
          <Table.Root size="sm" data-testid="liability-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("liability.colCounterparty")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("liability.colPayable")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("liability.colReceivable")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("liability.colOldest")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("liability.colAwaiting")}</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((p) => {
                const team = teamMap[p.counterpartyId.toString()];
                const days = p.oldestUnsettledAtUnix > 0n ? daysSince(p.oldestUnsettledAtUnix) : 0;
                const ageC = ageColor(days);
                return (
                  <Table.Row
                    key={p.counterpartyId.toString()}
                    cursor="pointer"
                    _hover={{ bg: "bg.muted" }}
                    data-testid={`liability-row-${p.counterpartyId}`}
                    onClick={() => navigate(`/liability/${p.counterpartyId}`)}
                  >
                    <Table.Cell>
                      <Text as="span" fontWeight="medium">
                        {team?.name ?? t("liability.teamFallback", { id: p.counterpartyId.toString() })}
                      </Text>
                      {team && (
                        <Text color="fg.subtle" fontSize="xs">
                          {t(teamKindKey(team.type))}
                        </Text>
                      )}
                    </Table.Cell>
                    {/* Direction is TWO columns, never a sign (#185). */}
                    <Table.Cell textAlign="end" color="orange.fg">
                      {p.balance < 0n ? formatRupiah(-p.balance) : "—"}
                    </Table.Cell>
                    <Table.Cell textAlign="end" color="green.fg">
                      {p.balance > 0n ? formatRupiah(p.balance) : "—"}
                    </Table.Cell>
                    <Table.Cell>
                      {p.oldestUnsettledAtUnix > 0n ? (
                        <Text color={ageC} data-testid={`liability-age-${p.counterpartyId}`}>
                          {t("liability.days", { count: days })}
                        </Text>
                      ) : (
                        <Text color="fg.subtle">{t(directionCopy(0n).key)}</Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {p.awaitingConfirmation > 0 && (
                        <Badge colorPalette="purple">
                          {t("liability.toConfirm", { count: p.awaitingConfirmation })}
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Icon as={ChevronRight} boxSize="4" color="fg.subtle" />
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>

          {rows.length === 0 ? (
            <Text color="fg.muted" data-testid="liability-empty">
              {t("liability.empty")}
            </Text>
          ) : (
            <Pagination page={page} pageSize={PAGE_SIZE} count={total} onPageChange={setPage} />
          )}
        </Stack>
      )}
    </Stack>
  );
}

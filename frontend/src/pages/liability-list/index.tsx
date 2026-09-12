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
import { teamByIdsRowData, teamsByIds } from "../../features/teams/adapt";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useLiabilityPositions, useLiabilityTerms } from "../../features/liability/queries";
import { directionCopy, daysSince } from "../../features/liability/direction";
import { WARN_AT, limitStateOf } from "../../features/liability/CreditMeter";
import { TermsEditDialog } from "../../features/liability/TermsEditDialog";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { Button } from "@chakra-ui/react";
import { Pagination } from "../../components/chrome/Pagination";
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

// LiabilityListPage is the liability position list (#221/§5.1 A): one row per counterparty, BOTH
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
  const [defaultTermsOpen, setDefaultTermsOpen] = useState(false);

  const query = useLiabilityPositions({ teamId, page, pageSize: PAGE_SIZE, unsettledOnly });
  const positions = query.data?.positions ?? [];
  const total = query.data?.totalItems ?? 0;
  const awaitingTotal = query.data?.awaitingConfirmation ?? 0;

  // Resolve the counterparties' names and kinds in one batch — they are other teams (#142).
  //
  // ⚠ THE OLDEST-DEBT TEAM IS ADDED EVEN IF IT IS NOT ON THIS PAGE. That tile is a whole-set answer
  // and the rows are one page, so the team it names is frequently somewhere else — resolving names
  // only for the visible rows would leave the tile showing an age with nobody attached, on exactly
  // the screens where it matters most (a creditor with more counterparties than fit on a page).
  const ids = useMemo(() => {
    const seen = positions.map((p) => p.counterpartyId);
    const oldestId = query.data?.summary.oldestCounterpartyId ?? 0n;

    if (oldestId !== 0n && !seen.includes(oldestId)) {
      return [...seen, oldestId];
    }

    return seen;
  }, [positions, query.data?.summary.oldestCounterpartyId]);
  const teamsQuery = useQuery({
    queryKey: ["team-by-ids", ids.map((id) => id.toString()).sort()],
    enabled: ids.length > 0,
    queryFn: async () =>
      teamsByIds(await teamClient.teamByIds({ filter: { ids }, dataRequest: teamByIdsRowData() })),
  });
  const teamMap = teamsQuery.data ?? {};

  // THE LIMITS THIS TEAM HAS SET, for the 80% warning (§About Thresholds 1) and for the DEFAULT row.
  //
  // ⚠ TERMS ARE READ BESIDE POSITIONS, never merged into one. A position is what is OWED; a limit is a
  // RULE about it. Putting the limit on the position row would make every later change to the rules a
  // change to the ledger's contract — and the two have different owners and different lifetimes.
  //
  // A creditor's own terms are a handful of rows in practice, so one large page fetches the lot.
  const termsQuery = useLiabilityTerms({ teamId, page: 1, pageSize: 200 });

  const limitOf = useMemo(() => {
    const byCounterparty = new Map<string, bigint | undefined>();
    let fallback: bigint | undefined;

    for (const row of termsQuery.data?.terms ?? []) {
      if (row.counterpartyId === 0n) {
        fallback = row.creditLimit;
        continue;
      }
      byCounterparty.set(row.counterpartyId.toString(), row.creditLimit);
    }

    // ⚠ THE DEFAULT ROW IS THE RULE THE OTHERS ARE EXCEPTIONS TO. A debtor with no row of their own
    // inherits it — which is why `has` decides, not a truthy check: `undefined` is a real value here
    // meaning UNLIMITED, and it is the opposite of `0n`, meaning frozen.
    return (counterpartyId: bigint): bigint | undefined =>
      byCounterparty.has(counterpartyId.toString())
        ? byCounterparty.get(counterpartyId.toString())
        : fallback;
  }, [termsQuery.data]);

  const defaultTerms = (termsQuery.data?.terms ?? []).find((row) => row.counterpartyId === 0n);

  // ROOT and ADMIN write somebody else's terms, which is what makes a reason REQUIRED
  // (a-limit-change-is-recorded). The server decides for real; this only shapes the form.
  const overrideWriter = current?.role === Role.ROOT || current?.role === Role.ADMIN;

  // Search and team-type filter narrow the LOADED page client-side, as the mock drives them.
  const rows = positions.filter((p) => {
    const team = teamMap[p.counterpartyId.toString()];
    const name = team?.name ?? "";
    if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
    if (kind !== "all" && team && team.type.toString() !== kind) return false;
    if (awaitingOnly && p.awaitingConfirmation === 0) return false;
    return true;
  });

  // ⚠ THE TILES COME FROM THE SERVER, over EVERY counterparty — never from `rows`, which is one page
  // of 20 narrowed further by the search box. They used to be a `rows.reduce`, so a creditor with 21
  // counterparties read a headline that silently omitted the 21st and turning to page 2 changed the
  // "total". §Frontend Requirements 1 says *Summarize ALL Balance*, and
  // the-summary-is-tiles-on-the-list fixes them here rather than on a screen of their own — so they
  // sit on a PAGINATED list and can never compute their own scope.
  const summary = query.data?.summary;
  const totalPayable = summary?.totalPayable ?? 0n;
  const totalReceivable = summary?.totalReceivable ?? 0n;
  const oldestAt = summary?.oldestUnsettledAtUnix ?? 0n;
  const oldestName = summary?.oldestCounterpartyId
    ? teamMap[summary.oldestCounterpartyId.toString()]?.name
    : undefined;

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("liability.title")}</Heading>
        <Text color="fg.muted">{t("liability.selectTeamView")}</Text>
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
          <Stat.ValueText
            color={oldestAt > 0n ? ageColor(daysSince(oldestAt)) : undefined}
            data-testid="liability-oldest"
          >
            {oldestAt > 0n ? t("liability.days", { count: daysSince(oldestAt) }) : "—"}
          </Stat.ValueText>
          {oldestName && <Stat.HelpText>{oldestName}</Stat.HelpText>}
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
        {/* THE DEFAULT ROW'S ONLY HOME (the-default-terms-row-is-a-dialog-on-the-list).

            ⚠ A DIALOG, NOT A ROUTE. `counterparty_id = 0` is terms for every team without their own —
            the rule the rows below are exceptions to — and it is NOT A PAIR, so a pair page at
            `/liability/:counterpartyId` can never show it. A synthetic `/liability/0` was refused:
            it would put a page in the pair namespace for something that is not a pair, and every
            row, breadcrumb and back-link would have to special-case it.

            ⚠ IT IS NOT A ROW EITHER, which is why it sits in the toolbar. The rows are
            counterparties; the default is a rule about the ones with nothing set. */}
        <Button
          variant="outline"
          data-testid="liability-default-terms"
          onClick={() => setDefaultTermsOpen(true)}
        >
          {t("liability.defaultTerms")}
        </Button>
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

                // THE 80% WARNING (§About Thresholds 1), worded from the CREDITOR's side — they are
                // watching debtors approach limits THEY set.
                //
                // ⚠ ONLY FOR A REAL CEILING. A percentage of unlimited is not a number and a
                // percentage of zero is a division by zero, so `limitStateOf` decides rather than a
                // truthy check — the same three-state rule CreditMeter is built around.
                //
                // ⚠ THE DEBT IS THE **POSITIVE** SIDE, and getting this backwards inverts the whole
                // screen. `balance` is signed from THIS team's view — POSITIVE means THEY OWE US —
                // and the limit a creditor sets governs what a debtor may owe THEM. Reading the
                // negative side would badge the teams this one owes money to, who have no limit here
                // at all. Same convention as the pair detail's CreditMeter, deliberately.
                const limit = limitOf(p.counterpartyId);
                const debt = p.balance > 0n ? p.balance : 0n;
                const nearLimit =
                  limitStateOf(limit) === "capped" && limit !== undefined && limit > 0n
                    ? Number(debt) / Number(limit)
                    : 0;
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
                      <Flex align="center" gap="1" wrap="wrap">
                        {p.awaitingConfirmation > 0 && (
                          <Badge colorPalette="purple">
                            {t("liability.toConfirm", { count: p.awaitingConfirmation })}
                          </Badge>
                        )}
                        {nearLimit >= WARN_AT && (
                          <Badge
                            colorPalette={nearLimit >= 1 ? "red" : "orange"}
                            data-testid={`liability-near-limit-${p.counterpartyId}`}
                          >
                            {t("liability.nearLimit", { percent: Math.round(nearLimit * 100) })}
                          </Badge>
                        )}
                      </Flex>
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

      {/* THE DEFAULT ROW — `counterparty_id = 0`, terms for every team without their own.

          ⚠ NO `options` AND NO `editing` COUNTERPARTY: the counterparty is FIXED at 0, so the dialog
          shows no picker. `editing` carries the existing default when there is one, which is what
          makes this create-or-update rather than two flows. */}
      {teamId !== undefined && (
        <TermsEditDialog
          open={defaultTermsOpen}
          onOpenChange={setDefaultTermsOpen}
          teamId={teamId}
          editing={defaultTerms}
          fixedCounterpartyId={0n}
          options={[]}
          overrideWriter={overrideWriter}
        />
      )}
    </Stack>
  );
}

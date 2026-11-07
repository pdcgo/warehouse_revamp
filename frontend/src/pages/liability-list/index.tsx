import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Box,
  Checkbox,
  Field,
  Flex,
  Heading,
  HStack,
  Icon,
  Spacer,
  Span,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ChevronRight, Handshake, ScrollText, SlidersHorizontal } from "lucide-react";

import { rpcError, teamClient } from "../../api/clients";
import { teamByIdsRowData, teamsByIds } from "../../features/teams/adapt";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useLiabilityPositions, useLiabilityTerms } from "../../features/liability/queries";
import { directionCopy, daysSince } from "../../features/liability/direction";
import { creditWarning, limitStateOf } from "../../features/liability/CreditMeter";
import { TermsEditDialog } from "../../features/liability/TermsEditDialog";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { canSetLiabilityTerms } from "../../lib/roles";
import { Button } from "@chakra-ui/react";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { formatRupiah, rupiahNumber } from "../../lib/money";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { CompactActions } from "../../components/chrome/CompactActions";
import { RadioPills } from "../../components/inputs/RadioPills";
import { ChoiceFilter } from "../../components/pickers/ChoiceFilter";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { useIsMobile } from "../../layouts/shell";
import type { LiabilityPosition } from "../../gen/warehouse/liability/v1/liability_pb";
import { boolCodec, oneOfCodec, textCodec, useUrlState } from "../../lib/urlState";

const PAGE_SIZE = 20;

// The team-type filter's values, as its select writes them.
const KIND_CODEC = oneOfCodec(["all", TeamType.WAREHOUSE.toString(), TeamType.SELLING.toString()]);

// How the age of the oldest unsettled entry reads — the actionable signal (#221). The colour escalates
// with age; a manager chases the reddening rows first.
function ageColor(days: number): string {
  if (days >= 30) return "error.fg";
  if (days >= 14) return "warning.fg";
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
//
// A PHONE GETS ITS OWN ARRANGEMENT (the-team-balance-phone-layout-is-accepted) — a JS breakpoint, never CSS hiding: each
// pair a block, the search in the row and the other filters in a bottom sheet, Default Terms a header icon.
export function LiabilityListPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const phone = useIsMobile();

  const teamId = current?.teamId;

  // THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh, or Back from a pair, opens the same list.
  const [unsettledOnly, setUnsettledOnly] = useUrlState("unsettled", true, boolCodec);
  const [awaitingOnly, setAwaitingOnly] = useUrlState("awaiting", false, boolCodec);
  const [search, setSearch] = useUrlState("q", "", textCodec);
  const [kind, setKind] = useUrlState<string>("kind", "all", KIND_CODEC);
  const [page, setPage] = useState(1);
  const [defaultTermsOpen, setDefaultTermsOpen] = useState(false);

  // The desktop's team-type filter offers the two kinds; nothing picked is "all" (its placeholder), and its × clears back.
  const kindOptions = useMemo(
    () => [
      { value: TeamType.WAREHOUSE.toString(), label: t("liability.kindWarehouse") },
      { value: TeamType.SELLING.toString(), label: t("liability.kindSelling") },
    ],
    [t],
  );

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
    const byCounterparty = new Map<string, number | undefined>();
    let fallback: number | undefined;

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
    return (counterpartyId: bigint): number | undefined =>
      byCounterparty.has(counterpartyId.toString())
        ? byCounterparty.get(counterpartyId.toString())
        : fallback;
  }, [termsQuery.data]);

  const defaultTerms = (termsQuery.data?.terms ?? []).find((row) => row.counterpartyId === 0n);

  // ROOT and ADMIN write somebody else's terms, which is what makes a reason REQUIRED
  // (a-limit-change-is-recorded). The server decides for real; this only shapes the form.
  const overrideWriter = current?.role === Role.ROOT || current?.role === Role.ADMINISTRATOR;

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

  // The phone sheet's count: what narrows the list beyond its default — "unsettled only" is the default, so it counts
  // when it is OFF.
  const phoneFilters = [search !== "", kind !== "all", awaitingOnly, !unsettledOnly].filter(Boolean).length;

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("liability.title")}</Heading>
        <Text color="fg.muted">{t("liability.selectTeamView")}</Text>
      </Stack>
    );
  }

  const mayDefaultTerms = canWrite(current) && canSetLiabilityTerms(current.role);

  return (
    // The page arrives — a fade and a short rise (`motion-is-small-quick-and-shared`).
    <Stack gap="section" animationStyle="enter" data-testid="liability-list-page" data-layout={phone ? "phone" : undefined}>
      <Flex align="center" gap="card" wrap={phone ? "nowrap" : "wrap"}>
        <Heading size="md">{t("liability.title")}</Heading>
        <Badge colorPalette="brand" {...(phone ? { minW: "0", truncate: true } : {})}>
          {current.teamName}
        </Badge>
        {awaitingTotal > 0 && !phone && (
          <Badge colorPalette="purple" data-testid="liability-awaiting-nav">
            {t("liability.awaitingNav", { count: awaitingTotal })}
          </Badge>
        )}
        {/* A phone's header action is its icon (a-phone-header-action-is-an-icon) — Default Terms moves here from the
            filter row, which on a phone is the search and the Filter button only. */}
        {phone && (
          <>
            <Spacer />
            <CompactActions
              menuLabel={t("common.actions")}
              actions={[
                mayDefaultTerms && {
                  id: "default-terms",
                  label: t("liability.defaultTerms"),
                  icon: ScrollText,
                  testId: "liability-default-terms",
                  onClick: () => setDefaultTermsOpen(true),
                },
              ]}
            />
          </>
        )}
      </Flex>

      {/* THE SUMMARY, AS THE ORDER LIST'S CARDS (a-list-summary-is-the-order-lists-card-strip) — still the four tiles
          the-summary-is-tiles-on-the-list put here, each a label, one figure and one quiet line. They were `Stat`s. */}
      <SummaryStrip testId="liability-summary">
        <SummaryCard
          label={t("liability.totalPayable")}
          value={
            <Span color="warning.fg" data-testid="liability-total-payable">
              {formatRupiah(totalPayable)}
            </Span>
          }
          testId="liability-total-payable-card"
        />
        <SummaryCard
          label={t("liability.totalReceivable")}
          value={
            <Span color="success.fg" data-testid="liability-total-receivable">
              {formatRupiah(totalReceivable)}
            </Span>
          }
          testId="liability-total-receivable-card"
        />
        <SummaryCard
          label={t("liability.awaitingTile")}
          value={
            <Span color={awaitingTotal > 0 ? "purple.fg" : undefined} data-testid="liability-awaiting-total">
              {awaitingTotal.toString()}
            </Span>
          }
          testId="liability-awaiting-card"
        />
        <SummaryCard
          label={t("liability.oldestTile")}
          value={
            <Span color={oldestAt > 0n ? ageColor(daysSince(oldestAt)) : undefined} data-testid="liability-oldest">
              {oldestAt > 0n ? t("liability.days", { count: daysSince(oldestAt) }) : "—"}
            </Span>
          }
          line={oldestName}
          testId="liability-oldest-card"
        />
      </SummaryStrip>

      {phone ? (
        // THE PHONE'S FILTER ROW (a-phone-filters-from-a-sheet): the search stays in the row, the team type and the two
        // narrowing ticks open from the counted Filter button in a bottom sheet.
        <FilterBar
          active={phoneFilters > 0}
          count={phoneFilters}
          onClear={() => {
            setSearch("");
            setKind("all");
            setAwaitingOnly(false);
            setUnsettledOnly(true);
            setPage(1);
          }}
          testId="liability-filters"
        >
          <FilterSearch
            value={search}
            onChange={setSearch}
            placeholder={t("liability.searchPlaceholder")}
            testId="liability-search"
          />
          <FilterField testId="liability-kind-field">
            <Field.Root>
              <Field.Label>{t("liability.kindLabel")}</Field.Label>
              <RadioPills
                value={kind}
                onChange={setKind}
                ariaLabel={t("liability.kindLabel")}
                testId="liability-kind"
                options={[
                  { value: "all", label: t("liability.kindAll"), testId: "liability-kind-all" },
                  { value: TeamType.WAREHOUSE.toString(), label: t("liability.kindWarehouse"), testId: "liability-kind-warehouse" },
                  { value: TeamType.SELLING.toString(), label: t("liability.kindSelling"), testId: "liability-kind-selling" },
                ]}
              />
            </Field.Root>
          </FilterField>
          <FilterField>
            <Checkbox.Root
              checked={awaitingOnly}
              onCheckedChange={(e) => setAwaitingOnly(!!e.checked)}
              data-testid="liability-awaiting-only"
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>{t("liability.awaitingOnly")}</Checkbox.Label>
            </Checkbox.Root>
          </FilterField>
          <FilterField>
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
          </FilterField>
        </FilterBar>
      ) : (
      <Flex gap="card" wrap="wrap" align="center">
        {/* The shared search — its icon, and an × once typed in (every-filter-clears-from-its-own-x). */}
        <FilterSearch
          value={search}
          onChange={setSearch}
          placeholder={t("liability.searchPlaceholder")}
          testId="liability-search"
        />
        {/* THE TEAM TYPE — Chakra's Select, never a NativeSelect (chakra-first-whenever-it-has-the-component): a pick
            carries its × back to all teams (every-filter-clears-from-its-own-x). */}
        <Box w="48" flexShrink="0">
          <ChoiceFilter
            value={kind === "all" ? undefined : kind}
            onChange={(next) => setKind(next ?? "all")}
            options={kindOptions}
            placeholder={t("liability.kindAll")}
            testId="liability-kind"
          />
        </Box>
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
        {mayDefaultTerms && (
          <Button
            variant="outline"
            data-testid="liability-default-terms"
            onClick={() => setDefaultTermsOpen(true)}
          >
            <Icon as={SlidersHorizontal} boxSize="4" />
            {t("liability.defaultTerms")}
          </Button>
        )}
      </Flex>
      )}

      {query.isPending ? (
        <ListSkeleton testId="liability-loading" />
      ) : query.isError ? (
        <Text color="error.fg" data-testid="liability-error">
          {rpcError(query.error)}
        </Text>
      ) : (
        // The rows fade in where the skeleton was, once (motion-is-small-quick-and-shared).
        <Stack gap="card" animationStyle="swap">
          {phone ? (
            // ONE BLOCK PER PAIR (a-phone-reads-each-line-as-a-block). The block opens the pair, so it lights up under a
            // finger (a-table-row-lights-up).
            <Stack gap="0" data-testid="liability-table" data-layout="blocks">
              {rows.map((p) => (
                <PairBlock
                  key={p.counterpartyId.toString()}
                  position={p}
                  name={teamMap[p.counterpartyId.toString()]?.name ?? t("liability.teamFallback", { id: p.counterpartyId.toString() })}
                  kind={teamMap[p.counterpartyId.toString()] ? t(teamKindKey(teamMap[p.counterpartyId.toString()]!.type)) : undefined}
                  limit={limitOf(p.counterpartyId)}
                  onOpen={() => navigate(`/liability/${p.counterpartyId}`)}
                />
              ))}
            </Stack>
          ) : (
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
                //
                // ⚠ THE ARITHMETIC IS CreditMeter's (`creditWarning`), never re-typed here — one threshold, so the row
                // and the pair's meter cannot warn at different points.
                //
                // ⚠ A FROZEN PAIR IS MARKED TOO. A limit of 0 is no credit at all — it refuses the next order whatever
                // the balance (the-threshold-defaults-to-unlimited) — so it is the most blocked row on the list, and a
                // percentage of it is the only thing that cannot be shown.
                const limit = limitOf(p.counterpartyId);
                const debt = p.balance > 0 ? p.balance : 0;
                const limitState = limitStateOf(limit);
                const { near, over } = creditWarning(limit, debt);
                // The meter's own rounding, so the row and the pair page print the same figure.
                const percent =
                  limitState === "capped"
                    ? (Math.floor((rupiahNumber(debt) * 10000) / rupiahNumber(limit!)) / 100).toFixed(0)
                    : "0";
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
                    <Table.Cell textAlign="end" color="warning.fg">
                      {p.balance < 0n ? formatRupiah(-p.balance) : "—"}
                    </Table.Cell>
                    <Table.Cell textAlign="end" color="success.fg">
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
                        {/* THE OPEN PAYMENT REQUEST (a-creditor-may-request-payment): the counterparty asking this team
                            to pay, or this team having asked it. A notice — it moves nothing. */}
                        {p.paymentRequest && (
                          <Badge
                            colorPalette={p.paymentRequest.debtorTeamId === p.counterpartyId ? "info" : "warning"}
                            data-testid={`liability-request-${p.counterpartyId}`}
                          >
                            {p.paymentRequest.debtorTeamId === p.counterpartyId
                              ? t("liability.requestSent")
                              : t("liability.requestAsked")}
                          </Badge>
                        )}
                        {near && (
                          <Badge
                            colorPalette={over ? "error" : "warning"}
                            data-testid={`liability-near-limit-${p.counterpartyId}`}
                          >
                            {t(over ? "liability.overLimit" : "liability.nearLimit", { percent })}
                          </Badge>
                        )}
                        {limitState === "frozen" && (
                          <Badge colorPalette="error" data-testid={`liability-frozen-${p.counterpartyId}`}>
                            {t("liability.frozenLimit")}
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
          )}

          {rows.length === 0 && (
            <EmptyHint
              icon={Handshake}
              title={t("liability.empty")}
              description={t("liability.emptyHint")}
              testId="liability-empty"
            />
          )}

          {/* THE PAGES GROW AS THEY ARE OPENED, and the pager is always on screen (every-list-pages-with-the-growing-pager,
              the-pager-is-always-on-screen). A new "unsettled only" — the one filter the server applies — starts over. */}
          <GrowingPager
            page={page}
            onPageChange={setPage}
            hasNext={query.isPlaceholderData ? undefined : page * PAGE_SIZE < total}
            resetKey={String(unsettledOnly)}
            pageSize={PAGE_SIZE}
            testId="liability-pager"
          />
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

// ONE PAIR ON A PHONE, AS A BLOCK. The name and what is owed on the first line, the team's kind and
// the age of the oldest unsettled entry on the second, the badges under them. The figure keeps the desktop's two
// directions as words — Payable or Receivable under it — never a sign.
function PairBlock({
  position: p,
  name,
  kind,
  limit,
  onOpen,
}: {
  position: LiabilityPosition;
  name: string;
  kind: string | undefined;
  limit: number | undefined;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const days = p.oldestUnsettledAtUnix > 0n ? daysSince(p.oldestUnsettledAtUnix) : 0;
  const debt = p.balance > 0 ? p.balance : 0;
  const limitState = limitStateOf(limit);
  const { near, over } = creditWarning(limit, debt);
  const percent =
    limitState === "capped" ? (Math.floor((rupiahNumber(debt) * 10000) / rupiahNumber(limit!)) / 100).toFixed(0) : "0";
  const owing = p.balance < 0;
  const owed = p.balance > 0;
  const hasBadges = p.awaitingConfirmation > 0 || !!p.paymentRequest || near || limitState === "frozen";

  return (
    <Box
      role="button"
      tabIndex={0}
      py="2.5"
      px="1"
      borderBottomWidth="1px"
      borderColor="border.muted"
      cursor="pointer"
      _hover={{ bg: "bg.muted" }}
      _active={{ bg: "bg.muted" }}
      data-testid={`liability-row-${p.counterpartyId}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Flex justify="space-between" align="baseline" gap="3">
        <Text fontSize="sm" fontWeight="medium" minW="0" truncate>
          {name}
        </Text>
        <Text
          fontSize="sm"
          fontWeight="bold"
          whiteSpace="nowrap"
          color={owing ? "warning.fg" : owed ? "success.fg" : "fg.subtle"}
        >
          {owing ? formatRupiah(-p.balance) : owed ? formatRupiah(p.balance) : "—"}
        </Text>
      </Flex>
      <Flex justify="space-between" align="center" gap="3" mt="0.5">
        <HStack gap="1.5" minW="0" fontSize="xs" color="fg.subtle">
          {kind && <Text truncate>{kind}</Text>}
          {kind && <Text>·</Text>}
          {p.oldestUnsettledAtUnix > 0n ? (
            <Text color={ageColor(days)} whiteSpace="nowrap" data-testid={`liability-age-${p.counterpartyId}`}>
              {t("liability.days", { count: days })}
            </Text>
          ) : (
            <Text whiteSpace="nowrap">{t(directionCopy(0n).key)}</Text>
          )}
        </HStack>
        <HStack gap="1" fontSize="xs" color="fg.muted" flexShrink="0">
          {(owing || owed) && <Text>{owing ? t("liability.colPayable") : t("liability.colReceivable")}</Text>}
          <Icon as={ChevronRight} boxSize="4" color="fg.subtle" />
        </HStack>
      </Flex>
      {hasBadges && (
        <Flex align="center" gap="1" wrap="wrap" mt="1.5">
          {p.awaitingConfirmation > 0 && (
            <Badge colorPalette="purple">{t("liability.toConfirm", { count: p.awaitingConfirmation })}</Badge>
          )}
          {p.paymentRequest && (
            <Badge
              colorPalette={p.paymentRequest.debtorTeamId === p.counterpartyId ? "info" : "warning"}
              data-testid={`liability-request-${p.counterpartyId}`}
            >
              {p.paymentRequest.debtorTeamId === p.counterpartyId ? t("liability.requestSent") : t("liability.requestAsked")}
            </Badge>
          )}
          {near && (
            <Badge colorPalette={over ? "error" : "warning"} data-testid={`liability-near-limit-${p.counterpartyId}`}>
              {t(over ? "liability.overLimit" : "liability.nearLimit", { percent })}
            </Badge>
          )}
          {limitState === "frozen" && (
            <Badge colorPalette="error" data-testid={`liability-frozen-${p.counterpartyId}`}>
              {t("liability.frozenLimit")}
            </Badge>
          )}
        </Flex>
      )}
    </Box>
  );
}

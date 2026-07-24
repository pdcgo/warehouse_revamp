import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { Badge } from "../../components/ui/Badge";
import { Checkbox } from "../../components/ui/Checkbox";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { StatTile } from "../../components/ui/StatTile";
import { Table } from "../../components/ui/Table";
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
  if (days >= 30) return "text-neg";
  if (days >= 14) return "text-warn";
  return "text-fg-subtle";
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
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("liability.title")}</h1>
        <p className="text-fg-muted">{t("settlement.selectTeamView")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section" data-testid="liability-list-page">
      <div className="flex flex-wrap items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("liability.title")}</h1>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        {awaitingTotal > 0 && (
          <Badge colorPalette="purple" data-testid="liability-awaiting-nav">
            {t("liability.awaitingNav", { count: awaitingTotal })}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-card md:grid-cols-4">
        <StatTile
          label={t("liability.totalPayable")}
          value={<span data-testid="liability-total-payable">{formatRupiah(totalPayable)}</span>}
          valueClassName="text-warn"
        />
        <StatTile
          label={t("liability.totalReceivable")}
          value={formatRupiah(totalReceivable)}
          valueClassName="text-pos"
        />
        <StatTile
          label={t("liability.awaitingTile")}
          value={awaitingTotal.toString()}
          valueClassName={awaitingTotal > 0 ? "text-accent-fg" : undefined}
        />
        <StatTile
          label={t("liability.oldestTile")}
          value={oldest ? t("liability.days", { count: daysSince(oldest.oldestUnsettledAtUnix) }) : "—"}
          valueClassName={oldest ? ageColor(daysSince(oldest.oldestUnsettledAtUnix)) : undefined}
          sub={
            oldest && teamMap[oldest.counterpartyId.toString()]
              ? teamMap[oldest.counterpartyId.toString()]?.name
              : undefined
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-card">
        <div className="w-full sm:w-60">
          <Input
            placeholder={t("liability.searchPlaceholder")}
            value={search}
            data-testid="liability-search"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <Select value={kind} data-testid="liability-kind" onChange={(e) => setKind(e.target.value)}>
            <option value="all">{t("liability.kindAll")}</option>
            <option value={TeamType.WAREHOUSE.toString()}>{t("liability.kindWarehouse")}</option>
            <option value={TeamType.SELLING.toString()}>{t("liability.kindSelling")}</option>
          </Select>
        </div>
        <Checkbox
          checked={awaitingOnly}
          onCheckedChange={(checked) => setAwaitingOnly(checked)}
          data-testid="liability-awaiting-only"
        >
          {t("liability.awaitingOnly")}
        </Checkbox>
        <Checkbox
          checked={unsettledOnly}
          onCheckedChange={(checked) => {
            setUnsettledOnly(checked);
            setPage(1);
          }}
          data-testid="liability-unsettled-only"
        >
          {t("liability.unsettledOnly")}
        </Checkbox>
        <div className="flex-1" />
      </div>

      {query.isPending ? (
        <Spinner />
      ) : query.isError ? (
        <p className="text-red-600 dark:text-red-400" data-testid="liability-error">
          {rpcError(query.error)}
        </p>
      ) : (
        <div className="flex flex-col gap-card">
          <Table.Root data-testid="liability-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("liability.colCounterparty")}</Table.ColumnHeader>
                <Table.ColumnHeader className="text-right">{t("liability.colPayable")}</Table.ColumnHeader>
                <Table.ColumnHeader className="text-right">{t("liability.colReceivable")}</Table.ColumnHeader>
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
                    className="cursor-pointer hover:bg-surface-2"
                    data-testid={`liability-row-${p.counterpartyId}`}
                    onClick={() => navigate(`/liability/${p.counterpartyId}`)}
                  >
                    <Table.Cell>
                      <div className="font-medium">
                        {team?.name ?? t("liability.teamFallback", { id: p.counterpartyId.toString() })}
                      </div>
                      {team && <div className="text-xs text-fg-subtle">{t(teamKindKey(team.type))}</div>}
                    </Table.Cell>
                    {/* Direction is TWO columns, never a sign (#185). */}
                    <Table.Cell className="text-right">
                      {p.balance < 0n ? (
                        <span className="font-medium text-warn">{formatRupiah(-p.balance)}</span>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      {p.balance > 0n ? (
                        <span className="font-medium text-pos">{formatRupiah(p.balance)}</span>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {p.oldestUnsettledAtUnix > 0n ? (
                        <span className={ageC} data-testid={`liability-age-${p.counterpartyId}`}>
                          {t("liability.days", { count: days })}
                        </span>
                      ) : (
                        <span className="text-fg-subtle">{t(directionCopy(0n).key)}</span>
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
                      <ChevronRight className="size-4 text-fg-subtle" />
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>

          {rows.length === 0 ? (
            <p className="text-fg-muted" data-testid="liability-empty">
              {t("liability.empty")}
            </p>
          ) : (
            <Pagination page={page} pageSize={PAGE_SIZE} count={total} onPageChange={setPage} />
          )}
        </div>
      )}
    </div>
  );
}

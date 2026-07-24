import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { Badge, type BadgePalette } from "../../components/ui/Badge";
import { Card, CardBody } from "../../components/ui/Card";
import { IconButton } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
import { rpcError, teamClient } from "../../api/clients";
import { Pagination } from "../../components/Pagination";
import { SettlementSourceType } from "../../gen/warehouse/settlement/v1/settlement_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { directionCopy, directionPalette } from "../../features/settlement/direction";
import { useSettlementEntries } from "../../features/settlement/queries";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

// WHAT CAUSED an entry, in words. The typed `(source_type, source_id)` pair is what makes this
// possible at all — a line reads "COD fee · restock #412" rather than whatever somebody typed into a
// note field, and it is filterable and countable besides.
function sourceKey(type: SettlementSourceType): string {
  switch (type) {
    case SettlementSourceType.COD_FEE:
      return "settlement.sourceCodFee";
    case SettlementSourceType.HANDLING_FEE:
      return "settlement.sourceHandlingFee";
    case SettlementSourceType.PRODUCT_FEE:
      return "settlement.sourceProductFee";
    case SettlementSourceType.PAYMENT:
      return "settlement.sourcePayment";
    default:
      // An entry carrying a source this build does not know renders as "unknown" rather than
      // breaking the page. A history that refuses to load because of one row is worse than one row
      // that reads oddly.
      return "settlement.sourceUnknown";
  }
}

// CounterpartyPage is the running history with one counterparty (#185) — A PAGE, NOT A DIALOG
// (CLAUDE.md), reached by clicking a row on the position list.
//
// Every entry, what caused it, and the balance after it. An order's fee and its cancellation
// reversal appear as ONE STORY: both visible, netting to zero. That is the whole payoff of
// compensating entries over deletes — "the fee briefly existed" is what an audit needs to see.
export function CounterpartyPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const params = useParams();

  const teamId = current?.teamId;
  const counterpartyId = BigInt(params.counterpartyId ?? "0");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [name, setName] = useState("");

  const query = useSettlementEntries({ teamId, counterpartyId, page, pageSize });

  const entries = query.data?.entries ?? [];
  const balance = query.data?.balance ?? 0n;
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  useEffect(() => {
    if (counterpartyId === 0n) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await teamClient.teamByIds({ ids: [counterpartyId] });

        if (!cancelled) {
          setName(res.data[counterpartyId.toString()]?.name ?? "");
        }
      } catch {
        // The header falls back to the id.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [counterpartyId]);

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("settlement.title")}</h1>
        <p className="text-fg-muted">{t("settlement.selectTeamView")}</p>
      </div>
    );
  }

  const copy = directionCopy(balance);

  return (
    <div className="flex flex-col gap-section" data-testid="counterparty-page">
      <div className="flex items-center gap-card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("settlement.back")}
          data-testid="counterparty-back"
          onClick={() => navigate("/settlement")}
        >
          <ArrowLeft className="size-4" />
        </IconButton>
        <h1 className="text-[22px] font-bold">
          {name || t("orders.teamFallback", { id: counterpartyId.toString() })}
        </h1>
        <div className="flex-1" />
      </div>

      {/* The position, in words, at the top — the question somebody opened this page holding. */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-card">
            <span className="text-fg-muted">{t("settlement.position")}</span>
            <Badge colorPalette={directionPalette(balance) as BadgePalette} data-testid="counterparty-balance">
              {t(copy.key, { amount: copy.amount })}
            </Badge>
          </div>
        </CardBody>
      </Card>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="counterparty-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="counterparty-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("settlement.what")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("settlement.amount")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("settlement.balanceAfter")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("settlement.when")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {entries.map((e) => (
              <Table.Row key={e.id.toString()} data-testid={`entry-row-${e.id}`}>
                <Table.Cell>
                  <div className="flex items-center gap-2">
                    <span>
                      {t(sourceKey(e.sourceType))} · #{e.sourceId.toString()}
                    </span>
                    {/* A reversal is labelled rather than left to be inferred from a sign — the pair
                        of rows should read as "charged, then returned". */}
                    {e.reversal && (
                      <Badge colorPalette="gray" data-testid={`reversal-${e.id}`}>
                        {t("settlement.reversal")}
                      </Badge>
                    )}
                  </div>
                </Table.Cell>

                {/* The one place a sign is legitimate: an entry is a MOVEMENT, and "+" / "−" here
                    means "this made the balance go up / down", which is what a ledger line is. The
                    POSITION above is the thing that must never be a bare number. */}
                <Table.Cell className="text-right" data-testid={`entry-amount-${e.id}`}>
                  {e.amount > 0n ? "+" : "−"}
                  {formatRupiah(e.amount < 0n ? -e.amount : e.amount)}
                </Table.Cell>

                <Table.Cell className="text-right">{formatRupiah(e.balanceAfter)}</Table.Cell>

                <Table.Cell>
                  {new Date(Number(e.createdAtUnix) * 1000).toLocaleDateString()}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && entries.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="counterparty-empty">
          {t("settlement.noEntries")}
        </p>
      )}

      {!loading && (
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
      )}
    </div>
  );
}

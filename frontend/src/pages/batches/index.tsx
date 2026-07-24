import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../api/clients";
import { BatchDateField, BatchExpiryFilter } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useWarehouseBatches } from "../../features/inventory/queries";
import { Pagination } from "../../components/Pagination";
import { Badge } from "../../components/ui/Badge";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { StatTile } from "../../components/ui/StatTile";
import { Table } from "../../components/ui/Table";
import { formatRupiah } from "../../lib/money";

const PAGE_SIZE = 20;

function formatDateUnix(unix: bigint): string {
  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isExpiringSoon(unix: bigint): boolean {
  return Number(unix) * 1000 <= Date.now() + 30 * 24 * 60 * 60 * 1000;
}

// A yyyy-mm-dd date input → unix seconds. `to` takes the END of the day so a same-day batch is inside
// the range; an empty box is an open end (0).
function dateToUnix(s: string, endOfDay: boolean): bigint {
  if (!s) return 0n;
  const ms = new Date(`${s}T${endOfDay ? "23:59:59" : "00:00:00"}`).getTime();
  return Number.isNaN(ms) ? 0n : BigInt(Math.floor(ms / 1000));
}

// BatchesPage is the warehouse-wide list of every stock batch (#209) — a cost layer per delivery line,
// browsable by receipt/batch number and by expiry, so a manager can find what is running out.
export function BatchesPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  const [search, setSearch] = useState("");
  const [expiry, setExpiry] = useState<number>(BatchExpiryFilter.UNSPECIFIED);
  const [dateField, setDateField] = useState<number>(BatchDateField.ARRIVED);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const query = useWarehouseBatches({
    warehouseId,
    search,
    supplierId: 0n,
    expiry,
    // A range with no dates chosen applies to nothing, so send UNSPECIFIED unless a bound is set.
    dateField: fromDate || toDate ? dateField : BatchDateField.UNSPECIFIED,
    fromUnix: dateToUnix(fromDate, false),
    toUnix: dateToUnix(toDate, true),
    page,
    pageSize: PAGE_SIZE,
  });
  const res = query.data?.res;
  const ownerByProduct = query.data?.ownerByProduct;
  const batches = res?.batches ?? [];
  const total = Number(res?.pageInfo?.totalItems ?? 0n);

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("batches.title")}</h1>
        <p className="text-fg-muted">{t("batches.selectTeam")}</p>
      </div>
    );
  }

  if (!isWarehouse) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("batches.title")}</h1>
        <p className="text-fg-muted" data-testid="batches-not-warehouse">
          {t("batches.warehouseOnly")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section" data-testid="batches-page">
      <div className="flex flex-wrap items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("batches.title")}</h1>
        <Badge colorPalette="brand">{current.teamName}</Badge>
      </div>

      {/* The header numbers, over the whole filtered set. */}
      <div className="grid grid-cols-1 gap-card sm:grid-cols-3">
        <StatTile
          label={t("batches.statBatches")}
          value={<span data-testid="batches-stat-count">{total.toString()}</span>}
        />
        <StatTile label={t("batches.statReadyValue")} value={formatRupiah(res?.readyValueTotal ?? 0n)} />
        <StatTile
          label={t("batches.statExpiring")}
          value={(res?.expiringSoonCount ?? 0n).toString()}
          valueClassName={(res?.expiringSoonCount ?? 0n) > 0n ? "text-warn" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-card">
        <div className="w-full max-w-sm">
          <Input
            placeholder={t("batches.searchPlaceholder")}
            value={search}
            data-testid="batches-search"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-52">
          <Select
            value={expiry.toString()}
            data-testid="batches-expiry"
            onChange={(e) => {
              setExpiry(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={BatchExpiryFilter.UNSPECIFIED.toString()}>{t("batches.expiryAll")}</option>
            <option value={BatchExpiryFilter.EXPIRING_SOON.toString()}>{t("batches.expirySoon")}</option>
            <option value={BatchExpiryFilter.NO_EXPIRY.toString()}>{t("batches.expiryNone")}</option>
          </Select>
        </div>

        {/* Date range on the Arrived or Expiring date (#217) — find what came in, or expires, in a window. */}
        <div className="w-40">
          <Select
            value={dateField.toString()}
            data-testid="batches-date-field"
            onChange={(e) => {
              setDateField(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={BatchDateField.ARRIVED.toString()}>{t("batches.dateArrived")}</option>
            <option value={BatchDateField.EXPIRING.toString()}>{t("batches.dateExpiring")}</option>
          </Select>
        </div>
        <div className="w-40">
          <Input
            type="date"
            aria-label={t("batches.dateFrom")}
            value={fromDate}
            data-testid="batches-date-from"
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-40">
          <Input
            type="date"
            aria-label={t("batches.dateTo")}
            value={toDate}
            data-testid="batches-date-to"
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex-1" />
      </div>

      {query.isPending ? (
        <Spinner />
      ) : query.isError ? (
        <p className="text-neg" data-testid="batches-error">
          {rpcError(query.error)}
        </p>
      ) : (
        <div className="flex flex-col gap-card">
          <Table.Root data-testid="batches-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("batches.colBatch")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("batches.colProduct")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("batches.colTeam")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("batches.colArrived")}</Table.ColumnHeader>
                <Table.ColumnHeader className="text-right">{t("batches.colReady")}</Table.ColumnHeader>
                <Table.ColumnHeader className="text-right">{t("batches.colCost")}</Table.ColumnHeader>
                <Table.ColumnHeader className="text-right">{t("batches.colReadyValue")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("batches.colExpiring")}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {batches.map((b) => (
                <Table.Row
                  key={b.id.toString()}
                  className="cursor-pointer hover:bg-surface-2"
                  data-testid={`batches-row-${b.id}`}
                  onClick={() => navigate(`/inventories/batches/${b.id}`)}
                >
                  <Table.Cell>
                    <span className="font-medium">#{b.deliveryId.toString()}</span>
                    {b.receiptNo && <span className="ml-1 text-fg-subtle">{b.receiptNo}</span>}
                  </Table.Cell>
                  <Table.Cell>
                    {b.name}
                    <span className="ml-1 text-fg-subtle">{b.sku}</span>
                  </Table.Cell>
                  {/* The catalogue OWNER (#142) — a warehouse holds several teams' goods. Distinct from
                      the supplier who delivered them. */}
                  <Table.Cell>
                    {ownerByProduct?.get(b.productId.toString()) ? (
                      <Badge colorPalette="brand">{ownerByProduct.get(b.productId.toString())}</Badge>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </Table.Cell>
                  {/* Arrived = when the batch was minted, which is when the delivery was accepted. */}
                  <Table.Cell>{b.createdAtUnix > 0n ? formatDateUnix(b.createdAtUnix) : "—"}</Table.Cell>
                  <Table.Cell className="text-right">
                    {b.ready.toString()}
                    {b.ready === 0n && (
                      <Badge colorPalette="gray" className="ml-2">
                        {t("batches.depleted")}
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {b.costKnown ? formatRupiah(b.unitCost) : t("batches.costUnknown")}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {b.costKnown ? formatRupiah(b.readyValue) : t("batches.costUnknown")}
                  </Table.Cell>
                  <Table.Cell>
                    {b.expiresOnUnix > 0n ? (
                      <span className={isExpiringSoon(b.expiresOnUnix) ? "text-warn" : undefined}>
                        {formatDateUnix(b.expiresOnUnix)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>

          {batches.length === 0 ? (
            <p className="text-fg-muted" data-testid="batches-empty">
              {t("batches.empty")}
            </p>
          ) : (
            <Pagination page={page} pageSize={PAGE_SIZE} count={total} onPageChange={setPage} />
          )}
        </div>
      )}
    </div>
  );
}

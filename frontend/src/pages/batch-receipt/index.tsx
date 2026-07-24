import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Printer } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { useBatchReceipt } from "../../features/inventory/queries";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";

function parseId(raw: string | undefined | null): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function formatDateUnix(unix: bigint): string {
  if (unix <= 0n) return "—";
  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// BatchReceiptPage is the goods-received document for ONE delivery (#219) — the whole delivery, every
// product line (arrived / damaged / accepted / unit cost / line cost / rack). Reached from a batch's
// "Print receipt" (with that product highlighted) and from an Accepted restock. It is meant to be
// PRINTED: a print stylesheet drops the app shell so only the receipt lands on paper.
export function BatchReceiptPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { requestId } = useParams();
  const [params] = useSearchParams();

  const deliveryId = parseId(requestId);
  // When opened from a batch, that batch's line is highlighted.
  const highlightBatch = parseId(params.get("batch"));

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  // Print only the receipt: hide everything, then reveal the receipt card. Scoped to this page — the
  // <style> is added on mount and removed on unmount, so it never leaks into other screens.
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@media print {
      body * { visibility: hidden !important; }
      [data-print-receipt], [data-print-receipt] * { visibility: visible !important; }
      [data-print-receipt] { position: absolute; inset: 0; margin: 0; border: none !important; box-shadow: none !important; }
      [data-print-hide] { display: none !important; }
    }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const query = useBatchReceipt({ warehouseId, deliveryId });
  const data = query.data?.data ?? null;

  const actorName = (id: bigint): string => {
    if (id <= 0n) return "—";
    return query.data?.actorNames.get(id.toString()) ?? `#${id.toString()}`;
  };

  const rackLabel = (rackIds: bigint[]): string => {
    if (rackIds.length === 0) return "—";
    return rackIds
      .map((id) => (id === 0n ? t("racks.select.unplaced") : query.data?.rackCodes.get(id.toString()) ?? `#${id}`))
      .join(", ");
  };

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("batchReceipt.title")}</h1>
        <p className="text-fg-muted">{t("batches.selectTeam")}</p>
      </div>
    );
  }

  if (!isWarehouse) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("batchReceipt.title")}</h1>
        <p className="text-fg-muted" data-testid="batch-receipt-not-warehouse">
          {t("batches.warehouseOnly")}
        </p>
      </div>
    );
  }

  if (query.isPending) return <Spinner />;

  if (query.isError || !data) {
    return (
      <div className="flex flex-col gap-section">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
          {t("batchReceipt.back")}
        </Button>
        <p className="text-neg" data-testid="batch-receipt-error">
          {query.isError ? rpcError(query.error) : t("batchReceipt.notFound")}
        </p>
      </div>
    );
  }

  const cost = (known: boolean, v: bigint) => (known ? formatRupiah(v) : t("batchReceipt.costUnknown"));

  return (
    <div className="flex flex-col gap-section" data-testid="batch-receipt-page">
      {/* Chrome — dropped from the printed page. */}
      <div className="flex flex-wrap items-center gap-card" data-print-hide>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} data-testid="batch-receipt-back">
          <ArrowLeft className="size-4" />
          {t("batchReceipt.back")}
        </Button>
        <div className="flex-1" />
        <Button colorPalette="brand" size="sm" onClick={() => window.print()} data-testid="batch-receipt-print">
          <Printer className="size-4" />
          {t("batchReceipt.print")}
        </Button>
      </div>

      {/* The document. */}
      <div
        data-print-receipt
        data-testid="batch-receipt-doc"
        className="w-full max-w-4xl rounded-card border border-line bg-surface p-section shadow-card md:p-8"
      >
        {/* Header — the warehouse that received it, and the document number. */}
        <div className="mb-section flex flex-wrap items-start justify-between gap-card border-b-2 border-fg-muted pb-card">
          <div className="flex flex-col">
            <h1 className="text-[22px] font-bold">
              {query.data?.warehouseName || t("batchReceipt.warehouseFallback")}
            </h1>
            <p className="text-sm text-fg-muted">{t("batchReceipt.subtitle")}</p>
          </div>
          <div className="flex flex-col text-left sm:text-right">
            <p className="text-lg font-bold">{data.receiptNo || t("batchReceipt.noReceiptNo")}</p>
            <p className="text-sm text-fg-subtle">
              {t("batchReceipt.deliveryNo", { id: data.deliveryId.toString() })}
            </p>
          </div>
        </div>

        {/* Meta — supplier, destination, dates and the two actors. */}
        <div className="mb-section grid grid-cols-2 gap-card md:grid-cols-3">
          <Meta label={t("batchReceipt.supplier")}>
            {data.supplierId > 0n ? t("batchReceipt.supplierRef", { id: data.supplierId.toString() }) : "—"}
          </Meta>
          <Meta label={t("batchReceipt.warehouse")}>{query.data?.warehouseName || "—"}</Meta>
          <Meta label={t("batchReceipt.arrived")}>{formatDateUnix(data.arrivedAtUnix)}</Meta>
          <Meta label={t("batchReceipt.createdBy")}>{actorName(data.createdBy)}</Meta>
          <Meta label={t("batchReceipt.acceptedBy")}>{actorName(data.acceptedBy)}</Meta>
        </div>

        {/* Lines — one per product on the delivery. */}
        <Table.Root data-testid="batch-receipt-lines">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("batchReceipt.product")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("batchReceipt.colArrived")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("batchReceipt.colDamaged")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("batchReceipt.colAccepted")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("batchReceipt.colUnitCost")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("batchReceipt.colLineCost")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("batchReceipt.colRack")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.lines.map((l) => {
              const on = highlightBatch > 0n && l.batchId === highlightBatch;
              return (
                <Table.Row
                  key={l.batchId.toString()}
                  className={on ? "bg-accent-soft" : undefined}
                  data-testid={`batch-receipt-line-${l.batchId}`}
                >
                  <Table.Cell>
                    <span className={on ? "font-semibold" : "font-medium"}>{l.name}</span>
                    <span className="ml-1 text-fg-subtle">{l.sku}</span>
                    {on && (
                      <Badge colorPalette="brand" className="ml-2">
                        {t("batchReceipt.thisBatch")}
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">{l.arrived.toString()}</Table.Cell>
                  <Table.Cell className={`text-right ${l.damaged > 0n ? "text-neg" : ""}`}>
                    {l.damaged.toString()}
                  </Table.Cell>
                  <Table.Cell className="text-right">{l.accepted.toString()}</Table.Cell>
                  <Table.Cell className="text-right">{cost(l.costKnown, l.unitCost)}</Table.Cell>
                  <Table.Cell className="text-right">{cost(l.costKnown, l.lineCost)}</Table.Cell>
                  <Table.Cell>{rackLabel(l.rackIds)}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
          <Table.Footer>
            <Table.Row>
              <Table.Cell>{t("batchReceipt.total")}</Table.Cell>
              <Table.Cell />
              <Table.Cell />
              <Table.Cell className="text-right" data-testid="batch-receipt-total-accepted">
                {data.totalAccepted.toString()}
              </Table.Cell>
              <Table.Cell />
              <Table.Cell className="text-right" data-testid="batch-receipt-total-value">
                {formatRupiah(data.totalValue)}
              </Table.Cell>
              <Table.Cell />
            </Table.Row>
          </Table.Footer>
        </Table.Root>

        <p className="mt-card text-xs text-fg-subtle">{t("batchReceipt.note")}</p>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-subtle">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}

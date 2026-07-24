import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowLeftRight, Pencil, Printer } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { kindLabel } from "../../features/inventory/movementKind";
import { useBatchDetail, useBatchHistory } from "../../features/inventory/queries";
import { MoveStockDialog } from "../../features/inventory/MoveStockDialog";
import { AdjustStockDialog } from "../../features/inventory/AdjustStockDialog";
import { Pagination } from "../../components/Pagination";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { StatTile } from "../../components/ui/StatTile";
import { Table } from "../../components/ui/Table";
import { Tabs } from "../../components/ui/Tabs";

const HISTORY_PAGE_SIZE = 20;

function parseId(raw: string | undefined): bigint {
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

// A batch is flagged amber when it expires within 30 days — the "expiring soon" window the server uses.
function isExpiringSoon(unix: bigint): boolean {
  return Number(unix) * 1000 <= Date.now() + 30 * 24 * 60 * 60 * 1000;
}

// BatchDetailPage is one batch's living detail (#209) — drilled into from the Batches list or a
// delivery on the warehouse product's Batches tab. A batch = one product's units from one delivery,
// carrying a frozen cost (HPP), a lifecycle (Arrived = Damaged + Used + Ready), where its ready units
// sit now, and its own history.
export function BatchDetailPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { batchId: raw } = useParams();
  const batchId = parseId(raw);

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  const query = useBatchDetail({ warehouseId, batchId });
  const data = query.data;
  const batch = data?.batch ?? null;
  const product = data?.product ?? null;

  const [moving, setMoving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  // The History tab pages on its own (#218), independent of the detail aggregate above.
  const [historyPage, setHistoryPage] = useState(1);
  const historyQuery = useBatchHistory({
    warehouseId,
    productId: batch?.productId ?? 0n,
    batchId,
    page: historyPage,
    pageSize: HISTORY_PAGE_SIZE,
  });
  const historyMovements = historyQuery.data?.movements ?? [];
  const historyTotal = Number(historyQuery.data?.pageInfo?.totalItems ?? 0n);

  // The place a shelf sits: its painted code, the named unplaced pile (#135), or a bare id if the code
  // could not be resolved.
  const placeLabel = (rackId: bigint): string => {
    if (rackId === 0n) return t("racks.select.unplaced");
    return data?.rackCodes.get(rackId.toString()) ?? `#${rackId.toString()}`;
  };

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("batchDetail.title")}</h1>
        <p className="text-fg-muted">{t("batches.selectTeam")}</p>
      </div>
    );
  }

  if (!isWarehouse) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("batchDetail.title")}</h1>
        <p className="text-fg-muted" data-testid="batch-detail-not-warehouse">
          {t("batches.warehouseOnly")}
        </p>
      </div>
    );
  }

  if (query.isPending) {
    return <Spinner />;
  }

  if (query.isError) {
    return (
      <div className="flex flex-col gap-section">
        <BackButton onClick={() => navigate("/inventories/batches")} label={t("batchDetail.back")} />
        <p className="text-neg" data-testid="batch-detail-error">
          {rpcError(query.error)}
        </p>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex flex-col gap-section">
        <BackButton onClick={() => navigate("/inventories/batches")} label={t("batchDetail.back")} />
        <p className="text-fg-muted" data-testid="batch-detail-missing">
          {t("batchDetail.notFound")}
        </p>
      </div>
    );
  }

  const cost = (v: bigint) => (batch.costKnown ? formatRupiah(v) : t("batchDetail.costUnknown"));

  return (
    <div className="flex flex-col gap-section" data-testid="batch-detail-page">
      {/* Header — back, identity, and a link into the product where Move / Adjust live. */}
      <div className="flex flex-wrap items-center gap-card">
        <BackButton onClick={() => navigate("/inventories/batches")} label={t("batchDetail.back")} />
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-bold" data-testid="batch-detail-name">
              {t("batchDetail.batchNo", { id: batch.deliveryId.toString() })}
            </h1>
            {batch.expiresOnUnix > 0n && isExpiringSoon(batch.expiresOnUnix) && (
              <Badge colorPalette="orange" data-testid="batch-detail-expiring">
                {t("batchDetail.expiring", { date: formatDateUnix(batch.expiresOnUnix) })}
              </Badge>
            )}
          </div>
          <p className="text-sm text-fg-subtle">
            {batch.name}
            <span className="ml-2">{batch.sku}</span>
          </p>
        </div>
        <div className="flex-1" />
        {/* The actions act on THIS batch (#218): Move / Adjust reuse the stock dialogs, Print receipt
            opens the delivery's receipt with this product's line highlighted. */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="batch-detail-move"
            disabled={!product}
            onClick={() => setMoving(true)}
          >
            <ArrowLeftRight className="size-4" />
            {t("batchDetail.move")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="batch-detail-adjust"
            disabled={!product}
            onClick={() => setAdjusting(true)}
          >
            <Pencil className="size-4" />
            {t("batchDetail.adjust")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="batch-detail-receipt"
            onClick={() =>
              navigate(`/inventories/restock/${batch.deliveryId}/receipt?batch=${batch.id}`)
            }
          >
            <Printer className="size-4" />
            {t("batchDetail.printReceipt")}
          </Button>
        </div>
      </div>

      {warehouseId !== undefined && product && (
        <>
          <MoveStockDialog
            warehouseId={warehouseId}
            product={product}
            currentOnHand={batch.ready}
            open={moving}
            onOpenChange={setMoving}
          />
          <AdjustStockDialog
            warehouseId={warehouseId}
            product={product}
            currentOnHand={batch.ready}
            open={adjusting}
            onOpenChange={setAdjusting}
          />
        </>
      )}

      {/* IDENTITY — what this batch IS, and whose goods (#142). */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-2 gap-card md:grid-cols-3">
            <Meta label={t("batchDetail.product")}>
              {batch.name}
              <div className="text-xs text-fg-subtle">{batch.sku}</div>
            </Meta>
            <Meta label={t("batchDetail.owner")}>
              {data?.ownerName ? (
                <Badge colorPalette="brand">{data.ownerName}</Badge>
              ) : (
                <span className="text-fg-subtle">—</span>
              )}
            </Meta>
            <Meta label={t("batchDetail.delivery")}>
              <span
                className="cursor-pointer text-accent-fg underline"
                data-testid="batch-detail-delivery"
                onClick={() => navigate(`/inventories/restock/${batch.deliveryId}`)}
              >
                #{batch.deliveryId.toString()}
                {batch.receiptNo && ` · ${batch.receiptNo}`}
              </span>
            </Meta>
            <Meta label={t("batchDetail.unitCost")}>{cost(batch.unitCost)}</Meta>
            {/* The batch is minted AT acceptance, so its created_at IS the arrival date (accepted_at is
                never set on the model). */}
            <Meta label={t("batchDetail.arrived")}>{formatDateUnix(batch.createdAtUnix)}</Meta>
          </div>
        </CardBody>
      </Card>

      {/* LIFECYCLE — Arrived = Damaged + Used + Ready. */}
      <div className="grid grid-cols-2 gap-card md:grid-cols-4">
        <StatTile
          label={t("batchDetail.arrived")}
          value={<span data-testid="batch-detail-arrived">{batch.arrived.toString()}</span>}
        />
        <StatTile
          label={t("batchDetail.damaged")}
          value={batch.damaged.toString()}
          valueClassName={batch.damaged > 0n ? "text-neg" : undefined}
        />
        <StatTile label={t("batchDetail.used")} value={batch.used.toString()} />
        <StatTile
          label={t("batchDetail.ready")}
          value={<span data-testid="batch-detail-ready">{batch.ready.toString()}</span>}
          valueClassName={batch.ready > 0n ? "text-pos" : undefined}
          sub={cost(batch.readyValue)}
        />
      </div>

      {/* TABS — where it sits now, and its own ledger (#198). */}
      <Tabs.Root defaultValue="placements">
        <Tabs.List>
          <Tabs.Trigger value="placements" data-testid="batch-detail-tab-placements">
            {t("batchDetail.tabPlacements")}
          </Tabs.Trigger>
          <Tabs.Trigger value="history" data-testid="batch-detail-tab-history">
            {t("batchDetail.tabHistory")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* PLACEMENTS — the shelves that still hold some of this batch. */}
        <Tabs.Content value="placements">
          <div className="flex flex-col gap-card">
            <Table.Root data-testid="batch-detail-placements-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("batchDetail.place")}</Table.ColumnHeader>
                  <Table.ColumnHeader className="text-right">{t("batchDetail.readyHere")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(data?.shelves ?? []).map((s) => (
                  <Table.Row key={s.rackId.toString()}>
                    <Table.Cell>{placeLabel(s.rackId)}</Table.Cell>
                    <Table.Cell className="text-right">{s.qty.toString()}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
            {(data?.shelves ?? []).length === 0 && (
              <p className="text-fg-muted" data-testid="batch-detail-placements-empty">
                {t("batchDetail.noPlacements")}
              </p>
            )}
          </div>
        </Tabs.Content>

        {/* HISTORY — this batch's ledger. A batch-less recount (batch_id 0) does not appear here. */}
        <Tabs.Content value="history">
          <div className="flex flex-col gap-card">
            <Table.Root data-testid="batch-detail-history-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("batchDetail.when")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("batchDetail.what")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("batchDetail.place")}</Table.ColumnHeader>
                  <Table.ColumnHeader className="text-right">{t("batchDetail.change")}</Table.ColumnHeader>
                  <Table.ColumnHeader className="text-right">{t("batchDetail.after")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {historyMovements.map((m) => (
                  <Table.Row key={m.id.toString()}>
                    <Table.Cell>{m.createdAt}</Table.Cell>
                    <Table.Cell>{kindLabel(t, m.kind)}</Table.Cell>
                    <Table.Cell>{placeLabel(m.rackId)}</Table.Cell>
                    <Table.Cell className="text-right">
                      {m.delta > 0n ? `+${m.delta}` : m.delta.toString()}
                    </Table.Cell>
                    <Table.Cell className="text-right">{m.balance.toString()}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
            {historyMovements.length === 0 ? (
              <p className="text-fg-muted" data-testid="batch-detail-history-empty">
                {t("batchDetail.noHistory")}
              </p>
            ) : (
              <Pagination
                page={historyPage}
                pageSize={HISTORY_PAGE_SIZE}
                count={historyTotal}
                onPageChange={setHistoryPage}
              />
            )}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} data-testid="batch-detail-back">
      <ArrowLeft className="size-4" />
      {label}
    </Button>
  );
}

// One labelled figure in the identity grid.
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-subtle">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}

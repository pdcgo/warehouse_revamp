import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Check, Download, Info, Printer, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockLabel } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useRestockLabels } from "../../features/restock/queries";
import { formatRupiah } from "../../lib/money";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Checkbox } from "../../components/ui/Checkbox";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { cn } from "../../components/ui/cn";

// One printable job entry — a label to draw, plus which copy of how many it is (piece mode).
interface JobEntry {
  label: RestockLabel;
  copyIndex: number;
  copyTotal: number;
}

// The physical sticker sizes (#207). Screen shows a scaled preview; print emits these exact mm — see
// the print stylesheet below, keyed on the `sz-*` class.
const SIZES = ["30x15", "40x25", "50x30", "60x40"] as const;
type LabelSize = (typeof SIZES)[number];

// On a per-piece run of hundreds, the screen previews a sample and prints the whole job — the overflow
// is rendered but hidden on screen, and revealed by the print stylesheet.
const PREVIEW_CAP = 48;

function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function formatDate(unix: bigint): string {
  if (unix <= 0n) return "";

  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// RestockLabelsPage prints the stickers for an accepted delivery (#207) — the step after accept-rack:
// one label per shelved unit (or per shelf) so a picker can find and scan what just landed.
//
// It is warehouse-only, like accepting: the crew that shelved the goods prints them. The QR encodes
// `sku/batch-id` — the batch being the delivery line (#160) — while WHERE it went rides beside it as
// the rack chip, because a product+batch split across two shelves is one code in two places.
//
// Broken/lost units are absent by construction: the server returns a label per placement, and damaged
// units never produced one. The count of what was left out is shown so a short run reads as deliberate.
export function RestockLabelsPage() {
  const { current } = useTeam();
  const { requestId: rawId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const requestId = parseRequestId(rawId);

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const teamId = isWarehouse ? current?.teamId : undefined;

  const query = useRestockLabels({ teamId, requestId });
  const data = query.data ?? null;

  const [mode, setMode] = useState<"piece" | "shelf">("piece");
  const [size, setSize] = useState<LabelSize>("40x25");
  const [showRack, setShowRack] = useState(true);
  const [showRef, setShowRef] = useState(true);
  const [showHpp, setShowHpp] = useState(false);

  const labels = useMemo(() => data?.labels ?? [], [data]);

  // The full print job. Shelf mode is one label per placement; piece mode expands each placement into
  // one sticker per unit on it.
  const job = useMemo<JobEntry[]>(() => {
    if (mode === "shelf") {
      return labels.map((label) => ({ label, copyIndex: 1, copyTotal: 1 }));
    }

    const out: JobEntry[] = [];
    for (const label of labels) {
      const total = Number(label.quantity);
      for (let i = 1; i <= total; i++) {
        out.push({ label, copyIndex: i, copyTotal: total });
      }
    }
    return out;
  }, [labels, mode]);

  const productCount = useMemo(
    () => new Set(labels.map((l) => l.sku)).size,
    [labels],
  );

  const restockRef = data ? `#${data.restockId.toString()}` : "";
  const receivedOn = data ? formatDate(data.receivedAtUnix) : "";

  const back = (
    <Button
      size="xs"
      variant="ghost"
      className="self-start no-print"
      onClick={() => navigate(`/inventories/restock/${rawId ?? ""}`)}
      data-testid="labels-back"
    >
      <ArrowLeft className="size-4" />
      {t("restock.labels.back", { id: rawId ?? "" })}
    </Button>
  );

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("restock.labels.title")}</h1>
        <p className="text-fg-muted">{t("restock.selectTeam")}</p>
      </div>
    );
  }

  if (!isWarehouse) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("restock.labels.title")}</h1>
        <p className="text-fg-muted" data-testid="labels-not-warehouse">
          {t("restock.labels.warehouseOnly")}
        </p>
      </div>
    );
  }

  if (query.isPending && teamId !== undefined && requestId !== 0n) {
    return (
      <div className="flex flex-col gap-section">
        {back}
        <Spinner />
      </div>
    );
  }

  if (query.isError || !data) {
    return (
      <div className="flex flex-col gap-section">
        {back}
        <p className="text-red-600 dark:text-red-400" data-testid="labels-error">
          {query.isError ? rpcError(query.error) : t("restock.labels.notFound")}
        </p>
      </div>
    );
  }

  const preview = job.slice(0, PREVIEW_CAP);
  const overflow = job.slice(PREVIEW_CAP);

  return (
    <div className="flex flex-col gap-section">
      <PrintStyles />

      {back}

      {/* The action header — count of what will print, and Print / Download (both the browser's own
          print dialog, which is where a PDF is saved too). */}
      <div className="flex flex-wrap items-center gap-card no-print">
        <h1 className="text-[22px] font-bold">{t("restock.labels.heading", { id: data.restockId.toString() })}</h1>
        <Badge colorPalette="green">
          <Check className="size-3.5" />
          {t("restock.labels.accepted")}
        </Badge>
        <div className="flex-1" />
        <div className="mr-2 flex flex-col text-right">
          <p className="text-sm">
            <span className="font-semibold">{job.length}</span> {t("restock.labels.count", { products: productCount })}
          </p>
          <p className="text-xs text-fg-muted">
            {mode === "piece" ? t("restock.labels.perPiece") : t("restock.labels.perShelf")}
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()} data-testid="labels-download">
          <Download className="size-4" />
          {t("restock.labels.downloadPdf")}
        </Button>
        <Button colorPalette="brand" onClick={() => window.print()} data-testid="labels-print">
          <Printer className="size-4" />
          {t("restock.labels.print")}
        </Button>
      </div>

      {/* Controls: how many labels, how big, what goes on them. */}
      <Card className="no-print">
        <CardBody>
          <div className="flex flex-col gap-card">
            <p className="text-sm font-semibold">{t("restock.labels.controls")}</p>
            <p className="-mt-2 text-xs text-fg-muted">{t("restock.labels.qrHint")}</p>

            <div className="flex flex-wrap items-start gap-8">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase text-fg-subtle">
                  {t("restock.labels.oneLabelPer")}
                </span>
                <div
                  className="inline-flex rounded-control border border-line-strong bg-surface-2 p-0.5"
                  data-testid="labels-mode"
                >
                  {[
                    { value: "piece", label: t("restock.labels.piece") },
                    { value: "shelf", label: t("restock.labels.shelf") },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={mode === opt.value}
                      onClick={() => setMode(opt.value as "piece" | "shelf")}
                      className={cn(
                        "cursor-pointer rounded-control px-3 py-1 text-sm font-medium text-fg-muted transition-colors",
                        mode === opt.value && "bg-surface text-fg shadow-card",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase text-fg-subtle">
                  {t("restock.labels.size")}
                </span>
                <div className="w-40">
                  <Select
                    value={size}
                    onChange={(e) => setSize(e.target.value as LabelSize)}
                    data-testid="labels-size"
                  >
                    {SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace("x", " × ")} mm
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase text-fg-subtle">
                  {t("restock.labels.showOn")}
                </span>
                <div className="flex flex-col gap-1.5">
                  <LabelToggle
                    checked={showRack}
                    onChange={setShowRack}
                    label={t("restock.labels.showRack")}
                  />
                  <LabelToggle
                    checked={showRef}
                    onChange={setShowRef}
                    label={t("restock.labels.showRef")}
                  />
                  <LabelToggle
                    checked={showHpp}
                    onChange={setShowHpp}
                    label={t("restock.labels.showHpp")}
                  />
                </div>
              </div>
            </div>

            {/* The honest hard case: broken/lost never entered stock, so they got no label. */}
            {data.excludedCount > 0n && (
              <div
                className="flex items-center gap-2 border-t border-line pt-card text-sm text-fg-muted"
                data-testid="labels-excluded"
              >
                <TriangleAlert className="size-4 text-warn" />
                <span>{t("restock.labels.excluded", { count: Number(data.excludedCount) })}</span>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {job.length === 0 ? (
        <p className="text-fg-muted" data-testid="labels-empty">
          {t("restock.labels.none")}
        </p>
      ) : (
        <div>
          <div className="labels-sheet" data-testid="labels-sheet">
            {preview.map((entry, i) => (
              <LabelCard
                key={`p${i}`}
                entry={entry}
                size={size}
                showRack={showRack}
                showRef={showRef}
                showHpp={showHpp}
                restockRef={restockRef}
                receivedOn={receivedOn}
              />
            ))}
            {/* Rendered but hidden on screen — the print stylesheet reveals them so the whole job
                prints even when the preview shows a sample. */}
            {overflow.map((entry, i) => (
              <div key={`o${i}`} className="print-only-label">
                <LabelCard
                  entry={entry}
                  size={size}
                  showRack={showRack}
                  showRef={showRef}
                  showHpp={showHpp}
                  restockRef={restockRef}
                  receivedOn={receivedOn}
                />
              </div>
            ))}
          </div>

          {overflow.length > 0 && (
            <div className="mt-card flex items-center gap-2 text-sm text-fg-subtle no-print">
              <Info className="size-4" />
              <span>{t("restock.labels.previewNote", { shown: PREVIEW_CAP, total: job.length })}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LabelToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Checkbox checked={checked} onCheckedChange={onChange}>
      {label}
    </Checkbox>
  );
}

// One sticker. The QR (vector, so it prints crisp at any size) sets the square height; the text
// stacks beside it. A nil rack is the holding pile, said as "HOLDING" (#135).
function LabelCard({
  entry,
  size,
  showRack,
  showRef,
  showHpp,
  restockRef,
  receivedOn,
}: {
  entry: JobEntry;
  size: LabelSize;
  showRack: boolean;
  showRef: boolean;
  showHpp: boolean;
  restockRef: string;
  receivedOn: string;
}) {
  const { t } = useTranslation();
  const { label } = entry;
  const payload = `${label.sku}/${label.batchId.toString()}`;
  const place = label.unplaced ? t("restock.labels.holding") : label.rackCode;

  const meta: string[] = [];
  if (entry.copyTotal > 1) meta.push(`${entry.copyIndex}/${entry.copyTotal}`);
  if (showRef && restockRef) meta.push(`${restockRef}${receivedOn ? ` · ${receivedOn}` : ""}`);

  return (
    <div className={`print-label sz-${size}`}>
      <div className="label-qr">
        <QRCodeSVG value={payload} size={128} marginSize={0} level="M" />
      </div>
      <div className="label-main">
        <div className="label-top">
          <span className="label-name">{label.name}</span>
          {showRack && (
            <span className={`label-rack${label.unplaced ? " holding" : ""}`}>{place}</span>
          )}
        </div>
        <div className="label-foot">
          <span className="label-sku">{payload}</span>
          {showHpp && <span className="label-hpp">{formatRupiah(label.hpp)}</span>}
        </div>
        {meta.length > 0 && <span className="label-meta">{meta.join(" · ")}</span>}
      </div>
    </div>
  );
}

// Print + label styling. Kept as a scoped stylesheet rather than utilities because it is genuinely
// CSS's job: physical mm dimensions, point-sized type that fits a 30×15 sticker, and an @media print
// block that strips the app chrome and lays the labels out as a sheet of real stickers. The class
// names are local to this page.
function PrintStyles() {
  return (
    <style>{`
      .labels-sheet {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
      }
      .print-only-label { display: none; }
      .print-label {
        border: 1px solid #d0d5dd;
        border-radius: 6px;
        background: #fff;
        color: #101828;
        padding: 10px 12px;
        display: flex;
        align-items: stretch;
        gap: 10px;
        overflow: hidden;
      }
      .print-label.sz-30x15 { aspect-ratio: 2 / 1; }
      .print-label.sz-40x25 { aspect-ratio: 8 / 5; }
      .print-label.sz-50x30 { aspect-ratio: 5 / 3; }
      .print-label.sz-60x40 { aspect-ratio: 3 / 2; }
      .label-qr { flex: 0 0 auto; aspect-ratio: 1; height: 100%; display: grid; place-items: center; }
      .label-qr svg { width: 100% !important; height: 100% !important; display: block; }
      .label-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
      .label-top { display: flex; align-items: flex-start; gap: 8px; }
      .label-name {
        font-size: 13px; font-weight: 700; line-height: 1.2; flex: 1 1 auto; min-width: 0;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      .label-rack {
        flex: 0 0 auto; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
        background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe;
        padding: 2px 7px; border-radius: 5px; white-space: nowrap;
      }
      .label-rack.holding { background: #fffaeb; color: #b54708; border-color: #fedf89; }
      .label-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: auto; }
      .label-sku { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: #475467; }
      .label-hpp { font-size: 11px; font-weight: 700; color: #101828; font-variant-numeric: tabular-nums; }
      .label-meta {
        font-size: 10.5px; color: #667085; font-variant-numeric: tabular-nums;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .sz-30x15 .label-name { -webkit-line-clamp: 1; font-size: 12px; }
      .sz-30x15 .label-hpp, .sz-30x15 .label-meta { font-size: 10px; }

      @media print {
        @page { margin: 8mm; }
        body { background: #fff; }
        .no-print { display: none !important; }
        .print-only-label { display: block; }
        .labels-sheet { display: flex; flex-wrap: wrap; gap: 0; }
        .print-only-label > .print-label, .labels-sheet > .print-label {
          border: 1px dashed #bbb; border-radius: 0; break-inside: avoid; aspect-ratio: auto;
        }
        .print-label.sz-30x15 { width: 30mm; height: 15mm; padding: 1.5mm 2mm; gap: 1.5mm; }
        .print-label.sz-40x25 { width: 40mm; height: 25mm; padding: 2mm 2.5mm; gap: 2mm; }
        .print-label.sz-50x30 { width: 50mm; height: 30mm; padding: 2.5mm 3mm; gap: 2.5mm; }
        .print-label.sz-60x40 { width: 60mm; height: 40mm; padding: 3mm 3.5mm; gap: 3mm; }
        .sz-30x15 .label-name { font-size: 6pt; }
        .sz-30x15 .label-sku, .sz-30x15 .label-hpp, .sz-30x15 .label-meta, .sz-30x15 .label-rack { font-size: 4.5pt; }
        .sz-40x25 .label-name { font-size: 7pt; }
        .sz-40x25 .label-sku, .sz-40x25 .label-hpp, .sz-40x25 .label-meta, .sz-40x25 .label-rack { font-size: 5.5pt; }
      }
    `}</style>
  );
}

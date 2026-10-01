import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Heading,
  Icon,
  NativeSelect,
  SegmentGroup,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Check, Download, Info, Printer, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockLabel } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useRestockLabels } from "../../features/restock/queries";
import { formatRupiah } from "../../lib/money";

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
      alignSelf="flex-start"
      className="no-print"
      onClick={() => navigate(`/inventories/restock/${rawId ?? ""}`)}
      data-testid="labels-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {t("restock.labels.back", { id: rawId ?? "" })}
    </Button>
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.labels.title")}</Heading>
        <Text color="fg.muted">{t("restock.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.labels.title")}</Heading>
        <Text color="fg.muted" data-testid="labels-not-warehouse">
          {t("restock.labels.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  if (query.isPending && teamId !== undefined && requestId !== 0n) {
    return (
      <Stack gap="section">
        {back}
        <Spinner colorPalette="brand" />
      </Stack>
    );
  }

  if (query.isError || !data) {
    return (
      <Stack gap="section">
        {back}
        <Text color="red.fg" data-testid="labels-error">
          {query.isError ? rpcError(query.error) : t("restock.labels.notFound")}
        </Text>
      </Stack>
    );
  }

  const preview = job.slice(0, PREVIEW_CAP);
  const overflow = job.slice(PREVIEW_CAP);

  return (
    <Stack gap="section">
      <PrintStyles />

      {back}

      {/* The action header — count of what will print, and Print / Download (both the browser's own
          print dialog, which is where a PDF is saved too). */}
      <Flex align="center" gap="card" wrap="wrap" className="no-print">
        <Heading size="md">{t("restock.labels.heading", { id: data.restockId.toString() })}</Heading>
        <Badge colorPalette="green">
          <Icon as={Check} boxSize="3.5" />
          {t("restock.labels.accepted")}
        </Badge>
        <Spacer />
        <Stack gap="0" textAlign="end" mr="2">
          <Text fontSize="sm">
            <Text as="span" fontWeight="semibold">
              {job.length}
            </Text>{" "}
            {t("restock.labels.count", { products: productCount })}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {mode === "piece" ? t("restock.labels.perPiece") : t("restock.labels.perShelf")}
          </Text>
        </Stack>
        <Button variant="outline" onClick={() => window.print()} data-testid="labels-download">
          <Icon as={Download} boxSize="4" />
          {t("restock.labels.downloadPdf")}
        </Button>
        <Button colorPalette="brand" onClick={() => window.print()} data-testid="labels-print">
          <Icon as={Printer} boxSize="4" />
          {t("restock.labels.print")}
        </Button>
      </Flex>

      {/* Controls: how many labels, how big, what goes on them. */}
      <Card.Root className="no-print">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="semibold">
              {t("restock.labels.controls")}
            </Text>
            <Text fontSize="xs" color="fg.muted" mt="-2">
              {t("restock.labels.qrHint")}
            </Text>

            <Flex gap="8" wrap="wrap" align="flex-start">
              <Stack gap="1.5">
                <Text fontSize="xs" color="fg.subtle" fontWeight="semibold" textTransform="uppercase">
                  {t("restock.labels.oneLabelPer")}
                </Text>
                <SegmentGroup.Root
                  value={mode}
                  onValueChange={(e) => setMode((e.value as "piece" | "shelf") ?? "piece")}
                  data-testid="labels-mode"
                >
                  <SegmentGroup.Indicator />
                  <SegmentGroup.Items
                    items={[
                      { value: "piece", label: t("restock.labels.piece") },
                      { value: "shelf", label: t("restock.labels.shelf") },
                    ]}
                  />
                </SegmentGroup.Root>
              </Stack>

              <Stack gap="1.5">
                <Text fontSize="xs" color="fg.subtle" fontWeight="semibold" textTransform="uppercase">
                  {t("restock.labels.size")}
                </Text>
                <NativeSelect.Root width="40">
                  <NativeSelect.Field
                    value={size}
                    onChange={(e) => setSize(e.target.value as LabelSize)}
                    data-testid="labels-size"
                  >
                    {SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace("x", " × ")} mm
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Stack>

              <Stack gap="1.5">
                <Text fontSize="xs" color="fg.subtle" fontWeight="semibold" textTransform="uppercase">
                  {t("restock.labels.showOn")}
                </Text>
                <Stack gap="1.5">
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
                </Stack>
              </Stack>
            </Flex>

            {/* The honest hard case: broken/lost never entered stock, so they got no label. */}
            {data.excludedCount > 0n && (
              <Flex
                align="center"
                gap="2"
                borderTopWidth="1px"
                borderColor="border"
                pt="card"
                color="fg.muted"
                fontSize="sm"
                data-testid="labels-excluded"
              >
                <Icon as={TriangleAlert} boxSize="4" color="orange.fg" />
                <Text>{t("restock.labels.excluded", { count: Number(data.excludedCount) })}</Text>
              </Flex>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

      {job.length === 0 ? (
        <Text color="fg.muted" data-testid="labels-empty">
          {t("restock.labels.none")}
        </Text>
      ) : (
        <Box>
          <Box className="labels-sheet" data-testid="labels-sheet">
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
              <Box key={`o${i}`} className="print-only-label">
                <LabelCard
                  entry={entry}
                  size={size}
                  showRack={showRack}
                  showRef={showRef}
                  showHpp={showHpp}
                  restockRef={restockRef}
                  receivedOn={receivedOn}
                />
              </Box>
            ))}
          </Box>

          {overflow.length > 0 && (
            <Flex align="center" gap="2" mt="card" color="fg.subtle" fontSize="sm" className="no-print">
              <Icon as={Info} boxSize="4" />
              <Text>
                {t("restock.labels.previewNote", { shown: PREVIEW_CAP, total: job.length })}
              </Text>
            </Flex>
          )}
        </Box>
      )}
    </Stack>
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
    <Checkbox.Root
      checked={checked}
      onCheckedChange={(e) => onChange(e.checked === true)}
      size="sm"
    >
      <Checkbox.HiddenInput />
      <Checkbox.Control />
      <Checkbox.Label>{label}</Checkbox.Label>
    </Checkbox.Root>
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

// Print + label styling. Kept as a scoped stylesheet rather than Chakra props because it is genuinely
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

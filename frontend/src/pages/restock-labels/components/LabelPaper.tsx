import type { CSSProperties } from "react";
import { QRCodeSVG } from "qrcode.react";

import type { RestockLabel } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import type { LabelSettings } from "../settings";
import { labelBox, paddingOf } from "../settings";

// ONE PAPER, AT ITS TRUE SIZE IN MM — rows × columns of labels with the gap between them (the-label-is-set-up-in-mm).
// The same element is the screen's preview (scaled up around it) and the printed page (one paper a page). Plain styles in
// mm and pt rather than theme tokens: a sticker's size is a physical fact, not the app's density.
//
//   ┌ paper ─────────────────────────────┐
//   │ ┌ label ─────────────────────────┐ │   padding inside each label
//   │ │ ▓▓▓▓▓  SKU-BERAS-5K            │ │   SKU · placement · name (N lines) · today
//   │ │ ▓QR▓▓  A-01-1                  │ │   the gap between the QR and the text
//   │ │ ▓▓▓▓▓  Beras Pandan Wangi 5kg  │ │
//   │ └────────────────────────────────┘ │
//   └────────────────────────────────────┘
export function LabelPaper({
  labels,
  settings,
  today,
  testId,
}: {
  labels: RestockLabel[];
  settings: LabelSettings;
  /** Today's date in the app's language — printed when the date is on. */
  today: string;
  testId?: string;
}) {
  const s = settings;
  const paper: CSSProperties = {
    width: `${s.paperWidth}mm`,
    height: `${s.paperHeight}mm`,
    display: "grid",
    gridTemplateColumns: `repeat(${s.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${s.rows}, minmax(0, 1fr))`,
    gap: `${s.gap}mm`,
    background: "#fff",
    color: "#000",
    overflow: "hidden",
    boxSizing: "border-box",
  };

  return (
    <div className="label-paper" style={paper} data-testid={testId}>
      {labels.map((label, i) => (
        <LabelCell key={i} label={label} settings={s} today={today} />
      ))}
    </div>
  );
}

/**
 * ONE LABEL, alone, at its own box's size — a cell of the paper (the paper less its gaps, shared out). What Yang Dicetak
 * shows for each label, with its count beside it (the-print-list-is-each-label-and-its-count).
 */
export function LabelSticker({
  label,
  settings,
  today,
  testId,
}: {
  label: RestockLabel;
  settings: LabelSettings;
  today: string;
  testId?: string;
}) {
  const box = labelBox(settings);

  return (
    <div
      className="label-sticker"
      style={{ width: `${box.width}mm`, height: `${box.height}mm`, display: "grid", background: "#fff", color: "#000", overflow: "hidden" }}
      data-testid={testId}
    >
      <LabelCell label={label} settings={settings} today={today} />
    </div>
  );
}

function LabelCell({ label, settings: s, today }: { label: RestockLabel; settings: LabelSettings; today: string }) {
  const box = labelBox(s);
  const pad = paddingOf(s);
  // The QR carries sku/batch: one batch per line (one-batch-per-line), so the scan finds the exact stock. An arrived
  // restock's label has no batch yet (labels-print-from-arrived) — its QR is the SKU alone.
  const payload = label.batchId > 0n ? `${label.productCode}/${label.batchId.toString()}` : label.productCode;

  const cell: CSSProperties = {
    boxSizing: "border-box",
    padding: `${pad.top}mm ${pad.right}mm ${pad.bottom}mm ${pad.left}mm`,
    display: "flex",
    alignItems: s.center ? "center" : "flex-start",
    gap: `${s.qrGap}mm`,
    overflow: "hidden",
    minWidth: 0,
    minHeight: 0,
    fontFamily: s.condensed
      ? '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", "Helvetica Neue", Arial, sans-serif'
      : "Arial, Helvetica, sans-serif",
    fontStretch: s.condensed ? "condensed" : undefined,
    fontWeight: s.bold ? 700 : 400,
    lineHeight: 1.15,
  };
  const text: CSSProperties = {
    flex: "1 1 auto",
    minWidth: 0,
    width: `${box.text}mm`,
    display: "flex",
    flexDirection: "column",
    alignItems: s.center ? "center" : "flex-start",
    textAlign: s.center ? "center" : "left",
    gap: "0.4mm",
    overflow: "hidden",
  };
  const line = (size: number): CSSProperties => ({
    fontSize: `${size}pt`,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  });

  return (
    <div className="print-label" style={cell}>
      <div style={{ width: `${box.qr}mm`, height: `${box.qr}mm`, flex: "0 0 auto" }}>
        <QRCodeSVG value={payload} size={128} marginSize={0} level="M" style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
      <div style={text}>
        {s.showSku && (
          <span style={line(s.skuSize)} data-testid="label-sku">
            {label.productCode}
          </span>
        )}
        {s.showPlacement && label.placementCode && (
          <span style={line(s.placementSize)} data-testid="label-placement">
            {label.placementCode}
          </span>
        )}
        {s.showName && (
          // CUT AFTER N LINES, so a long name never pushes the rest off the sticker.
          <span
            style={{
              fontSize: `${s.nameSize}pt`,
              display: "-webkit-box",
              WebkitLineClamp: s.nameLines,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              wordBreak: "break-word",
              maxWidth: "100%",
            }}
            data-testid="label-name"
          >
            {label.name}
          </span>
        )}
        {s.showDate && (
          <span style={line(s.dateSize)} data-testid="label-date">
            {today}
          </span>
        )}
      </div>
    </div>
  );
}

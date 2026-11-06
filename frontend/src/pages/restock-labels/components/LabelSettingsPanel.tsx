import type { ReactNode } from "react";
import { Button, Card, Checkbox, Field, Flex, Grid, HStack, Icon, SegmentGroup, Separator, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";

import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { RadioPills } from "../../../components/inputs/RadioPills";
import type { LabelMode, LabelSettings, PaddingMode } from "../settings";
import { BOUNDS } from "../settings";
import { MeasureInput } from "./MeasureInput";

// EVERY SETTING OF A LABEL RUN (owner, 2026-11-06, the-label-is-set-up-in-mm), in four groups read top to bottom — the
// paper, the padding inside each label, the text, the run:
//
//   Kertas    Lebar [35] mm  Tinggi [25] mm   Baris [1]  Kolom [1]  Jarak [0] mm
//   Padding   (• Semua) ( Per sisi )   [1] mm   — or Atas · Kanan · Bawah · Kiri
//   Teks      ☑ SKU [7] pt  ☑ Penempatan [7] pt  ☑ Nama produk [6] pt, maks [2] baris  ☐ Tanggal cetak [5] pt
//             ☑ Tebal  ☐ Rata tengah  ☐ Font condensed   Jarak QR – teks [1.5] mm
//   Cetak     Satu label per [Pcs | Rak]   Limit [100]   Halaman [1] dari 3
//
// Remembered on this device; Kembalikan Default puts every one back.
export function LabelSettingsPanel({
  settings: s,
  onChange,
  page,
  pages,
  onPage,
  onReset,
  fill = false,
}: {
  settings: LabelSettings;
  onChange: (patch: Partial<LabelSettings>) => void;
  page: number;
  pages: number;
  onPage: (page: number) => void;
  onReset: () => void;
  /** Fill a sticky column down to the window's foot, the groups scrolling inside — a wide screen's. */
  fill?: boolean;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`restock.labels.settings.${key}`);
  const int = (raw: string, fallback: number) => {
    const n = Number(raw);
    return raw === "" || !Number.isFinite(n) ? fallback : Math.round(n);
  };

  return (
    // FILLING THE STICKY COLUMN (owner: *"scrollbarnya settingnya seperti di product discover, heightnya menyesuaikan"*,
    // the-label-settings-scroll-inside-their-card) — the card takes what the column has left down to the window's foot;
    // its title and Kembalikan Default stay put and the GROUPS scroll, the bar on the card's right edge, as FilterPanel's.
    // Not filling (a phone, the column stacked), it is as tall as it is.
    <Card.Root
      className="no-print"
      data-testid="labels-settings"
      flex={fill ? "1 1 auto" : undefined}
      minH={fill ? "0" : undefined}
      overflow={fill ? "hidden" : undefined}
    >
      <Card.Body minH="0" gap="card">
        <Flex align="center" gap="2" flexShrink={0}>
          <Text fontWeight="bold">{k("title")}</Text>
          <Button size="xs" variant="ghost" ms="auto" data-testid="labels-reset" onClick={onReset}>
            <Icon as={RotateCcw} boxSize="3.5" />
            {k("reset")}
          </Button>
        </Flex>

        {/* The groups — scrolling, when the card fills, through the body's right padding and given it back, so the bar
            rides the card's edge while every group stays where it was. */}
        <Stack
          gap="card"
          data-testid="labels-settings-groups"
          {...(fill
            ? {
                layerStyle: "scrollList",
                flex: "1",
                minH: "0",
                me: "calc(var(--card-padding) * -1)",
                pe: "var(--card-padding)",
              }
            : {})}
        >

          {/* KERTAS — the paper in mm, and how many labels one paper holds. */}
          <Group title={k("paper")}>
            <Flex gap="field" wrap="wrap">
              <Measure label={k("width")} unit="mm" testId="labels-paper-width" value={s.paperWidth} bounds={BOUNDS.paper} step={1} onChange={(paperWidth) => onChange({ paperWidth })} />
              <Measure label={k("height")} unit="mm" testId="labels-paper-height" value={s.paperHeight} bounds={BOUNDS.paper} step={1} onChange={(paperHeight) => onChange({ paperHeight })} />
            </Flex>
            <Flex gap="field" wrap="wrap">
              <Whole label={k("rows")} testId="labels-rows" value={s.rows} bounds={BOUNDS.grid} onChange={(raw) => onChange({ rows: int(raw, s.rows) })} />
              <Whole label={k("columns")} testId="labels-columns" value={s.columns} bounds={BOUNDS.grid} onChange={(raw) => onChange({ columns: int(raw, s.columns) })} />
              <Measure label={k("gap")} unit="mm" testId="labels-gap" value={s.gap} bounds={BOUNDS.gap} onChange={(gap) => onChange({ gap })} />
            </Flex>
          </Group>

          <Separator />

          {/* PADDING — the same all round, or each side its own. */}
          <Group title={k("padding")}>
            <RadioPills<PaddingMode>
              value={s.paddingMode}
              onChange={(paddingMode) => onChange({ paddingMode })}
              ariaLabel={k("padding")}
              testId="labels-padding-mode"
              options={[
                { value: "all", label: k("paddingAll"), testId: "labels-padding-all" },
                { value: "sides", label: k("paddingSides"), testId: "labels-padding-sides" },
              ]}
            />
            {s.paddingMode === "all" ? (
              <Measure label={k("paddingAll")} unit="mm" testId="labels-padding" value={s.padding} bounds={BOUNDS.padding} onChange={(padding) => onChange({ padding })} />
            ) : (
              <Grid templateColumns="repeat(2, auto)" gap="field" justifyContent="start">
                <Measure label={k("top")} unit="mm" testId="labels-padding-top" value={s.paddingTop} bounds={BOUNDS.padding} onChange={(paddingTop) => onChange({ paddingTop })} />
                <Measure label={k("right")} unit="mm" testId="labels-padding-right" value={s.paddingRight} bounds={BOUNDS.padding} onChange={(paddingRight) => onChange({ paddingRight })} />
                <Measure label={k("bottom")} unit="mm" testId="labels-padding-bottom" value={s.paddingBottom} bounds={BOUNDS.padding} onChange={(paddingBottom) => onChange({ paddingBottom })} />
                <Measure label={k("left")} unit="mm" testId="labels-padding-left" value={s.paddingLeft} bounds={BOUNDS.padding} onChange={(paddingLeft) => onChange({ paddingLeft })} />
              </Grid>
            )}
          </Group>

          <Separator />

          {/* TEKS — what is on the label, each at its own size; then how the text is set. */}
          <Group title={k("text")}>
            <Stack gap="2">
              <TextRow label={k("sku")} testId="labels-show-sku" checked={s.showSku} onCheck={(showSku) => onChange({ showSku })} size={s.skuSize} onSize={(skuSize) => onChange({ skuSize })} />
              <TextRow label={k("placement")} testId="labels-show-placement" checked={s.showPlacement} onCheck={(showPlacement) => onChange({ showPlacement })} size={s.placementSize} onSize={(placementSize) => onChange({ placementSize })} />
              <TextRow label={k("name")} testId="labels-show-name" checked={s.showName} onCheck={(showName) => onChange({ showName })} size={s.nameSize} onSize={(nameSize) => onChange({ nameSize })}>
                {/* THE NAME IS CUT AFTER N LINES — a long name never pushes the rest off the sticker. */}
                <HStack gap="1.5">
                  <Text fontSize="xs" color="fg.muted">
                    {k("nameLines")}
                  </Text>
                  <QuantityInput
                    min={BOUNDS.nameLines.min}
                    max={BOUNDS.nameLines.max}
                    width="10"
                    value={String(s.nameLines)}
                    disabled={!s.showName}
                    aria-label={k("nameLines")}
                    testId="labels-name-lines"
                    onChange={(raw) => onChange({ nameLines: int(raw, s.nameLines) })}
                  />
                </HStack>
              </TextRow>
              <TextRow label={k("date")} testId="labels-show-date" checked={s.showDate} onCheck={(showDate) => onChange({ showDate })} size={s.dateSize} onSize={(dateSize) => onChange({ dateSize })} />
            </Stack>

            <Flex gap="field" wrap="wrap">
              <Toggle label={k("bold")} testId="labels-bold" checked={s.bold} onChange={(bold) => onChange({ bold })} />
              <Toggle label={k("center")} testId="labels-center" checked={s.center} onChange={(center) => onChange({ center })} />
              <Toggle label={k("condensed")} testId="labels-condensed" checked={s.condensed} onChange={(condensed) => onChange({ condensed })} />
            </Flex>
            <Measure label={k("qrGap")} unit="mm" testId="labels-qr-gap" value={s.qrGap} bounds={BOUNDS.qrGap} onChange={(qrGap) => onChange({ qrGap })} />
          </Group>

          <Separator />

          {/* CETAK — one label per piece or per placement; and the run: how many labels a print sends, and which. */}
          <Group title={k("run")}>
            <Field.Root w="auto">
              <Field.Label>{t("restock.labels.oneLabelPer")}</Field.Label>
              <SegmentGroup.Root
                value={s.mode}
                onValueChange={(e) => onChange({ mode: (e.value as LabelMode) ?? "piece" })}
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
            </Field.Root>
            <Flex gap="field" wrap="wrap" align="flex-end">
              <Whole label={k("limit")} testId="labels-limit" value={s.limit} bounds={BOUNDS.limit} width="16" onChange={(raw) => onChange({ limit: int(raw, s.limit) })} />
              <Field.Root w="auto">
                <Field.Label>{k("page")}</Field.Label>
                <HStack gap="1.5">
                  <QuantityInput
                    min={1}
                    max={pages}
                    width="12"
                    value={String(page)}
                    aria-label={k("page")}
                    testId="labels-run-page"
                    onChange={(raw) => onPage(int(raw, page))}
                  />
                  <Text fontSize="sm" color="fg.muted" whiteSpace="nowrap" data-testid="labels-pages">
                    {t("restock.labels.settings.ofPages", { pages })}
                  </Text>
                </HStack>
              </Field.Root>
            </Flex>
          </Group>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="field">
      <Text fontSize="sm" fontWeight="bold">
        {title}
      </Text>
      {children}
    </Stack>
  );
}

function Measure({
  label,
  unit,
  value,
  bounds,
  step,
  testId,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  bounds: { min: number; max: number };
  step?: number;
  testId: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field.Root w="auto">
      <Field.Label>{label}</Field.Label>
      <MeasureInput value={value} onChange={onChange} min={bounds.min} max={bounds.max} step={step} unit={unit} label={label} testId={testId} />
    </Field.Root>
  );
}

function Whole({
  label,
  value,
  bounds,
  width = "10",
  testId,
  onChange,
}: {
  label: string;
  value: number;
  bounds: { min: number; max: number };
  width?: string;
  testId: string;
  onChange: (raw: string) => void;
}) {
  return (
    <Field.Root w="auto">
      <Field.Label>{label}</Field.Label>
      <QuantityInput min={bounds.min} max={bounds.max} width={width} value={String(value)} aria-label={label} testId={testId} onChange={onChange} />
    </Field.Root>
  );
}

// One text on the label: shown or not, and its size in pt — the size is off while the text is.
function TextRow({
  label,
  testId,
  checked,
  onCheck,
  size,
  onSize,
  children,
}: {
  label: string;
  testId: string;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  size: number;
  onSize: (size: number) => void;
  children?: ReactNode;
}) {
  return (
    <Flex align="center" gap="2" wrap="wrap" minH="8">
      <Toggle label={label} testId={testId} checked={checked} onChange={onCheck} grow />
      {checked && (
        <>
          <MeasureInput value={size} onChange={onSize} min={BOUNDS.font.min} max={BOUNDS.font.max} unit="pt" label={label} testId={`${testId}-size`} />
          {children}
        </>
      )}
    </Flex>
  );
}

function Toggle({
  label,
  testId,
  checked,
  onChange,
  grow,
}: {
  label: string;
  testId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  grow?: boolean;
}) {
  return (
    <Checkbox.Root
      checked={checked}
      onCheckedChange={(e) => onChange(e.checked === true)}
      size="sm"
      minW={grow ? "8rem" : undefined}
      data-testid={testId}
    >
      <Checkbox.HiddenInput />
      <Checkbox.Control />
      <Checkbox.Label>{label}</Checkbox.Label>
    </Checkbox.Root>
  );
}

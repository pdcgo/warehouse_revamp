import { useTranslation } from "react-i18next";
import { Button, HStack, Icon, Input, Stack, Text } from "@chakra-ui/react";
import { PencilLine } from "lucide-react";

import { FilterChips } from "../../../components/chrome/FilterChips";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { type Band, CUSTOM, NO_RANGE, type RangePick } from "../ranges";

// A RANGE, PICKED (owner: *"untuk stok dan price rangenya pilih saja, kalau mau custom kudu klik tombol dulu"*,
// `discover-ranges-are-picked`) — the bands as pills, Semua first, and at their end a button that opens two boxes for a
// range of one's own:
//
//   (Semua) (1–10) (11–50) (51–100) (101–500)
//   (501–1.000) (1.001–10.000) (10.001–100.000) (✎ Atur sendiri)
//   [ min ] – [ max ]          maks 100.000         ← only after Atur sendiri
//
// THE STOCK BOXES ARE PLAIN (owner: *"min maks stok tidak usah pakai control, karena memenuhi tempat"*,
// `a-range-bound-is-a-plain-number-box`) — two QuantityInputs, each with its − and +, filled a 16rem panel with buttons
// and left the numbers a few characters. A bound in a filter is typed once, not stepped, so it is a box that takes digits
// only and shows them grouped (100.000) — NOT `type="number"`, which changes when somebody scrolls past it.
//
// A band is ONE click and says what it covers; typing is the exception, so it is behind its own button. Picking a band
// closes the boxes; pressing Atur sendiri again goes back to Semua. What is typed is held under the ceiling — a stock past
// 100.000 or a price past Rp 1.000.000 is not a range anything here holds.
export function DiscoverRangeFilter({
  kind,
  value,
  onChange,
  bands,
  bandLabel,
  max,
  testId,
}: {
  kind: "stock" | "price";
  value: RangePick;
  onChange: (next: RangePick) => void;
  bands: Band[];
  bandLabel: (band: Band) => string;
  /** The ceiling — the last band's end, and what a typed bound is held under. */
  max: number;
  testId: string;
}) {
  const { t } = useTranslation();
  const custom = value.band === CUSTOM;
  // A typed bound past the ceiling is held at it.
  const clamp = (raw: string) => (raw === "" ? "" : String(Math.min(Number(raw), max)));
  const ceiling = kind === "stock" ? max.toLocaleString("id-ID") : `Rp ${max.toLocaleString("id-ID")}`;

  return (
    <Stack gap="2" data-testid={testId}>
      <FilterChips
        value={value.band}
        onChange={(band) => onChange({ band, min: "", max: "" })}
        all=""
        allLabel={t("discover.range.all")}
        options={bands.map((b) => ({ value: b.key, label: bandLabel(b) }))}
        ariaLabel={t(kind === "stock" ? "discover.filter.stock" : "discover.filter.crossRange")}
        // The way to a range of one's own — drawn as one more chip, pressed while its boxes are open.
        trailing={
          <Button
            size="xs"
            borderRadius="full"
            flexShrink={0}
            px="3"
            variant={custom ? "subtle" : "outline"}
            colorPalette={custom ? "brand" : "gray"}
            borderWidth="1px"
            borderColor={custom ? "brand.solid" : "border"}
            fontWeight="normal"
            transitionDuration="hover"
            aria-pressed={custom}
            data-testid={`${testId}-custom`}
            onClick={() => onChange(custom ? NO_RANGE : { band: CUSTOM, min: "", max: "" })}
          >
            <Icon as={PencilLine} boxSize="3.5" />
            {t("discover.range.custom")}
          </Button>
        }
        testId={`${testId}-chips`}
      />

      {custom && (
        <Stack gap="1" animationStyle="appear">
          <HStack gap="2">
            {kind === "stock" ? (
              <>
                <DigitsInput
                  value={value.min}
                  onChange={(v) => onChange({ ...value, min: clamp(v) })}
                  placeholder={t("discover.range.min")}
                  aria-label={t("discover.range.minOf", { what: t("discover.filter.stock") })}
                  testId={`${testId}-min`}
                />
                <Text color="fg.muted" flexShrink={0}>
                  –
                </Text>
                <DigitsInput
                  value={value.max}
                  onChange={(v) => onChange({ ...value, max: clamp(v) })}
                  placeholder={t("discover.range.max")}
                  aria-label={t("discover.range.maxOf", { what: t("discover.filter.stock") })}
                  testId={`${testId}-max`}
                />
              </>
            ) : (
              <>
                {/* Money fields show 0 until typed (a-money-field-shows-0-until-typed). */}
                <CurrencyInput
                  value={value.min}
                  onChange={(v) => onChange({ ...value, min: clamp(v) })}
                  aria-label={t("discover.range.minOf", { what: t("discover.filter.crossRange") })}
                  data-testid={`${testId}-min`}
                />
                <Text color="fg.muted" flexShrink={0}>
                  –
                </Text>
                <CurrencyInput
                  value={value.max}
                  onChange={(v) => onChange({ ...value, max: clamp(v) })}
                  aria-label={t("discover.range.maxOf", { what: t("discover.filter.crossRange") })}
                  data-testid={`${testId}-max`}
                />
              </>
            )}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {t("discover.range.ceiling", { max: ceiling })}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}

/**
 * A count, typed — digits only, shown grouped ("100.000"), held as RAW digits ("" = nothing typed). A plain box with no
 * − and + (a-range-bound-is-a-plain-number-box); `inputMode="numeric"` brings up the number pad on a phone.
 */
function DigitsInput({
  value,
  onChange,
  placeholder,
  testId,
  ...rest
}: {
  value: string;
  onChange: (raw: string) => void;
  placeholder: string;
  "aria-label": string;
  testId: string;
}) {
  return (
    <Input
      inputMode="numeric"
      value={value === "" ? "" : Number(value).toLocaleString("id-ID")}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      data-testid={testId}
      {...rest}
    />
  );
}

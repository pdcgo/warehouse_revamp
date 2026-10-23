import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, CloseButton, Dialog, HStack, Icon, Popover, Portal, Stack, Text } from "@chakra-ui/react";
import { Lock, LockOpen, TrendingDown } from "lucide-react";

import { QuantityInput } from "../../components/inputs/QuantityInput";
import { RadioPills } from "../../components/inputs/RadioPills";
import { useIsMobile } from "../../layouts/shell";
import { parseQuantity } from "../../lib/quantity";
import { PRODUCT_LIMITS } from "./limits";

export const description =
  "A product's LOCK — whether another selling team may put it on its own order — as ONE setting with three ways (`one-lock-three-ways`): Terbuka (open), Stok minimum (closed while the total stock in every warehouse is under a number) and Selalu dikunci (always), picked as radio pills. It maps onto the two fields a product already has — `cross_locked` and `reserved_stock` — so no contract changed. `ProductLockControl` reads the setting on a row and edits it in a popover; `LockModeField` is the editor itself, which the product form uses as a field; a minimum that is in force right now carries a Terkunci badge.";

// THE THREE WAYS (owner: *"produk terkunci ada 2 opsi, kunci secara default dan kunci ketika stok mendekati settingan
// min stock"*, then *"coba"*, `one-lock-three-ways`).
//
//   Terbuka          another team may order it            cross_locked = false, reserved_stock = 0
//   Stok minimum     … until the total stock is under N   cross_locked = false, reserved_stock = N
//   Selalu dikunci   no other team ever                   cross_locked = true   (the minimum is kept)
//
// The minimum is THE RESERVE of the-reserve-stops-other-teams-at-low-stock: total stock across every warehouse ≥ N lets
// another team order, under it does not, and the owner's own orders are never stopped by it.
export type LockMode = "open" | "min" | "always";

const MODES: { mode: LockMode; icon: typeof Lock }[] = [
  { mode: "open", icon: LockOpen },
  { mode: "min", icon: TrendingDown },
  { mode: "always", icon: Lock },
];

export interface LockFields {
  crossLocked: boolean;
  reservedStock: number;
}

/** Which of the three ways a product's two fields say. Always wins: a locked product with a minimum is locked. */
export function lockModeOf(p: LockFields): LockMode {
  if (p.crossLocked) return "always";
  return p.reservedStock > 0 ? "min" : "open";
}

/**
 * The two fields a choice writes. Open clears the minimum — a minimum left behind would still close the product at low
 * stock; Always keeps it, so coming back to the minimum finds the number it had.
 */
export function lockFieldsOf(mode: LockMode, minimum: number): { crossLocked: boolean; reservedStock?: number } {
  switch (mode) {
    case "open":
      return { crossLocked: false, reservedStock: 0 };
    case "min":
      return { crossLocked: false, reservedStock: minimum };
    case "always":
      return { crossLocked: true, reservedStock: minimum > 0 ? minimum : undefined };
  }
}

/**
 * Whether the minimum is closing the product NOW — the total stock is under it. `undefined` when that cannot be said:
 * the setting is not a minimum, or the total is not known (a warehouse lens shows one building's stock, and the rule
 * reads every warehouse's).
 */
export function lockedByMinimumNow(p: LockFields, totalReady: bigint | undefined): boolean | undefined {
  if (lockModeOf(p) !== "min" || totalReady === undefined) return undefined;
  return totalReady < BigInt(p.reservedStock);
}

/** The setting in a few words — "Terbuka", "Min 20 pcs", "Selalu dikunci". */
export function useLockLabel() {
  const { t } = useTranslation();

  return (p: LockFields) => {
    const mode = lockModeOf(p);
    return mode === "min" ? t("products.lock.minShort", { n: p.reservedStock }) : t(`products.lock.short.${mode}`);
  };
}

// ── The editor ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The three ways as RADIO PILLS (owner: *"buat pill tipe ubah kuncinya"*, `the-lock-ways-are-radio-pills`) — an answer to
 * a field, as a form's either/or is everywhere (a-dialog-choice-is-a-radio-pill), not a segmented view switch; they wrap
 * on a phone. The minimum under them only when that is the way chosen — the pill names it, so the box carries no label
 * of its own — and a line saying what the choice means for another team.
 */
export function LockModeField({
  mode,
  onModeChange,
  minimum,
  onMinimumChange,
  testId,
}: {
  mode: LockMode;
  onModeChange: (mode: LockMode) => void;
  /** Held as typed — a cleared box is empty, not 0 (QuantityInput). */
  minimum: string;
  onMinimumChange: (minimum: string) => void;
  testId: string;
}) {
  const { t } = useTranslation();
  const invalid = mode === "min" && !minimumIsUsable(minimum);

  return (
    <Stack gap="2.5" data-testid={testId}>
      <RadioPills
        value={mode}
        onChange={onModeChange}
        ariaLabel={t("products.lock.title")}
        options={MODES.map(({ mode: m }) => ({
          value: m,
          label: t(`products.lock.mode.${m}`),
          testId: `${testId}-mode-${m}`,
        }))}
      />

      {mode === "min" && (
        <Stack gap="1">
          <HStack gap="2">
            <QuantityInput
              value={minimum}
              onChange={onMinimumChange}
              min={0}
              max={PRODUCT_LIMITS.reservedStock}
              size="sm"
              width="24"
              placeholder="0"
              aria-label={t("products.lock.minLabel")}
              testId={`${testId}-minimum`}
            />
            <Text fontSize="sm" color="fg.muted">
              {t("products.form.units")}
            </Text>
          </HStack>
          {invalid && (
            <Text fontSize="xs" color="error.fg" data-testid={`${testId}-minimum-error`}>
              {t("products.lock.minRequired")}
            </Text>
          )}
        </Stack>
      )}

      <Text fontSize="xs" color="fg.muted" data-testid={`${testId}-help`}>
        {t(`products.lock.help.${mode}`)}
      </Text>
    </Stack>
  );
}

/** A minimum that can be saved — a whole number of at least one (0 would be the open way under another name), and no
 * more than the server takes. */
export function minimumIsUsable(minimum: string): boolean {
  const n = parseQuantity(minimum);
  return n !== null && n >= 1 && n <= PRODUCT_LIMITS.reservedStock;
}

// ── The row's control ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The setting as a row reads it, and — where it may be changed — the button that opens the editor in a popover. A
 * minimum in force right now carries a Terkunci badge, in the warning tone.
 */
export function ProductLockControl({
  product,
  totalReady,
  editable,
  onSave,
  presentation,
  testId,
}: {
  product: LockFields;
  /** The total ready stock across every warehouse, when it is known — what decides whether a minimum is in force. */
  totalReady?: bigint;
  /** The owner on a live product; an archived product, or a warehouse holding another team's goods, only reads it. */
  editable: boolean;
  /** Write the choice; the editor closes when it resolves, and stays open on a failure. */
  onSave: (fields: { crossLocked: boolean; reservedStock?: number }) => Promise<boolean>;
  /** Where the editor opens — by default a popover on a desktop and a modal on a phone; a story pins one. */
  presentation?: "popover" | "dialog";
  testId: string;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const label = useLockLabel();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<LockMode>(lockModeOf(product));
  const [minimum, setMinimum] = useState(product.reservedStock > 0 ? String(product.reservedStock) : "");
  const [saving, setSaving] = useState(false);

  const current = lockModeOf(product);
  const lockedNow = lockedByMinimumNow(product, totalReady);

  // The setting, its icon in front — what every reader sees, editable or not.
  const reading = (
    <HStack gap="1.5" whiteSpace="nowrap">
      <Icon as={MODES.find((m) => m.mode === current)!.icon} boxSize="3.5" color="fg.muted" />
      <Text as="span">{label(product)}</Text>
    </HStack>
  );
  const badge = lockedNow ? (
    <Badge
      colorPalette="warning"
      size="sm"
      title={t("products.lock.lockedNowHint", { total: totalReady!.toString(), min: product.reservedStock })}
      data-testid={`${testId}-now`}
    >
      {t("products.lock.lockedNow")}
    </Badge>
  ) : null;

  if (!editable) {
    return (
      <HStack gap="1.5" data-testid={testId}>
        {reading}
        {badge}
      </HStack>
    );
  }

  // Opening starts the editor from what the product says now, not from an abandoned edit.
  function onOpenChange(next: boolean) {
    if (next) {
      setMode(lockModeOf(product));
      setMinimum(product.reservedStock > 0 ? String(product.reservedStock) : "");
    }
    setOpen(next);
  }

  async function save() {
    setSaving(true);
    const ok = await onSave(lockFieldsOf(mode, parseQuantity(minimum) ?? 0));
    setSaving(false);
    if (ok) setOpen(false);
  }

  const canSave = mode !== "min" || minimumIsUsable(minimum);
  // A POPOVER beside its row on a desktop; a MODAL on a phone (owner: *"di mobile … jadi modal"*,
  // `a-phone-edits-the-lock-in-a-modal`), where a popover anchored to a block's foot has no room to sit.
  const asDialog = presentation ? presentation === "dialog" : isMobile;

  const trigger = (
    <Button size="xs" variant="outline" colorPalette="gray" aria-label={t("products.lock.edit")} data-testid={testId}>
      {reading}
    </Button>
  );
  const field = (
    <LockModeField mode={mode} onModeChange={setMode} minimum={minimum} onMinimumChange={setMinimum} testId={`${testId}-field`} />
  );
  const buttons = (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </Button>
      <Button
        size="xs"
        colorPalette="brand"
        loading={saving}
        disabled={!canSave}
        data-testid={`${testId}-save`}
        onClick={() => void save()}
      >
        {t("products.save")}
      </Button>
    </>
  );

  if (asDialog) {
    return (
      <HStack gap="1.5">
        <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)}>
          <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
          <Portal>
            <Dialog.Backdrop />
            <Dialog.Positioner>
              <Dialog.Content data-testid={`${testId}-panel`}>
                <Dialog.Header>
                  <Dialog.Title>{t("products.lock.edit")}</Dialog.Title>
                </Dialog.Header>
                <Dialog.Body>{field}</Dialog.Body>
                <Dialog.Footer gap="2">{buttons}</Dialog.Footer>
                <Dialog.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Dialog.CloseTrigger>
              </Dialog.Content>
            </Dialog.Positioner>
          </Portal>
        </Dialog.Root>
        {badge}
      </HStack>
    );
  }

  return (
    <HStack gap="1.5">
      <Popover.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} positioning={{ placement: "bottom-end" }}>
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
        <Portal>
          <Popover.Positioner>
            {/* Wide enough for the three pills on one line. */}
            <Popover.Content w="30rem" maxW="calc(100vw - 2rem)" data-testid={`${testId}-panel`}>
              <Popover.Header>
                <Text fontWeight="bold">{t("products.lock.edit")}</Text>
              </Popover.Header>
              <Popover.Body>{field}</Popover.Body>
              <Popover.Footer justifyContent="flex-end" gap="2">
                {buttons}
              </Popover.Footer>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
      {badge}
    </HStack>
  );
}

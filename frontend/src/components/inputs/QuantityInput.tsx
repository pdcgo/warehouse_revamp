import { Group, Icon, IconButton, NumberInput } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";

export const description =
  "The shared whole-number field — a quantity, a count. Chakra's NumberInput for the behaviour (parsing, clamping, keyboard arrows, no scroll-wheel edits) with its cramped default steppers replaced by a − and a + FLANKING the box, which are reachable with a thumb and render the same in every browser. Holds a STRING, like every other field in a form draft, so a cleared box stays empty instead of collapsing to 0.";

export interface QuantityInputProps {
  /** Kept as a STRING while editing: an empty input is not 0, and a form draft holds what was typed. */
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** The BOX's width — the two buttons sit outside it. Defaults to a table cell's narrow field. */
  width?: string;
  size?: "xs" | "sm" | "md";
  "aria-label"?: string;
  testId?: string;
}

// A QUANTITY, AND NOTHING ELSE (owner: the native control is not good enough).
//
// What `<Input type="number">` was doing wrong, and why this is worth a component:
//
//   • ITS SPINNERS ARE THE BROWSER'S. Two 8px arrows in Chrome, a different pair in Safari, none at
//     all on a phone — on a table row of quantities they were unusable, so every count was typed
//     even when ±1 was the whole edit.
//   • IT CHANGES ON SCROLL. A wheel over a focused number input edits it: on a long order that is a
//     silent change to a line somebody was only scrolling past. Chakra binds the wheel only when
//     asked (`allowMouseWheel`), and this never asks.
//   • IT ACCEPTS "e", "+" AND "-". `type="number"` calls 1e3 a number; a warehouse does not.
//
// ⚠ THE STEPPERS ARE FLANKING BUTTONS, NOT CHAKRA'S DEFAULT PAIR. Its stock control stacks two 15px
// chevrons inside the right edge of the box — the same too-small target the native one had, and the
// reason for the complaint in the first place. A − and a + either side are thumb-sized, obvious, and
// identical on a phone and a desktop; this app is used at a shelf with a scanner in the other hand.
//
// ⚠ THE VALUE STAYS A STRING. Every caller holds a draft of what was typed (`LineDraft.quantity`),
// where "" is a box somebody cleared and 0 is a quantity they chose. Emitting numbers here would
// erase that difference at the one point where it matters.
export function QuantityInput({
  value,
  onChange,
  min = 0,
  max,
  disabled,
  width = "12",
  size = "xs",
  testId,
  ...rest
}: QuantityInputProps) {
  const { t } = useTranslation();

  return (
    <NumberInput.Root
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      size={size}
      // Typed past the ceiling it settles back on blur rather than fighting the keystroke — a field
      // that refuses the second digit of "12" while you are typing it is unusable.
      clampValueOnBlur
      // No wheel. See above: this is the bug the native control has.
      allowMouseWheel={false}
      inputMode="numeric"
      onValueChange={(e) => onChange(e.value)}
    >
      {/* `attached` joins the three into one control, so it reads as a single field with two ends
          rather than as a button, a box and another button that happen to be adjacent. */}
      <Group attached>
        <NumberInput.DecrementTrigger asChild>
          <IconButton
            type="button"
            size={size}
            variant="outline"
            disabled={disabled}
            aria-label={t("quantityInput.decrease")}
            data-testid={testId ? `${testId}-minus` : undefined}
          >
            <Icon as={Minus} boxSize="3.5" />
          </IconButton>
        </NumberInput.DecrementTrigger>

        {/* Square ends: it is the middle of a joined control, so `Group attached` rounds the
            OUTSIDE of the two buttons and this stays flat on both sides. */}
        <NumberInput.Input
          w={width}
          textAlign="center"
          px="1"
          data-testid={testId}
          aria-label={rest["aria-label"]}
        />

        <NumberInput.IncrementTrigger asChild>
          <IconButton
            type="button"
            size={size}
            variant="outline"
            disabled={disabled}
            aria-label={t("quantityInput.increase")}
            data-testid={testId ? `${testId}-plus` : undefined}
          >
            <Icon as={Plus} boxSize="3.5" />
          </IconButton>
        </NumberInput.IncrementTrigger>
      </Group>
    </NumberInput.Root>
  );
}

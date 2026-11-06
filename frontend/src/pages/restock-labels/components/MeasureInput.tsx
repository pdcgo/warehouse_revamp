import { useEffect, useState } from "react";
import { Group, InputAddon, NumberInput } from "@chakra-ui/react";

// A MEASURE — mm or pt, halves allowed (1.5 mm of padding is a real setting), with its unit beside it. Chakra's
// NumberInput, as QuantityInput is; that one is whole numbers only, a sticker's millimetres are not.
//
// It holds the TYPED text while editing and hands the page a number only when it is one, so a box being cleared to type
// "2.5" does not snap back to the bound on the first keystroke; on leaving it, it settles on what the page kept.
export function MeasureInput({
  value,
  onChange,
  min,
  max,
  step = 0.5,
  unit,
  label,
  testId,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Said aloud — the field's own label when the input sits under one, else its name. */
  label: string;
  testId?: string;
}) {
  const [text, setText] = useState(String(value));

  // A value set from outside (reset to defaults) shows in the box.
  useEffect(() => {
    setText((prev) => (Number(prev) === value ? prev : String(value)));
  }, [value]);

  return (
    <Group attached w="auto">
      <NumberInput.Root
        value={text}
        min={min}
        max={max}
        step={step}
        size="xs"
        w="5.5rem"
        allowMouseWheel={false}
        clampValueOnBlur
        inputMode="decimal"
        formatOptions={{ maximumFractionDigits: 2, useGrouping: false }}
        onValueChange={(e) => {
          setText(e.value);
          if (e.value !== "" && Number.isFinite(e.valueAsNumber)) onChange(e.valueAsNumber);
        }}
        onFocusChange={(e) => {
          if (!e.focused) setText(String(value));
        }}
      >
        <NumberInput.Control />
        <NumberInput.Input aria-label={label} data-testid={testId} />
      </NumberInput.Root>
      {unit && (
        <InputAddon px="2" fontSize="xs" color="fg.muted">
          {unit}
        </InputAddon>
      )}
    </Group>
  );
}

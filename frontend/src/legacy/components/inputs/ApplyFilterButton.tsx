import { Box, Float, Circle } from "@chakra-ui/react";
import { Filter, RotateCcw } from "lucide-react";
import { Button } from "./Button";
import { isDirty } from "./filterDirty";

// A pulsing dot marking that the button has something to do. Shared by both buttons below so the
// "there are unsaved changes here" signal looks the same wherever it appears.
function DirtyDot({ tone }: { tone: "brand" | "orange" }) {
  return (
    <Float placement="top-end" offset="1">
      <Box position="relative" colorPalette={tone} data-testid="dirty-dot">
        {/* Two circles: one static, one pinging outward. The ping is what makes the dot register in
            peripheral vision — a filter form is usually being read, not looked at. */}
        <Circle size="2" bg="colorPalette.solid" position="absolute" animation="ping" />
        <Circle size="2" bg="colorPalette.solid" />
      </Box>
    </Float>
  );
}

export interface ApplyFilterButtonProps<K extends string = string> {
  // The draft the user is editing.
  value: Partial<Record<K, unknown>>;
  // What is currently applied to the list.
  applied: Partial<Record<K, unknown>>;
  // Which keys count. Defaults to the keys of `applied`.
  keys?: ReadonlyArray<K>;
  onClick?(): void;
  label?: string;
}

// ApplyFilterButton is the Apply button of a DEFERRED filter form — one where you set several
// filters and then apply them together.
//
// ⚠ Deferred filtering is the exception here, not the rule. Most lists in this app filter LIVE, and
// those use FilterBar with no Apply button at all. Deferred is right only when applying is expensive
// (a report over a year of movements) or when the filters only make sense as a set. Adding an Apply
// button to a live-filtering list makes every screen ask "did that take effect?".
//
// Where it IS right, the button's job is to answer one question at a glance: does what I am looking
// at match what is on screen below? So it is DISABLED when the draft equals the applied filters, and
// marked with a pulsing dot when it does not. A permanently-enabled Apply button cannot answer that
// question, and gets clicked reflexively.
export const description =
  "The Apply button of a DEFERRED filter form: disabled while the draft matches what is applied, dotted when it does not. Most lists here filter live and need no Apply at all.";

export function ApplyFilterButton<K extends string = string>({
  value,
  applied,
  keys,
  onClick,
  label = "Apply",
}: ApplyFilterButtonProps<K>) {
  const dirty = isDirty(value, applied, keys);

  return (
    <Button
      icon={Filter}
      tone="active"
      variant="subtle"
      position="relative"
      disabled={!dirty}
      onClick={onClick}
      data-testid="apply-filter"
      data-dirty={dirty ? "true" : "false"}
    >
      {label}
      {dirty && <DirtyDot tone="brand" />}
    </Button>
  );
}

export interface ResetFilterButtonProps<K extends string = string> {
  value: Partial<Record<K, unknown>>;
  // The values the form starts at.
  defaults: Partial<Record<K, unknown>>;
  keys?: ReadonlyArray<K>;
  onClick?(): void;
  label?: string;
}

// ResetFilterButton puts a filter form back to its defaults, and is disabled while it already is.
//
// It is deliberately a SEPARATE component from Apply rather than a variant, because it compares
// against something different: Apply asks "does the draft differ from what is APPLIED", Reset asks
// "does the draft differ from the DEFAULTS". Those diverge constantly — a form can be applied and
// still be far from its defaults — and one component with a mode flag would make it easy to pass
// the wrong baseline and never notice, since both produce a plausible-looking enabled button.
export const resetDescription =
  "Puts a filter form back to its defaults, disabled while it already is. Separate from Apply because it compares against the DEFAULTS, not against what is applied.";

export function ResetFilterButton<K extends string = string>({
  value,
  defaults,
  keys,
  onClick,
  label = "Reset",
}: ResetFilterButtonProps<K>) {
  const modified = isDirty(value, defaults, keys);

  return (
    <Button
      icon={RotateCcw}
      tone="plain"
      variant="outline"
      position="relative"
      disabled={!modified}
      onClick={onClick}
      data-testid="reset-filter"
      data-dirty={modified ? "true" : "false"}
    >
      {label}
      {modified && <DirtyDot tone="orange" />}
    </Button>
  );
}

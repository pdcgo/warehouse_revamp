import { Button, Icon, IconButton } from "@chakra-ui/react";
import { BarChart3, ChevronDown } from "lucide-react";

// THE STATISTIK BUTTON — what opens a list's statistics under its status tabs (owner, on the restock list: *"kurasa banyak
// ruang kosong"*, then *"samakan"* for the order list; a-statistics-button-ends-the-tab-row):
//
//   a desktop   Semua Status · Dibuat · Diproses · …                 [📊 Statistik ⌄]   ← the end of the tab row
//   a phone     [⌕ Cari …] [⚙ Filter] [📊]                                            ← an icon beside Filter
//
// It had a row of its own under the tabs, holding one small button. On a phone the tab row already scrolls sideways, so
// the button goes to the search row, where the other control that reshapes the list is, and is drawn in the main tone
// while open — an icon alone has no chevron to say so.
//
// It only says open or shut. The page holds the state, mounts the strip while open, and reads nothing before
// (the-statistics-are-shut-and-read-when-opened).
export const description =
  "The Statistik button that opens a list's statistics under its status tabs: at the end of the tab row on a desktop — an icon, the label and a chevron that turns — and, `compact`, an icon beside the Filter button on a phone, drawn in the main tone while open. It carries `aria-expanded`; the page holds the state and reads nothing until it is open.";

export function StatsToggle({
  open,
  onToggle,
  label,
  compact = false,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  /** *Statistik* — the button's text, and the icon's accessible name. */
  label: string;
  /** A phone's: the icon alone, for the search row. */
  compact?: boolean;
  testId?: string;
}) {
  if (compact) {
    return (
      <IconButton
        variant={open ? "subtle" : "outline"}
        colorPalette={open ? "brand" : "gray"}
        flexShrink={0}
        aria-label={label}
        aria-expanded={open}
        data-testid={testId}
        onClick={onToggle}
      >
        <Icon as={BarChart3} boxSize="4" />
      </IconButton>
    );
  }

  return (
    <Button variant="ghost" size="xs" flexShrink={0} aria-expanded={open} data-testid={testId} onClick={onToggle}>
      <Icon as={BarChart3} boxSize="4" />
      {label}
      <Icon
        as={ChevronDown}
        boxSize="4"
        color="fg.muted"
        transform={open ? "rotate(180deg)" : undefined}
        transition="transform 120ms"
      />
    </Button>
  );
}

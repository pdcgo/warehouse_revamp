import { useState } from "react";
import { Button, HStack, Icon, Stack } from "@chakra-ui/react";
import { LogIn, Printer, Undo2 } from "lucide-react";
import { ChoiceTabs } from "../../../legacy/components/display/ChoiceTabs";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import { MovementTable } from "../_movement/MovementTable";
import type { MovementRow } from "../../fixtures";

// ── INBOUND ─────────────────────────────────────────────────────────────────────────────────────
//
// Goods arriving, in two tabs: new stock, and returns.
//
// ⚠ THE TWO TABS ARE ONE SCREEN AND THAT IS DEFENSIBLE — but only because of what they share, which
// is the physical act. Both are "a box arrived at the receiving bench, open it, count it, decide
// where it goes". The person doing it is the same person doing the same thing, so splitting them
// across two menu items would mean choosing before you have opened the box.
//
// What differs is entirely downstream: a return's units may not be sellable, and its reason belongs
// to the customer rather than the supplier. That shows up as a different STATUS VOCABULARY (see
// status.ts) and different destinations, not as a different screen.
//
// ── WHY THE TABS ARE A FILTER, NOT NAVIGATION ───────────────────────────────────────────────────
//
// ChoiceTabs, not NavTabs. The receiving bench flips between these many times an hour while working
// through a pallet; navigation tabs would put a history entry behind every flip, so backing out of
// the screen means pressing back once per flip.
export const description =
  "Goods arriving — new stock and returns as two tabs of one screen, because both are the same physical act at the same bench. The tabs are a filter, not navigation.";

export type InboundTab = "inbound" | "return";

export interface InboundPageProps {
  inbound: MovementRow[];
  returns: MovementRow[];
  tab?: InboundTab;
  loading?: boolean;
}

export function InboundPage({ inbound, returns, tab: initial = "inbound", loading }: InboundPageProps) {
  const [tab, setTab] = useState<InboundTab>(initial);

  const rows = tab === "inbound" ? inbound : returns;
  const pending = (list: MovementRow[]) => list.filter((r) => r.status === "ongoing").length;

  return (
    <Stack gap="section" p="page" data-testid="inbound-page">
      <ScreenHeader
        icon={LogIn}
        title="Inbound"
        actions={
          // Printing barcodes is a RECEIVING action: the label goes on as the box is opened, before
          // the goods reach a shelf. It belongs on this screen and not in a printing section.
          <Button size="xs" variant="outline" data-testid="print-barcodes">
            <Icon as={Printer} boxSize="4" />
            Print barcodes
          </Button>
        }
      />

      <HStack>
        <ChoiceTabs
          value={tab}
          onChange={(v) => v && setTab(v)}
          items={[
            // ⚠ THE BADGE IS WHAT IS OUTSTANDING, NOT THE TOTAL. "Inbound 4" where 4 is everything
            // ever received tells the bench nothing; the number they act on is what is still in
            // transit and will land on them today.
            { value: "inbound" as const, name: "New stock", icon: LogIn, badge: pending(inbound) },
            { value: "return" as const, name: "Returns", icon: Undo2, badge: pending(returns) },
          ]}
        />
      </HStack>

      <MovementTable
        direction={tab === "inbound" ? "inbound" : "return"}
        rows={rows}
        loading={loading}
        emptyTitle={tab === "inbound" ? "Nothing arriving" : "No returns"}
      />
    </Stack>
  );
}

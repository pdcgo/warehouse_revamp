import type { ReactNode } from "react";
import { Badge } from "@chakra-ui/react";

// A COUNT IN PCS, HIGHLIGHTED — and only the count (owner: *"pcsnya kebesaran, highlightnya n pcs saja entah di produk
// dan di atas"*, the-pcs-alone-is-highlighted). Its words around it stay plain text; the figure sits in a small badge of
// its tone, at the text's own size — found at a glance without shouting. One shape for a line's *Dipesan 12 pcs* and the
// header's *0 dari 17 pcs di dalam paket*.
export function PcsMark({ tone, testId, children }: { tone: string; testId?: string; children: ReactNode }) {
  return (
    <Badge colorPalette={tone} variant="subtle" size="md" fontWeight="bold" flexShrink={0} data-tone={tone} data-testid={testId}>
      {children}
    </Badge>
  );
}

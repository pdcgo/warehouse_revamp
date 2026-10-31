import type { LucideIcon } from "lucide-react";
import { FlaskConical, Star, Tag } from "lucide-react";

import type { ProductDivision } from "./discoverSample";

// PRIORITAS · RISET · UMUM — each division's colour and icon, ONE place, read by the card's badge, the filter's chip and
// the discover detail's title alike (owner: *"prioritas riset dan umum ada iconnya"*, then *"pill … prioritas, riset dll
// ada iconnya"*), so the chip a seller clicks and the badge it narrows to carry the same mark
// (`prioritas-is-primary-riset-is-warning`).
//
// Prioritas the app's primary indigo with a star, Riset the warning amber with a flask, Umum teal with a tag. Two are ROLE
// names because the owner chose them by role — a palette change to primary or warning repaints them on purpose.
export const DIVISION: Record<ProductDivision, { palette: string; icon: LucideIcon }> = {
  priority: { palette: "primary", icon: Star },
  research: { palette: "warning", icon: FlaskConical },
  general: { palette: "teal", icon: Tag },
};

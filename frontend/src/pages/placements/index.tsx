import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";

// PlacementsPage is a deliberate STUB (#95). "Placements" means where stock physically sits — rack
// and bin locations — which belongs to the warehouse core (plans/plan.md §1) and is not designed
// yet. The route and menu item exist so the Inventories sub-menu is complete; this is where it lands
// until warehouse locations are designed.
export function PlacementsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-section" data-testid="placements-page">
      <h1 className="text-[22px] font-bold">{t("inventory.placementsTitle")}</h1>

      <div className="flex flex-col items-center gap-card py-10 text-fg-muted">
        <MapPin className="size-8" />
        <p className="font-medium">{t("inventory.placementsComingSoon")}</p>
        <p className="max-w-md text-center text-sm">{t("inventory.placementsBody")}</p>
      </div>
    </div>
  );
}

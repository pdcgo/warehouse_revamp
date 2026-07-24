import { useMemo } from "react";
import { Select } from "./ui/Select";
import { Marketplace } from "../gen/warehouse/marketplace/v1/marketplace_pb";

// marketplaceLabel is the shared display name for a marketplace — used by the picker below and by
// callers that show a shop's marketplace read-only (e.g. a table cell).
export function marketplaceLabel(m: Marketplace): string {
  switch (m) {
    case Marketplace.SHOPEE:
      return "Shopee";
    case Marketplace.TOKOPEDIA:
      return "Tokopedia";
    case Marketplace.LAZADA:
      return "Lazada";
    case Marketplace.TIKTOK:
      return "TikTok";
    case Marketplace.BLIBLI:
      return "Blibli";
    case Marketplace.BUKALAPAK:
      return "Bukalapak";
    case Marketplace.OTHER:
      return "Other";
    default:
      return "Unspecified";
  }
}

// The marketplaces a shop may be on — UNSPECIFIED is excluded (it is the "not picked" sentinel).
export const MARKETPLACES: Marketplace[] = [
  Marketplace.SHOPEE,
  Marketplace.TOKOPEDIA,
  Marketplace.LAZADA,
  Marketplace.TIKTOK,
  Marketplace.BLIBLI,
  Marketplace.BUKALAPAK,
  Marketplace.OTHER,
];

export interface MarketplaceSelectProps {
  value?: Marketplace;
  onChange?: (m: Marketplace) => void;
  placeholder?: string;
  disabled?: boolean;
}

// MarketplaceSelect is the shared marketplace picker (#66), built on Chakra's composable Select. It
// emits a Marketplace enum, so callers work in the enum, not strings.
export const description = "Marketplace picker (Select). Emits a Marketplace enum (a shop's storefront).";

export function MarketplaceSelect({
  value,
  onChange,
  placeholder = "Select a marketplace",
  disabled,
}: MarketplaceSelectProps) {
  const options = useMemo(
    () => MARKETPLACES.map((m) => ({ label: marketplaceLabel(m), value: String(m) })),
    [],
  );

  return (
    <Select
      data-testid="marketplace-select"
      disabled={disabled}
      value={value !== undefined && value !== Marketplace.UNSPECIFIED ? String(value) : ""}
      onChange={(e) => {
        if (e.target.value !== "") onChange?.(Number(e.target.value) as Marketplace);
      }}
    >
      <option value="" disabled>
        {placeholder}
      </option>

      {/* No Portal on purpose: this Select is used inside a modal Dialog (ShopFormDialog), and a
          portalled listbox renders OUTSIDE the dialog where the modal makes it inert/aria-hidden —
          invisible to the a11y tree and unclickable. Rendering inline keeps it inside the dialog. */}
      {options.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </Select>
  );
}

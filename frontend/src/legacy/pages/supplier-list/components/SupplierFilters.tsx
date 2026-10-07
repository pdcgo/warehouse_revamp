import { NativeSelect } from "@chakra-ui/react";
import { CITIES, PROVINCES } from "../../../fixtures";

// The geographic narrowing. Suppliers are chosen by WHERE THEY SHIP FROM — a Bandung supplier and a
// Surabaya one are different propositions for the same product — so province and city are the
// primary filters on this screen, ahead of the name.
//
// The city list is DERIVED from the province, which is why the two are one component rather than two
// independent pickers: offering every city in the country beside a chosen province is how you get a
// filter pair that returns nothing and looks broken.
export const description =
  "Province and city filters for the supplier list. The city list is derived from the province, so the pair can never describe somewhere that does not exist.";

export interface SupplierFiltersProps {
  province?: string;
  city?: string;
  onProvinceChange(province?: string): void;
  onCityChange(city?: string): void;
}

export function SupplierFilters({
  province,
  city,
  onProvinceChange,
  onCityChange,
}: SupplierFiltersProps) {
  const cities = province ? (CITIES[province] ?? []) : [];

  return (
    <>
      <NativeSelect.Root width="44" data-testid="filter-province">
        <NativeSelect.Field
          placeholder="All provinces"
          value={province ?? ""}
          onChange={(e) => onProvinceChange(e.target.value || undefined)}
          aria-label="Province"
        >
          {PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>

      {/* Disabled rather than empty when no province is chosen: an enabled picker with nothing in it
          reads as a list that failed to load, where a disabled one reads as "pick a province first" —
          which is the actual state. The flag sits on the Root, which is what owns the disabled slot
          styling; the Field only accepts the underscore state props. */}
      <NativeSelect.Root width="40" disabled={!province} data-testid="filter-city">
        <NativeSelect.Field
          placeholder={province ? "All cities" : "Province first"}
          value={city ?? ""}
          onChange={(e) => onCityChange(e.target.value || undefined)}
          aria-label="City"
        >
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </>
  );
}

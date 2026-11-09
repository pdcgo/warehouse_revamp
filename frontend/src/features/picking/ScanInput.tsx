import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@chakra-ui/react";

// THE SCANNER'S FIELD. A handheld scanner (owner: *"scanner"*) types the code and presses Enter, so the
// field takes the text, hands it over on Enter, and empties itself for the next parcel — focus stays,
// because the crew is looking at the parcels, not the screen.
//
// Shared by the warehouse's order list (Scan Label, the handover, Find Parcel) and the pick page's item scan
// (the-item-scans-live-on-the-page), so a scan behaves the same wherever the gun is pointed.
export function ScanInput({
  onScan,
  testId,
  label,
}: {
  onScan: (code: string) => void;
  testId: string;
  /** What the field takes, said aloud — the placeholder's words when absent. */
  label?: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const placeholder = t("warehouseOrders.scan.placeholder");

  return (
    <Input
      autoFocus
      value={value}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      fontFamily="mono"
      data-testid={testId}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();

        const code = value.trim();
        setValue("");
        if (code !== "") onScan(code);
      }}
    />
  );
}

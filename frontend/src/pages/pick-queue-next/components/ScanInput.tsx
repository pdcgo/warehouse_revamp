import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@chakra-ui/react";

// THE SCANNER'S FIELD. A handheld scanner (owner: *"scanner"*) types the code and presses Enter, so the
// field takes the text, hands it over on Enter, and empties itself for the next parcel — focus stays,
// because the crew is looking at the parcels, not the screen.
export function ScanInput({ onScan, testId }: { onScan: (code: string) => void; testId: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  return (
    <Input
      autoFocus
      value={value}
      placeholder={t("warehouseOrders.scan.placeholder")}
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

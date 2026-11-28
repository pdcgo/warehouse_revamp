import { Field, Textarea } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

// THE WAREHOUSE'S LOCATION — its address, free text, saved with the weekly hours (WarehouseInfoUpdate). ONE field for
// both doors that edit the profile (the-warehouse-sets-its-own-hours-in-settings): root's Teams → Edit warehouse and the
// warehouse owner's and admin's own Settings. Each page keeps its own test id.
export function WarehouseLocationField({
  value,
  onChange,
  testId,
  disabled,
}: {
  value: string;
  onChange: (location: string) => void;
  testId: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Field.Root>
      <Field.Label>{t("teams.location")}</Field.Label>
      <Textarea value={value} disabled={disabled} data-testid={testId} onChange={(e) => onChange(e.target.value)} />
      <Field.HelperText>{t("teams.warehouseAddressHelp")}</Field.HelperText>
    </Field.Root>
  );
}

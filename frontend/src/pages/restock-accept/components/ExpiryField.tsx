import { Box, Field, Flex, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { DatePicker, dateInputToUnix } from "../../../components/datetime/DatePicker";
import { ExpiryLeft } from "../../../features/inventory/ExpiryCell";

// THE LINE'S EXPIRY, READ OFF THE BOX (the-warehouse-types-the-expiry-at-the-accept) — in *Yang tiba*, under the two
// counts: it is typed by the person counting, about what arrived. Optional, one date per line; a box mixing several
// printed dates takes the SOONEST, which the hint says.
//
//   Tanggal kedaluwarsa (opsional)
//   [📅 29 Nov 2026     × ]  20 hari lagi        ← how long is left, as the batch screens say it
//   Tanggal di kotak berbeda-beda? Pilih yang paling awal.
//
// Once picked, how long is left reads as the batch screens read it (an-expiry-says-how-long-is-left): amber within 30
// days, red once past, quiet beyond; the day itself is on the picker. A past date is ALLOWED
// (the-expiry-prototypes-are-accepted: the box says what it says) and reads red. × clears it: a line with no date
// accepts as today. Nothing received leaves it open — the date then has no batch to land on and is not sent.
export function ExpiryField({
  productId,
  value,
  onChange,
}: {
  productId: bigint;
  /** `yyyy-mm-dd`, "" = none. */
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const testId = `accept-expiry-${productId}`;

  return (
    <Field.Root data-testid={testId}>
      <Field.Label>
        {t("restock.accept.expiry.label")}{" "}
        <Text as="span" color="fg.subtle" fontWeight="normal">
          {t("restock.accept.courier.optional")}
        </Text>
      </Field.Label>
      <Flex align="center" gap="3" wrap="wrap" w="full">
        {/* The picker at a date's width — the day in the app's format, and its × to clear. */}
        <Box w="44" flexShrink={0}>
          <DatePicker value={value} onChange={onChange} clearable testId={`${testId}-input`} />
        </Box>
        {value !== "" && (
          <Text fontSize="sm" fontWeight="medium" as="span">
            <ExpiryLeft unix={dateInputToUnix(value, false)} testId={`${testId}-left`} />
          </Text>
        )}
      </Flex>
      <Field.HelperText>{t("restock.accept.expiry.hint")}</Field.HelperText>
    </Field.Root>
  );
}

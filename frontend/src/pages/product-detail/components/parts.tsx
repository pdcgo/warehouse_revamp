import { HStack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { formatUnixDate } from "../../../lib/datetime";

// The small shared pieces of the product detail — the two "we do not know yet" renderers and a row's hover. Used by
// the page's own Info panel and by the tab panels beside this file, which is what makes them page components rather
// than one panel's. (The warehouse lens moved to features/products/WarehouseLens once the discover detail needed it.)

// A figure whose read has not answered yet. It renders as a dash with the reason beside it rather
// than as a 0: an unknown figure is not a zero one (#74), and a screen that prints Rp 0 where it means
// "I could not find out" is worse than one that says so.
export function Pending() {
  const { t } = useTranslation();

  return (
    <HStack gap="1.5">
      <Text color="fg.subtle" data-testid="stock-unknown">
        —
      </Text>
      <Text fontSize="xs" color="fg.subtle">
        {t("products.stat.pending")}
      </Text>
    </HStack>
  );
}

// A date, or "Never" — and, while the read is still in flight, neither. An undefined unix means the
// answer has not arrived; a 0 means it arrived and the answer is that this has never happened. They
// are different sentences and a screen that renders both as "Never" tells the second one as fact.
export function WhenOrNever({ unix }: { unix?: bigint }) {
  const { t } = useTranslation();

  if (unix === undefined) {
    return (
      <Text color="fg.subtle" data-testid="stock-unknown">
        —
      </Text>
    );
  }

  if (unix === 0n) {
    return <Text color="fg.muted">{t("products.stat.never")}</Text>;
  }

  return <Text>{formatUnixDate(unix)}</Text>;
}

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up); Chakra's `_hover` honours `data-hover`.
export const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

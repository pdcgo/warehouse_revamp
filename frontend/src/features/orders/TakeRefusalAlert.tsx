import { Alert, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { type TakeRefusal, refusalKind } from "./takeRefusal";

export const description =
  "Why the warehouse refused an order — its one reason, and every line it named with what that line wanted (and, when stock was short, what the warehouse holds; when a stock count holds some, what is free and which count holds the rest) — so the person fixes exactly those lines. Shown by the order form and the draft page when Create or Promote is refused at the take.";

// WHAT THE WAREHOUSE SAID, on the screen that placed the order (a-refusal-names-its-reason-and-every-line).
//
// A refused take means NO ORDER and NOTHING TAKEN — the order and the draw are one transaction (#149) — so this is not a
// warning to be overruled but the reason the button did nothing. It names the products, not their ids: the person is
// looking at a form of names, and has to find the line to change. `labelOf` is the page's own lookup, because only
// the page knows what each product is called on it; an id it cannot name still reads as `#id`.
export function TakeRefusalAlert({
  refusal,
  labelOf,
  testId = "take-refusal",
}: {
  refusal: TakeRefusal;
  labelOf: (productId: bigint) => string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const kind = refusalKind(refusal.reason);

  // A short line says what is there; a counted line says what is free and which count holds the rest; any other says
  // only what it wanted — "holds 0" would be a lie when it is the owner's rule that stops it.
  const lineText = (k: typeof kind, values: Record<string, string>) => {
    if (k === "notEnoughStock") return t("orderForm.refusal.lineShort", values);
    if (k === "beingCounted") return t("orderForm.refusal.lineCounted", values);

    return t("orderForm.refusal.lineWanted", values);
  };

  return (
    <Alert.Root status="error" data-testid={testId} data-reason={kind}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{t(`orderForm.refusal.${kind}.title`)}</Alert.Title>
        <Alert.Description>
          <Stack gap="1">
            <Text>{t(`orderForm.refusal.${kind}.help`)}</Text>
            {refusal.lines.map((line) => {
              const values = {
                name: labelOf(line.productId),
                wanted: line.wanted.toString(),
                available: line.available.toString(),
                count: (line.countingSessionId ?? 0n).toString(),
              };

              return (
                <Text key={line.productId.toString()} fontWeight="bold" data-testid={`${testId}-line-${line.productId}`}>
                  {lineText(kind, values)}
                </Text>
              );
            })}
          </Stack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

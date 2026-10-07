import type { ReactNode } from "react";
import { Flex, Icon, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Truck } from "lucide-react";

import { formatUnixDateTime } from "../../../lib/datetime";
import { CopyText } from "../../../components/chrome/CopyText";
import type { TrailEvent } from "../shipmentMock";
import { Fact, SectionEmpty } from "./Section";
import { Rail } from "./Rail";

// ONE LEG OF THE PARCEL'S JOURNEY — out to the buyer, or back from them.
//
// ⚠ BOTH LEGS HAVE THE SAME SHAPE, and that is why they share a component (owner: *"resi bisa 2 dan
// jejak pengiriman juga bisa 2, dari order dan return"*). A courier, a tracking number, and the trail
// the courier reported. The order leg adds a ship-by deadline; a return has no deadline of ours.
//
// ⚠ A LEG WITH NO TRAIL SAYS SO. Most parcels carry no trail here — nothing reads the courier back yet
// — and a missing trail must read as "not recorded", not as "this screen does not show trails".
export function ShipmentLeg({
  title,
  courier,
  receiptCode,
  extra,
  trail,
  titleMark,
  receiptMark,
  trailMark,
  testId,
}: {
  title: string;
  /** ⚠ beside the leg's title — for a leg that is invented whole (the return). */
  titleMark?: ReactNode;
  /** ⚠ beside the resi — the printed number has no field. */
  receiptMark?: ReactNode;
  /** ⚠ beside the trail's label — nothing reads the courier back. */
  trailMark?: ReactNode;
  courier?: string;
  receiptCode?: string;
  /** A third fact — the order leg's ship-by deadline. */
  extra?: { label: string; value?: ReactNode; mark?: ReactNode };
  trail: TrailEvent[];
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="3" data-testid={testId}>
      <Flex gap="1" align="center">
        <Text fontWeight="bold" fontSize="sm">
          {title}
        </Text>
        {titleMark}
      </Flex>

      <SimpleGrid minChildWidth="9rem" gap="card">
        <Fact label={t("orders.shipping")}>
          {courier ? (
            <Flex gap="1.5" align="center">
              <Icon as={Truck} boxSize="3.5" color="fg.subtle" />
              {courier.toUpperCase()}
            </Flex>
          ) : undefined}
        </Fact>
        <Fact label={t("orders.receiptColumn")} mark={receiptMark}>
          {receiptCode ? <CopyText value={receiptCode} mono /> : undefined}
        </Fact>
        {extra && (
          <Fact label={extra.label} mark={extra.mark}>
            {extra.value}
          </Fact>
        )}
      </SimpleGrid>

      {/* The trail gets a label of its own, so its mark has something to sit beside. */}
      <Flex gap="1" align="center">
        <Text fontSize="xs" fontWeight="bold" color="fg.label">
          {t("orderDetail.shipping.trail")}
        </Text>
        {trailMark}
      </Flex>

      {trail.length === 0 ? (
        <SectionEmpty>{t("orderDetail.shipping.noTracking")}</SectionEmpty>
      ) : (
        // NEWEST FIRST — the question is "where is it now", and the answer is the top line.
        <Rail
          testId={`${testId}-trail`}
          items={[...trail].reverse().map((event) => ({
            key: event.at.toString(),
            title: event.text,
            meta: `${formatUnixDateTime(event.at)} · ${event.place}`,
          }))}
        />
      )}
    </Stack>
  );
}

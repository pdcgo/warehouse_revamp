import { Card, Field, Flex, Input, SimpleGrid } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { DatePicker } from "../../../components/datetime/DatePicker";
import { todayDateInput } from "../../../lib/datetime";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ORDER_FORM_PENDING } from "./pending";

// TWO OPTIONAL FACTS ABOUT THE ORDER.
//
// The marketplace's ship-by deadline — its "kirim sebelum", stored as `platform_shipment_deadline`
// (the-shipment-deadline-is-the-platforms-and-optional) — and the buyer's username on the marketplace, which the
// contract still has no field for, so it is typed here and dropped behind its mark.

interface ExtraInfoCardProps {
  deadline: string;
  onDeadlineChange: (value: string) => void;
  buyerUsername: string;
  onBuyerUsernameChange: (value: string) => void;
}

export function ExtraInfoCard({
  deadline,
  onDeadlineChange,
  buyerUsername,
  onBuyerUsernameChange,
}: ExtraInfoCardProps) {
  const { t } = useTranslation();

  return (
    <Card.Root>
      <Card.Header>
        <Card.Title>{t("orderForm.extra.title")}</Card.Title>
        <Card.Description>{t("orderForm.extra.help")}</Card.Description>
      </Card.Header>

      <Card.Body>
        {/* ⚠ THE BADGE IS ON THE FIELD, NOT ON THE CARD. These are two unrelated facts that happen to share a
            box, so only the one that is still dropped carries a mark. */}
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" alignItems="start">
          <Field.Root>
            <Field.Label>{t("orderForm.extra.deadline")}</Field.Label>
            {/* Clearable: an optional date that cannot be unset is a date somebody is stuck with.
                WITH THE CLOCK (owner): "before Friday" and "before Friday 12:00" are different
                promises, and the buyer who asks for one is usually asking for the second. */}
            {/* ⚠ NEVER IN THE PAST (owner). A deadline is a promise about what is still to come;
                yesterday is not a promise anybody can keep, and the same helper answers both ends of
                the rule so the two cannot disagree at midnight. */}
            <DatePicker
              value={deadline}
              onChange={onDeadlineChange}
              withTime
              clearable
              min={todayDateInput()}
              testId="order-create-deadline"
            />
            <Field.HelperText>{t("orderForm.extra.deadlineHelp")}</Field.HelperText>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Flex align="center" gap="2" wrap="wrap">
                {t("orderForm.extra.buyerUsername")}
                <NotImplemented list={ORDER_FORM_PENDING} id="buyerUsername" />
              </Flex>
            </Field.Label>
            <Input
              value={buyerUsername}
              maxLength={100}
              placeholder={t("orderForm.extra.buyerUsernamePlaceholder")}
              data-testid="order-create-buyer-username"
              onChange={(e) => onBuyerUsernameChange(e.target.value)}
            />
            <Field.HelperText>{t("orderForm.extra.buyerUsernameHelp")}</Field.HelperText>
          </Field.Root>
        </SimpleGrid>
      </Card.Body>
    </Card.Root>
  );
}

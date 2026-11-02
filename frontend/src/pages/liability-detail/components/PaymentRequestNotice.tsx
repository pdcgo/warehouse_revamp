import { Alert, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import type { LiabilityPaymentRequest } from "../../../gen/warehouse/liability/v1/liability_pb";
import { formatRupiah } from "../../../lib/money";
import { fmtDate } from "../format";

// THE OPEN PAYMENT REQUEST on this pair (a-creditor-may-request-payment). To the DEBTOR it is a warning — the
// counterparty asks it to pay, and it pays through Make Payment or does not; nothing moves by itself. To the CREDITOR
// it is a quiet line saying what it asked and when. The amount is the figure at the moment of asking, not a live one.
export function PaymentRequestNotice({
  request,
  teamId,
  counterpartyName,
}: {
  request: LiabilityPaymentRequest | undefined;
  teamId: bigint;
  counterpartyName: string;
}) {
  const { t } = useTranslation();

  if (!request) {
    return null;
  }

  const amount = formatRupiah(request.amount);
  const date = fmtDate(request.requestedAtUnix);

  if (request.debtorTeamId === teamId) {
    return (
      <Alert.Root status="warning" colorPalette="warning" data-testid="liability-detail-payment-request">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{t("liabilityDetail.requestAskedTitle", { name: counterpartyName, amount })}</Alert.Title>
          <Alert.Description>{t("liabilityDetail.requestAskedHelp", { date })}</Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  return (
    <Text fontSize="sm" color="fg.muted" data-testid="liability-detail-payment-requested">
      {t("liabilityDetail.requestSent", { name: counterpartyName, amount, date })}
    </Text>
  );
}

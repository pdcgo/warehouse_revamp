import { useTranslation } from "react-i18next";
import { Card, Field, Input, Stack, Text } from "@chakra-ui/react";
import { ShippingSelect } from "../../components/ShippingSelect";

export interface CustomerShippingProps {
  /** data-testid prefix — "order-create" on the form, "draft" on a draft. */
  idPrefix?: string;
  customerName: string;
  onCustomerNameChange: (value: string) => void;
  customerPhone: string;
  onCustomerPhoneChange: (value: string) => void;
  shippingCode: string;
  onShippingCodeChange: (value: string) => void;
}

// WHO THE ORDER IS FOR AND HOW IT TRAVELS — its own card, and its own file (owner).
//
// The three fields belong together for one reason: they are all answers about the PERSON receiving
// the parcel. Who they are, how to reach them, and which courier is bringing it. Nothing here is
// derived and nothing here is arithmetic — the customer's name is the only field on the whole form
// that gates the Create button, and the only one of the three a draft must have before it promotes.
//
// The shipping COST has been removed from the order form (owner). It is not gone from an order — the
// contract and the column still carry it, historical orders still read theirs, the detail page still
// shows it, and a DRAFT still carries the figure the marketplace charged — it is simply no longer
// typed in here, so a new order places at `total = subtotal`.
export function CustomerShipping(props: CustomerShippingProps) {
  const {
    idPrefix = "order-create",
    customerName,
    onCustomerNameChange,
    customerPhone,
    onCustomerPhoneChange,
    shippingCode,
    onShippingCodeChange,
  } = props;
  const { t } = useTranslation();

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <Text fontWeight="medium">{t("orders.customerAndShipping")}</Text>

          <Field.Root required>
            <Field.Label>{t("orders.customerName")}</Field.Label>
            <Input
              value={customerName}
              data-testid={`${idPrefix}-customer-name`}
              onChange={(e) => onCustomerNameChange(e.target.value)}
            />
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("orders.phone")}</Field.Label>
            <Input
              value={customerPhone}
              data-testid={`${idPrefix}-customer-phone`}
              onChange={(e) => onCustomerPhoneChange(e.target.value)}
            />
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("orders.shipping")}</Field.Label>
            <ShippingSelect value={shippingCode} onChange={onShippingCodeChange} />
          </Field.Root>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

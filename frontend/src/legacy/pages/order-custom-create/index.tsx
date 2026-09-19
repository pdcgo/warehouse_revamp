import { useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Breadcrumb } from "../../components/display/Breadcrumb";
import { Card } from "../../components/display/Card";
import { Button } from "../../components/inputs/Button";
import { Field } from "../../components/inputs/Field";
import { RadioGroup } from "../../components/inputs/RadioGroup";
import { TextInput } from "../../components/inputs/TextInput";
import { Textarea } from "../../components/inputs/TextInput";
import { Phone, Store, Users } from "lucide-react";

// Raising a custom order by hand.
//
// The SOURCE is a radio group rather than a dropdown, and that is the one decision here worth
// stating. The three sources are not interchangeable labels — they change who is accountable for the
// money and how the order is reconciled later: a phone order is owed by a customer, a reseller order
// is against an account, a staff purchase comes out of someone's pay. Choosing wrongly is a
// reconciliation problem discovered weeks later, so each option carries a sentence saying what it
// means. A dropdown would hide those sentences behind a click.
export const description =
  "Raising a custom order by hand. The source is a radio group with an explanation per option, because the three are not interchangeable labels — they decide who owes the money and how it reconciles.";

const SOURCES = [
  {
    value: "phone" as const,
    label: "Phone order",
    icon: Phone,
    description: "A customer ordered directly. The money is owed by them.",
  },
  {
    value: "reseller" as const,
    label: "Reseller",
    icon: Store,
    description: "Against a reseller account. Settled on their statement, not per order.",
  },
  {
    value: "staff" as const,
    label: "Staff purchase",
    icon: Users,
    description: "Bought by a team member. Deducted from pay rather than invoiced.",
  },
];

type Source = (typeof SOURCES)[number]["value"];

export interface OrderCustomCreatePageProps {
  onSubmit?(values: { buyer: string; source: Source; note: string }): void;
  busy?: boolean;
}

export function OrderCustomCreatePage({ onSubmit, busy }: OrderCustomCreatePageProps) {
  const [buyer, setBuyer] = useState("");
  const [source, setSource] = useState<Source>("phone");
  const [note, setNote] = useState("");

  return (
    <Stack gap="section" maxW="2xl" data-testid="order-custom-create-page">
      <Breadcrumb
        items={[{ href: "/order-customs", name: "Custom orders" }, { name: "New" }]}
      />
      <Heading size="md">New Custom Order</Heading>

      <Card>
        <Stack gap="section">
          <Field label="Buyer" required hint="The person or account this order is for.">
            <TextInput value={buyer} onChange={setBuyer} data-testid="custom-buyer" />
          </Field>

          <Stack gap="field">
            <Text fontSize="sm" fontWeight="medium">
              Source
            </Text>
            <RadioGroup<Source> items={SOURCES} value={source} onChange={setSource} />
          </Stack>

          <Field label="Note" hint="Why this order was raised by hand. Read during reconciliation.">
            <Textarea value={note} onChange={setNote} rows={3} data-testid="custom-note" />
          </Field>

          <HStack justify="flex-end" gap="2">
            <Button tone="plain" variant="ghost" href="/order-customs">
              Cancel
            </Button>
            <Button
              disabled={buyer.trim().length === 0}
              loading={busy}
              onClick={() => onSubmit?.({ buyer, source, note })}
              data-testid="custom-submit"
            >
              Create order
            </Button>
          </HStack>
        </Stack>
      </Card>
    </Stack>
  );
}

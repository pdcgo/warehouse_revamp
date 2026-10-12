import { useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Breadcrumb } from "../../components/display/Breadcrumb";
import { Card } from "../../components/display/Card";
import { Alert } from "../../components/display/Alert";
import { Button } from "../../components/inputs/Button";
import { Field } from "../../components/inputs/Field";
import { TextInput } from "../../components/inputs/TextInput";
import { ShopText } from "../../components/text/ShopText";
import { PriceText } from "../../components/text/PriceText";
import type { OrderRow } from "../../fixtures";

// Finishing a draft: filling in exactly the fields that were missing, and nothing else.
//
// ⚠ THE FORM SHOWS ONLY WHAT IS MISSING. The obvious build — a full order edit form with the known
// fields pre-filled — is worse in the way that matters: the operator has to work out which boxes are
// the ones blocking the order, among a dozen that are already fine. Showing three empty fields makes
// that a two-second job.
//
// What is already known is shown as READ-ONLY context above the form, so they can check they are
// finishing the right draft without being invited to edit it.
export const description =
  "Finishing a draft — shows ONLY the fields that were missing, with what is already known as read-only context above. A full edit form would make the operator hunt for which boxes are blocking it.";

export interface MissingField {
  key: string;
  label: string;
  hint?: string;
}

export interface OrderDraftFinishPageProps {
  draft: OrderRow;
  // The fields blocking this draft. Driven by the server in a wired version; the point is that the
  // form is built FROM it rather than being a fixed shape.
  missing: MissingField[];
  onSubmit?(values: Record<string, string>): void;
  busy?: boolean;
}

export function OrderDraftFinishPage({
  draft,
  missing,
  onSubmit,
  busy,
}: OrderDraftFinishPageProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  const complete = missing.every((field) => (values[field.key] ?? "").trim().length > 0);

  return (
    <Stack gap="section" maxW="2xl" data-testid="order-draft-finish-page">
      <Breadcrumb
        items={[
          { href: "/order-drafts", name: "Draft orders" },
          { name: draft.code },
        ]}
      />
      <Heading size="md">Finish {draft.code}</Heading>

      <Alert tone="warning" icon={TriangleAlert}>
        {missing.length} detail{missing.length === 1 ? "" : "s"} still needed before this order can
        ship.
      </Alert>

      {/* Read-only context: enough to confirm this is the right draft, without inviting an edit. */}
      <Card>
        <HStack gap="section" wrap="wrap" data-testid="draft-context">
          <Stack gap="0.5" minW="40">
            <Text fontSize="xs" color="fg.muted">
              Shop
            </Text>
            <ShopText name={draft.shopName} marketplace={draft.marketplace} />
          </Stack>
          <Stack gap="0.5" minW="32">
            <Text fontSize="xs" color="fg.muted">
              Items
            </Text>
            <Text>{draft.itemCount}</Text>
          </Stack>
          <Stack gap="0.5" minW="32">
            <Text fontSize="xs" color="fg.muted">
              Value
            </Text>
            <PriceText amount={draft.total} />
          </Stack>
        </HStack>
      </Card>

      <Card>
        <Stack gap="card">
          {missing.map((field) => (
            <Field key={field.key} label={field.label} hint={field.hint} required>
              <TextInput
                value={values[field.key] ?? ""}
                onChange={(v) => setValues((cur) => ({ ...cur, [field.key]: v }))}
                data-testid={`draft-field-${field.key}`}
              />
            </Field>
          ))}

          <Button
            icon={CircleCheck}
            // Blocked until every blocking field has something in it — submitting a partly-finished
            // draft just produces the same draft again, one field better.
            disabled={!complete}
            loading={busy}
            onClick={() => onSubmit?.(values)}
            data-testid="draft-finish-submit"
          >
            Finish order
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}

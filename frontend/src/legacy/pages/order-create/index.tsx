import { useState } from "react";
import { Heading, HStack, IconButton, Icon, Stack, Text } from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { Breadcrumb } from "../../components/display/Breadcrumb";
import { Card } from "../../components/display/Card";
import { Button } from "../../components/inputs/Button";
import { Field } from "../../components/inputs/Field";
import { TextInput } from "../../components/inputs/TextInput";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { PriceText } from "../../components/text/PriceText";
import { FormDetail } from "../../layout/FormDetail";
import type { OrderLine } from "../../fixtures";

// Creating an order by hand — for the phone order, the walk-in, the marketplace import that failed.
//
// The screen is built on `FormDetail` because of what it is: a LONG form whose totals change with
// every line. That layout keeps the running total in view — beside the form when there is room, and
// as a sticky strip when there is not — instead of dropping it below, which is where you cannot see
// it precisely while adding the lines that change it.
//
// The line table is EDITABLE IN PLACE rather than a dialog per line. Adding six lines through six
// dialogs is six round trips of open-fill-confirm for what is really one continuous act of typing.
export const description =
  "Hand-building an order. Uses FormDetail so the running total stays in view while lines are added, and edits lines in place rather than through a dialog each.";

interface DraftLine extends Omit<OrderLine, "id"> {
  key: number;
}

export interface OrderCreatePageProps {
  onSubmit?(lines: DraftLine[]): void;
  busy?: boolean;
}

export function OrderCreatePage({ onSubmit, busy }: OrderCreatePageProps) {
  const [customer, setCustomer] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [nextKey, setNextKey] = useState(1);

  const subtotal = lines.reduce((sum, l) => sum + l.price * BigInt(l.qty), 0n);
  const shipping = lines.length > 0 ? 32_000n : 0n;

  function addLine() {
    setLines((current) => [
      ...current,
      { key: nextKey, productName: "", refId: "", variant: "", qty: 1, price: 0n },
    ]);
    setNextKey((k) => k + 1);
  }

  return (
    <Stack gap="section" data-testid="order-create-page">
      <Breadcrumb items={[{ href: "/orders", name: "Orders" }, { name: "New order" }]} />
      <Heading size="md">New Order</Heading>

      <FormDetail
        figures={[
          { name: "Subtotal", value: subtotal },
          { name: "Shipping", value: shipping },
          { name: "Total", value: subtotal + shipping },
        ]}
        summary={
          <Stack gap="2" data-testid="order-create-summary">
            <Text fontWeight="medium">Summary</Text>
            <HStack justify="space-between">
              <Text fontSize="sm" color="fg.muted">
                {lines.length} lines
              </Text>
              <PriceText amount={subtotal} />
            </HStack>
            <HStack justify="space-between">
              <Text fontSize="sm" color="fg.muted">
                Shipping
              </Text>
              <PriceText amount={shipping} />
            </HStack>
            <HStack justify="space-between" fontWeight="bold">
              <Text>Total</Text>
              <PriceText amount={subtotal + shipping} />
            </HStack>

            <Button
              onClick={() => onSubmit?.(lines)}
              loading={busy}
              // No lines means no order. Submitting an empty one produces a record nobody can act on.
              disabled={lines.length === 0}
              w="full"
              mt="2"
              data-testid="order-create-submit"
            >
              Create order
            </Button>
          </Stack>
        }
      >
        <Card>
          <Field label="Customer" required>
            <TextInput value={customer} onChange={setCustomer} data-testid="order-customer" />
          </Field>
        </Card>

        <Card>
          <Stack gap="card">
            <HStack justify="space-between">
              <Text fontWeight="medium">Lines</Text>
              <Button size="xs" variant="subtle" icon={Plus} onClick={addLine} data-testid="order-add-line">
                Add line
              </Button>
            </HStack>

            {lines.length === 0 ? (
              <EmptyHint title="No lines yet">Add the first product to this order.</EmptyHint>
            ) : (
              lines.map((line, i) => (
                <HStack key={line.key} gap="2" align="flex-end" data-testid="order-line">
                  <Field label={i === 0 ? "Product" : undefined}>
                    <TextInput
                      value={line.productName}
                      onChange={(v) =>
                        setLines((cur) => cur.map((l) => (l.key === line.key ? { ...l, productName: v } : l)))
                      }
                      placeholder="Product name"
                    />
                  </Field>
                  <Field label={i === 0 ? "Qty" : undefined}>
                    <TextInput
                      value={String(line.qty)}
                      onChange={(v) =>
                        setLines((cur) =>
                          cur.map((l) => (l.key === line.key ? { ...l, qty: Number(v) || 0 } : l)),
                        )
                      }
                      width="20"
                      inputMode="numeric"
                    />
                  </Field>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    colorPalette="red"
                    aria-label="Remove line"
                    data-testid={`order-remove-line-${line.key}`}
                    onClick={() => setLines((cur) => cur.filter((l) => l.key !== line.key))}
                  >
                    <Icon as={Trash2} boxSize="4" />
                  </IconButton>
                </HStack>
              ))
            )}
          </Stack>
        </Card>
      </FormDetail>
    </Stack>
  );
}

import { Clipboard, Icon } from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { ToneBadge } from "../badges/ToneBadge";
import { Tooltip } from "../feedback/Tooltip";
import { EntityCell } from "./EntityCell";

export interface SupplierCellData {
  id?: bigint | number;
  name?: string;
  // The short code an operator quotes on a purchase order or in a chat message.
  code?: string;
}

// SupplierCell is how a supplier appears in a table row: name, with its CODE click-to-copy beneath.
//
// Same reasoning as the product SKU: the code is the string that gets retyped — into a purchase
// order, a transfer note, a message asking where a delivery is — and it is short enough to mistype
// without noticing. One click beats a selection drag, every time.
export const description =
  "A supplier in a table row: name plus a click-to-copy code badge — the code being the string that actually gets quoted and retyped.";

export interface SupplierCellProps {
  supplier?: SupplierCellData;
  supplierId?: bigint | number;
  loading?: boolean;
}

export function SupplierCell({ supplier, supplierId, loading }: SupplierCellProps) {
  const id = supplier?.id ?? supplierId;

  return (
    <EntityCell
      loading={loading && !supplier}
      name={supplier?.name}
      fallback={id !== undefined ? `#${id}` : undefined}
      secondary={
        supplier?.code ? (
          <Clipboard.Root
            value={supplier.code}
            // Supplier rows open the supplier; copying the code must not also navigate.
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            w="fit-content"
          >
            <Clipboard.Context>
              {({ copied }) => (
                <Tooltip content={copied ? "Code copied" : "Copy code"}>
                  <Clipboard.Trigger asChild>
                    <ToneBadge tone="plain" cursor="pointer" gap="1" data-testid="supplier-code">
                      <Icon as={Copy} boxSize="3" />
                      {supplier.code}
                    </ToneBadge>
                  </Clipboard.Trigger>
                </Tooltip>
              )}
            </Clipboard.Context>
          </Clipboard.Root>
        ) : undefined
      }
    />
  );
}

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, Badge, Flex, Icon, IconButton, Input, Stack, Table, Text } from "@chakra-ui/react";
import { Package, Trash2 } from "lucide-react";
import { formatRupiah } from "../../lib/money";
import type { Costs, LineDraft, LineStock } from "./lines";
import { costKnown, lineTotal, unitCost } from "./lines";

export interface OrderLineRowProps {
  index: number;
  /** data-testid prefix — "order-line" on the order form, "draft-line" on a draft. */
  idPrefix?: string;
  line: LineDraft;
  stock: LineStock;
  /** productId -> HPP at the chosen warehouse. Undefined until the read lands. */
  costs?: Costs;

  /** Rendered ABOVE the product, inside the first cell. The draft's scraped evidence goes here; the
   * order form has none, because a product it picked from the catalogue IS the evidence. */
  evidence?: ReactNode;
  /** Replaces the static name + SKU block. A draft passes a `ProductSelect`: its line is a mapping
   * target that can be re-pointed, where the form's line is a product already chosen. */
  product?: ReactNode;
  /** Replaces the read-only HPP cell. A draft passes an editable price — the money on a draft is
   * what the marketplace charged, which is a fact only a person can correct. */
  price?: ReactNode;
  /** The product thumbnail. A draft turns it OFF: its line names a product by id and nothing more,
   * so the cover would be a grey placeholder on every row forever — chrome dressed as data, and an
   * indent that pushes the mapping control out of line with the evidence above it. */
  cover?: boolean;
  /** Overrides qty × HPP. Set it whenever `price` is set, or the row's total contradicts its price. */
  total?: bigint;

  onPatch: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}

// One row of an order's item TABLE (owner).
//
// It was a stack of cards — a ProductListItem with the controls crammed into its action slot — and
// the HPP had nowhere to live: a labelled figure floating between two inputs, aligned with nothing
// above or below it. Lines are a list of the same five facts repeated, which is what a table is for:
// the quantities form a column, the money forms a column, and the eye can run down either.
//
// SHARED by the order form and the draft detail (#196), through SLOTS rather than a fork. What the
// two screens genuinely differ about is small and local — the evidence above the product, whether
// the product is picked or mapped, whether the price is read or typed — while the thumbnail, the
// stock column, the quantity input and the remove button are identical on both. A second copy of
// this row is how one screen quietly stops showing a shortfall the other one does.
export function OrderLineRow(props: OrderLineRowProps) {
  const {
    index,
    idPrefix = "order-line",
    line,
    stock,
    costs,
    evidence,
    product,
    price,
    cover = true,
    total,
    onPatch,
    onRemove,
  } = props;
  const { t } = useTranslation();

  const cost = unitCost(line, costs);
  const known = costKnown(line, costs);
  const short = stock.kind === "known" && stock.short;

  return (
    <Table.Row data-testid={`${idPrefix}-${index}`}>
      <Table.Cell>
        {evidence}

        <Flex align="center" gap="card">
          {/* The same cover treatment ProductListItem uses — thumbnail first, full image as the
              fallback, the package icon when there is neither (or when a URL 404s). */}
          {cover && (
            <Avatar.Root shape="rounded" size="xs" colorPalette="gray" flexShrink={0}>
              <Avatar.Fallback>
                <Icon as={Package} boxSize="3" />
              </Avatar.Fallback>
              <Avatar.Image src={line.thumbnailUrl || line.imageUrl || undefined} alt={line.name} />
            </Avatar.Root>
          )}

          {product ?? (
            <Stack gap="0">
              <Text fontSize="sm">{line.name}</Text>
              <Text fontSize="xs" color="fg.muted">
                {line.sku}
              </Text>
            </Stack>
          )}
        </Flex>
      </Table.Cell>

      {/* WHAT THE SHELF HOLDS. Its own column rather than a badge beside the name: it is the number a
          quantity is judged against, so it belongs next to the quantity, not next to the label. */}
      <Table.Cell textAlign="end">
        {stock.kind === "known" ? (
          <Stack gap="0" align="end">
            <Text fontSize="sm" color={short ? "red.fg" : undefined} data-testid={`${idPrefix}-stock-${index}`}>
              {stock.ready.toString()}
            </Text>
            {short && (
              <Badge size="xs" colorPalette="red">
                {t("orders.lineShortBadge", { wanted: stock.wanted.toString() })}
              </Badge>
            )}
          </Stack>
        ) : (
          <Text fontSize="sm" color="fg.subtle">
            —
          </Text>
        )}
      </Table.Cell>

      <Table.Cell textAlign="end">
        <Input
          type="number"
          min="1"
          size="xs"
          w="16"
          textAlign="end"
          value={line.quantity}
          borderColor={short ? "red.solid" : undefined}
          data-testid={`${idPrefix}-qty-${index}`}
          onChange={(e) => onPatch({ quantity: e.target.value })}
        />
      </Table.Cell>

      {/* The HPP, READ not typed (owner). What the goods cost is a fact the warehouse recorded, not a
          number the person placing the order chooses — the same reasoning that already made
          `unit_cost` server-set and ignored on input (#74). A draft overrides this cell entirely. */}
      <Table.Cell textAlign="end" data-testid={price ? undefined : `${idPrefix}-hpp-${index}`}>
        {price ??
          (known ? (
            <Text fontSize="sm">{formatRupiah(cost)}</Text>
          ) : (
            // 0 is UNKNOWN, never free: a product received without a restock has no recorded cost, and
            // printing "Rp 0" would book it as costing nothing.
            <Text fontSize="sm" color="orange.fg">
              {t("orders.hppUnknown")}
            </Text>
          ))}
      </Table.Cell>

      <Table.Cell textAlign="end" data-testid={`${idPrefix}-total-${index}`}>
        {formatRupiah(total ?? lineTotal(line, costs))}
      </Table.Cell>

      <Table.Cell textAlign="end">
        <IconButton
          type="button"
          size="xs"
          variant="ghost"
          colorPalette="red"
          aria-label={t("orders.removeLine")}
          data-testid={`${idPrefix}-remove-${index}`}
          onClick={onRemove}
        >
          <Icon as={Trash2} boxSize="4" />
        </IconButton>
      </Table.Cell>
    </Table.Row>
  );
}

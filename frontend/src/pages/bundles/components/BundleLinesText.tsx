import { useTranslation } from "react-i18next";
import { Badge, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import type { Product } from "../../../gen/warehouse/product/v1/product_pb";
import { type BundleRecord, lineState, unavailable } from "../../../features/bundles/adapt";

// WHAT IS IN A BUNDLE, as one line of text — "1 × Beras Pandan Wangi 5kg · 2 × Gula Pasir 1kg".
//
// It is what tells two bundles of one name apart (bundle-names-may-repeat), so it is on every row, under no other
// heading than the products. Two lines at most (one-context-per-column-and-never-three-lines), the badge counting as
// one: a long recipe is cut, and the bundle's page shows it whole.
//
// A line its product can no longer fill — locked by its owner, or archived — is counted in a warning badge under the
// text (a-borrowed-product-never-blocks-its-owner): the bundle keeps it, and an order fills its slot with something
// else, which is worth knowing before the order form is where it is found out.
export function BundleLinesText({
  bundle,
  products,
  testId,
}: {
  bundle: BundleRecord;
  /** ProductByIds, keyed by product id. A product not (yet) resolved is named by its id. */
  products: Map<string, Product> | undefined;
  testId: string;
}) {
  const { t } = useTranslation();

  const parts = bundle.lines.map((line) => {
    const product = products?.get(line.productId.toString());
    const name = product ? product.name : t("bundles.productNumber", { id: line.productId.toString() });
    const archived = lineState(product, bundle.teamId) === "archived";

    return `${line.quantity} × ${name}${archived ? ` ${t("bundles.archivedSuffix")}` : ""}`;
  });

  const blocked = bundle.lines.filter((line) =>
    unavailable(lineState(products?.get(line.productId.toString()), bundle.teamId)),
  ).length;

  return (
    <Stack gap="1" minW="0">
      {/* The badge takes the second line when there is one — a cell is two lines, never three. */}
      <Text fontSize="sm" lineClamp={blocked > 0 ? 1 : 2} data-testid={testId}>
        {parts.join(" · ")}
      </Text>
      {blocked > 0 && (
        <HStack>
          <Badge colorPalette="warning" variant="subtle" data-testid={`${testId}-unavailable`}>
            <Icon as={TriangleAlert} boxSize="3" />
            {t("bundles.unavailableCount", { count: blocked })}
          </Badge>
        </HStack>
      )}
    </Stack>
  );
}

import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { Card, HStack, Link, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { MarketplaceBadge } from "../../../components/badges/MarketplaceBadge";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { DISCOVER_DETAIL_PENDING } from "../pending";
import { useProductSupplierSample } from "../sampleSuppliers";

// WHERE THE PRODUCT IS BOUGHT FROM — the supplier stores that list it, each with the selling team that keeps
// the supplier. Every team may see all of a supplier (another-team-sees-everything-of-a-supplier), and may
// restock from another team's supplier (a-team-restocks-from-another-teams-supplier) — so this is also
// where a borrower finds out it could buy the product in for itself.
//
// A supplier opens the supplier DISCOVER detail, not the manage one: it is usually another team's.
export function SuppliersCard({ teamId, productId }: { teamId: bigint; productId: bigint }) {
  const { t } = useTranslation();
  const { links, isPending } = useProductSupplierSample({ teamId, productId });

  return (
    <Card.Root data-testid="discover-detail-suppliers">
      <Card.Header>
        <HStack gap="1">
          <Card.Title>{t("discoverDetail.suppliersHeading")}</Card.Title>
          <NotImplemented list={DISCOVER_DETAIL_PENDING} id="suppliers" />
        </HStack>
        <Card.Description>{t("discoverDetail.suppliersHelp")}</Card.Description>
      </Card.Header>
      <Card.Body>
        {isPending ? (
          <Spinner colorPalette="brand" size="sm" />
        ) : links.length === 0 ? (
          <Text color="fg.muted" fontSize="sm" data-testid="discover-detail-suppliers-empty">
            {t("discoverDetail.noSuppliers")}
          </Text>
        ) : (
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("discoverDetail.supplier")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("discoverDetail.store")}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {links.map(({ supplier, channel }) => (
                <Table.Row key={`${supplier.id}-${channel.id}`} data-testid={`discover-supplier-${supplier.id}`}>
                  <Table.Cell>
                    {/* Two lines, one context: the supplier, and whose list it is on. */}
                    <Stack gap="0" minW="0">
                      <Link asChild fontWeight="medium" colorPalette="brand">
                        <RouterLink
                          to={`/inventories/suppliers/discover/${supplier.id}`}
                          data-testid={`discover-supplier-open-${supplier.id}`}
                        >
                          {supplier.name}
                        </RouterLink>
                      </Link>
                      <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                        {supplier.teamName}
                      </Text>
                    </Stack>
                  </Table.Cell>
                  <Table.Cell>
                    <HStack gap="2" minW="0">
                      <MarketplaceBadge marketplace={channel.channelType} />
                      <Text lineClamp={1}>{channel.name}</Text>
                    </HStack>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card.Body>
    </Card.Root>
  );
}

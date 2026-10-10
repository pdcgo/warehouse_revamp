import { useTranslation } from "react-i18next";
import { Card, Flex, Icon, Separator, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import type { DiscoverSupplier } from "../../../features/suppliers/discover";
import { ChannelTypes } from "../../../features/suppliers/ChannelTypes";
import { TeamItem } from "../../../components/entity/TeamItem";

// ONE SUPPLIER AS A CARD — Discover's default view (`discover-is-cards-or-a-table`), drawn after the owner's reference
// card (*"card 4, sama kasih panah itu di bawah kanan"*, `a-discover-card-reads-who-whose-where`):
//
//   PT Sumber Makmur                              ← the title
//   Jl. Soekarno-Hatta 112, Bandung               ← where it is, muted
//   ──────────────────────────────
//   [TM] Toko Melati                              ← whose it is — the team that keeps it
//        Selling
//   [Shopee] [Tokopedia] [Other]                  ← where it sells, or "Belum ada toko pemasok"
//   0812-1111-2222                            ↗   ← the contact, and the arrow that says the card opens
//
// The whole card opens the supplier's Discover detail, so it lights up under a pointer and while pressed
// (a-table-row-lights-up).
export function DiscoverSupplierCard({ supplier, onOpen }: { supplier: DiscoverSupplier; onOpen: () => void }) {
  const { t } = useTranslation();

  return (
    <Card.Root
      variant="outline"
      size="sm"
      cursor="pointer"
      _hover={{ bg: "bg.muted" }}
      _active={{ bg: "bg.muted" }}
      onClick={onOpen}
      data-testid={`discover-supplier-row-${supplier.id}`}
    >
      <Card.Header gap="1">
        <Card.Title lineClamp={1}>{supplier.name}</Card.Title>
        <Card.Description lineClamp={2} data-testid={`discover-card-address-${supplier.id}`}>
          {supplier.address || "—"}
        </Card.Description>
      </Card.Header>

      <Card.Body gap="3">
        <Separator />

        <TeamItem team={{ teamId: supplier.teamId, teamName: supplier.teamName, teamType: TeamType.SELLING }} />

        {/* A store-less supplier says so in words (a-phone-supplier-is-its-name-and-stores). */}
        {supplier.channels.length > 0 ? (
          <ChannelTypes channels={supplier.channels} />
        ) : (
          <Text fontSize="sm" color="fg.muted">
            {t("suppliers.noStores")}
          </Text>
        )}
      </Card.Body>

      <Card.Footer>
        <Flex justify="space-between" align="center" gap="2" w="full" minW="0">
          <Text fontSize="xs" color="fg.muted" lineClamp={1} data-testid={`discover-card-contact-${supplier.id}`}>
            {supplier.contact || t("suppliers.discover.noContact")}
          </Text>
          {/* ↗ — the card opens the supplier; the arrow says so, bottom right. */}
          <Icon as={ArrowUpRight} boxSize="4" color="fg.muted" flexShrink={0} aria-hidden="true" />
        </Flex>
      </Card.Footer>
    </Card.Root>
  );
}

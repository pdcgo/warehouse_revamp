import { useMemo, useState } from "react";
import { Heading, HStack, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Boxes, MapPin, Pencil, Plus, Rows3 } from "lucide-react";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { Card } from "../../components/display/Card";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSummary } from "../../components/display/ListSummary";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { SkeletonBlock } from "../../components/feedback/SkeletonBlock";
import type { WarehouseRow } from "../../fixtures";

// The warehouses — and the one screen in this family that is CARDS rather than a table.
//
// That is not a style preference. A team has a handful of warehouses, not hundreds, and what you do
// on this screen is pick one to work in — you are not scanning a column, you are choosing a place.
// A table of four rows wastes the width on headers and alignment that four rows do not need, and it
// makes each warehouse look like a record rather than a destination.
//
// The rule that follows: this stays cards only while the count stays small. A team with forty
// warehouses is a different screen, and it is a table.
export const description =
  "Warehouses as CARDS, not a table — a team has a handful, and the job is picking one to work in rather than scanning a column. It stays cards only while the count stays small.";

export interface WarehouseListPageProps {
  warehouses: WarehouseRow[];
  loading?: boolean;
}

export function WarehouseListPage({ warehouses, loading }: WarehouseListPageProps) {
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return warehouses;
    return warehouses.filter(
      (w) => w.name.toLowerCase().includes(q) || w.city.toLowerCase().includes(q),
    );
  }, [warehouses, search]);

  return (
    <Stack gap="section" data-testid="warehouse-list-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Warehouses</Heading>
        <Button icon={Plus} data-testid="warehouse-create">
          New Warehouse
        </Button>
      </HStack>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Warehouse or city"
        maxW="64"
      />

      {loading ? (
        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="card">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <Stack gap="2">
                <SkeletonBlock shape="rect" height="5" width="60%" />
                <SkeletonBlock shape="text" lines={2} />
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      ) : rows.length === 0 ? (
        <EmptyHint title="No warehouses match">Try a different name or city.</EmptyHint>
      ) : (
        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="card">
          {rows.map((w) => (
            <Card key={w.id.toString()} hoverable data-testid={`warehouse-${w.id}`}>
              <Stack gap="card">
                <HStack justify="space-between" align="flex-start">
                  <Stack gap="0.5">
                    <Text fontWeight="bold">{w.name}</Text>
                    <Text fontSize="xs" color="fg.muted">
                      {w.city}
                    </Text>
                  </Stack>
                  {/* An inactive warehouse is shown, not hidden — its stock still exists and still
                      appears in history; hiding it makes the totals impossible to reconcile. */}
                  <ToneBadge tone={w.active ? "success" : "plain"}>
                    {w.active ? "Active" : "Closed"}
                  </ToneBadge>
                </HStack>

                <ListSummary
                  items={[
                    { icon: Rows3, content: <Text>{w.rackCount} racks</Text>, tooltip: "Racks" },
                    {
                      icon: Boxes,
                      content: <Text>{w.productCount.toLocaleString("id-ID")} products</Text>,
                      tooltip: "Distinct products held",
                    },
                    { icon: MapPin, content: <Text>{w.city}</Text>, tooltip: "City" },
                  ]}
                  size="sm"
                />

                <HStack justify="flex-end">
                  <Button size="xs" tone="plain" variant="ghost" icon={Pencil}>
                    Edit
                  </Button>
                </HStack>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

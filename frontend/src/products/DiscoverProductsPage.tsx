import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex, HStack, Heading, Input, SimpleGrid, Spinner, Stack, Text } from "@chakra-ui/react";
import { rpcError, teamClient } from "../api/clients";
import { useTeam } from "../team/TeamContext";
import { useDiscoverProducts } from "./queries";
import { Pagination } from "../components/Pagination";
import { ProductCard } from "../components/ProductCard";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// DiscoverProductsPage lists products across ALL teams (#106) so a selling team can browse other
// teams' catalogues (to order from, in future). Read-only; the current team is only the authorizing
// scope, not a filter — cross-team discovery is open (owner-confirmed).
//
// It renders a GRID of ProductCard (#121) rather than a table: this is a browse, not a ledger — you
// recognise a product by its picture, so the card puts the image first. Each card names the team that
// owns the product, which on a cross-team page is the thing worth knowing about it.
export function DiscoverProductsPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // teamId -> name, for the card's team badge. Batched per page (TeamByIds), never per card.
  const [teamNames, setTeamNames] = useState<Map<string, string>>(new Map());

  // Read inside the effect WITHOUT making it a dependency: `teamNames` grows as pages resolve, so
  // depending on it would re-run the effect on its own result.
  const teamNamesRef = useRef(teamNames);
  teamNamesRef.current = teamNames;

  const teamId = current?.teamId;

  const query = useDiscoverProducts({ teamId, q, page, pageSize });

  const products = query.data?.products ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";


  // The owning team's NAME for each card. A discover page's products come from many teams, so this
  // resolves the page's ids in ONE batch and caches them for the page's life — paging back, or a
  // second page owned by the same teams, costs nothing. It deliberately does NOT gate `loading`:
  // cards render immediately with ProductCard's "Team #<id>" fallback and upgrade in place when the
  // names land, so a slow team lookup never holds up the products themselves.
  useEffect(() => {
    if (products.length === 0) {
      return;
    }

    // Unique, non-zero, not already known. TeamByIds requires min_items:1 and unique ids, so an
    // empty set must not become a call.
    const missing = [
      ...new Set(
        products.map((p) => p.teamId).filter((id) => id > 0n && !teamNamesRef.current.has(id.toString())),
      ),
    ];

    if (missing.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await teamClient.teamByIds({ ids: missing });

        if (cancelled) {
          return;
        }

        setTeamNames((prev) => {
          const next = new Map(prev);
          for (const [id, team] of Object.entries(res.data)) {
            next.set(id, team.name);
          }

          return next;
        });
      } catch {
        // A name is decoration: ProductCard falls back to "Team #<id>".
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [products]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("discover.title")}</Heading>
        <Text color="fg.muted" data-testid="discover-no-team">
          {t("discover.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("discover.title")}</Heading>
      </Flex>
      <Text fontSize="sm" color="fg.muted">
        {t("discover.subtitle")}
      </Text>

      <HStack>
        <Input
          maxW="sm"
          placeholder={t("discover.searchPlaceholder")}
          value={q}
          data-testid="discover-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
      </HStack>

      {error && (
        <Text color="red.fg" data-testid="discover-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap="card" data-testid="discover-grid">
          {products.map((product) => (
            // The card carries its own testid keyed by id; this cell keys the SAME card by SKU, which
            // is what a test naming a product actually knows. It is also the grid cell, so `h="full"`
            // on the Card inside has a stretched box to fill.
            <Box key={product.id.toString()} data-testid={`discover-card-${product.sku}`}>
              <ProductCard product={product} teamName={teamNames.get(product.teamId.toString())} />
            </Box>
          ))}
        </SimpleGrid>
      )}

      {!loading && products.length === 0 && !error && (
        <Text color="fg.muted" data-testid="discover-empty">
          {t("discover.empty")}
        </Text>
      )}

      <Pagination
        count={totalItems}
        pageSize={pageSize}
        page={page}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </Stack>
  );
}

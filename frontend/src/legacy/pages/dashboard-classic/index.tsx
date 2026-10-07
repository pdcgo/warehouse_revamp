import { Heading, Stack, Text } from "@chakra-ui/react";
import { Summary } from "../../components/display/Summary";
import { Card } from "../../components/display/Card";
import { formatRupiahCompact } from "../../../lib/money";

// The OLDEST dashboard still routed to in the legacy system.
//
// It is a band of figures and nothing else — no charts, no recent activity, no warnings. Ported for
// completeness of the reference, and because the three generations side by side say something the
// current one alone does not: each revision added a way to ACT on what it showed. This one only
// reports.
//
// ⚠ Nothing here should be read as a proposal. It is the starting point of a progression, not an
// option at the end of it.
export const description =
  "The oldest dashboard: a band of figures, no charts, no activity, no warnings. Ported for completeness — the three generations together show each revision adding a way to act on what it showed.";

export interface DashboardClassicPageProps {
  orders?: number;
  units?: number;
  revenue?: bigint;
  cost?: bigint;
  loading?: boolean;
}

export function DashboardClassicPage({
  orders = 0,
  units = 0,
  revenue = 0n,
  cost = 0n,
  loading,
}: DashboardClassicPageProps) {
  return (
    <Stack gap="section" data-testid="dashboard-classic-page">
      <Heading size="md">Overview</Heading>

      <Summary
        items={[
          { label: "Orders", value: orders.toLocaleString("id-ID") },
          { label: "Units shipped", value: units.toLocaleString("id-ID") },
          { label: "Revenue", value: formatRupiahCompact(revenue) },
          { label: "Cost", value: formatRupiahCompact(cost) },
        ]}
        loading={loading}
      />

      <Card>
        <Text fontSize="sm" color="fg.muted">
          Figures are for the current month, refreshed hourly.
        </Text>
      </Card>
    </Stack>
  );
}

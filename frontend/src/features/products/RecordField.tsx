import { Stack, Text } from "@chakra-ui/react";

// The labelled read-only pieces of a product record — shared by the owner's detail (/products/:id) and
// the discover detail (/products/discover/:id), which read the same catalogue entry from two sides.

export const description =
  "A labelled read-only value on a product record — a dash for an empty one, and an optional hint under a Stat.";

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
export function Field({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3} data-testid={testId}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// The same shape as Field, for a value that is a component rather than a string.
export function Stat({
  label,
  hint,
  testId,
  children,
}: {
  label: string;
  hint?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="0.5" minW="0" data-testid={testId}>
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" asChild>
        <div>{children}</div>
      </Text>
      {hint && (
        <Text fontSize="xs" color="fg.subtle">
          {hint}
        </Text>
      )}
    </Stack>
  );
}

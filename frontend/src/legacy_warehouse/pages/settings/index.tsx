import { Button, Field, Input, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Settings } from "lucide-react";
import { Card } from "../../../legacy/components/display/Card";
import { ScreenHeader } from "../../components/display/ScreenHeader";

// ── SETTINGS ────────────────────────────────────────────────────────────────────────────────────
//
// Two forms: who I am, and where this warehouse is.
//
// ⚠ THE WAREHOUSE ADDRESS IS NOT ADMIN TRIVIA — IT IS PRINTED ON EVERY RETURN LABEL. A typo here
// sends returns to the wrong building, and the failure surfaces weeks later as parcels that never
// arrived. It is on the same screen as the profile because there is nowhere else on a floor app to
// put it, but it deserves the warning it carries.
//
// ⚠ AND THIS IS WHERE THE PORT STOPS BEING FAITHFUL, WHICH IS WORTH STATING PLAINLY.
//
// The original also carries a BANK ACCOUNT form here — account number, bank, holder name — because
// the warehouse is paid by the teams it serves. That is not ported:
//
//   · this repository is PUBLIC, and a bank-details form is not something to publish a design for
//     on the strength of a reference port
//   · payment details on the shared floor tablet is a decision, not a detail, and it is the owner's
//     to make rather than one to inherit by copying
//
// Recorded rather than silently dropped — a reader comparing screen counts should know why this one
// is a section short.
export const description =
  "Who I am and where this warehouse is. The address is not admin trivia: it is printed on every return label. The original's bank-account form is deliberately NOT ported — see the source comment.";

export interface SettingsPageProps {
  name?: string;
  email?: string;
  warehouseName?: string;
  address?: string;
  phone?: string;
  saving?: boolean;
}

export function SettingsPage({ name, email, warehouseName, address, phone, saving }: SettingsPageProps) {
  return (
    <Stack gap="section" p="page" data-testid="settings-page">
      <ScreenHeader icon={Settings} title="Settings" />

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="3" alignItems="start">
        <Card data-testid="profile-form">
          <Stack gap="field">
            <Text fontWeight="medium" fontSize="sm">
              Your profile
            </Text>

            <Field.Root>
              <Field.Label>Name</Field.Label>
              <Input defaultValue={name} data-testid="field-name" />
              {/* On a shared tablet the name is not vanity — it is what appears against every
                  movement recorded during your shift. */}
              <Field.HelperText>Shown against everything you record.</Field.HelperText>
            </Field.Root>

            <Field.Root>
              <Field.Label>Email</Field.Label>
              <Input defaultValue={email} type="email" data-testid="field-email" />
            </Field.Root>

            <Button size="sm" alignSelf="start" loading={saving} data-testid="save-profile">
              Save profile
            </Button>
          </Stack>
        </Card>

        <Card data-testid="warehouse-form">
          <Stack gap="field">
            <Text fontWeight="medium" fontSize="sm">
              This warehouse
            </Text>

            <Field.Root>
              <Field.Label>Name</Field.Label>
              <Input defaultValue={warehouseName} data-testid="field-warehouse-name" />
            </Field.Root>

            <Field.Root>
              <Field.Label>Address</Field.Label>
              <Input defaultValue={address} data-testid="field-address" />
              <Field.HelperText color="fg.warning" data-testid="address-warning">
                Printed on every return label. A mistake here sends returns to the wrong building.
              </Field.HelperText>
            </Field.Root>

            <Field.Root>
              <Field.Label>Phone</Field.Label>
              <Input defaultValue={phone} data-testid="field-phone" />
            </Field.Root>

            <Button size="sm" alignSelf="start" loading={saving} data-testid="save-warehouse">
              Save warehouse
            </Button>
          </Stack>
        </Card>
      </SimpleGrid>

      <Text fontSize="xs" color="fg.muted" data-testid="not-ported-note">
        The original also holds a bank-account form here. It is deliberately not ported — see the
        note in this file.
      </Text>
    </Stack>
  );
}

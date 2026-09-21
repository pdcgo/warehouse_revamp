import { useState } from "react";
import { Heading, HStack, Stack, Steps, Text } from "@chakra-ui/react";
import { Building2, CircleCheck, Users, Warehouse } from "lucide-react";
import { Button } from "../../components/inputs/Button";
import { Card } from "../../components/display/Card";
import { Field } from "../../components/inputs/Field";
import { TextInput } from "../../components/inputs/TextInput";

// First-run setup: the screen a brand-new account lands on before it has a team, a warehouse or
// anyone else in it.
//
// It is a STEPPER rather than one long form, and that is the whole decision. The three things it
// collects are not independent — a warehouse belongs to a team, and an invitation is to a team that
// must already exist — so presenting them as one form invites filling them in the wrong order and
// then explaining the resulting errors. Steps make the dependency the shape of the screen.
//
// ⚠ THE LAST STEP IS SKIPPABLE AND THE FIRST TWO ARE NOT. Inviting people is the one part that can
// genuinely wait; a team with no warehouse cannot receive stock, so letting somebody skip past it
// only produces an account that appears set up and does not work.
export const description =
  "First-run setup as a stepper, because the three things it collects DEPEND on each other. Inviting people is skippable; the team and warehouse are not, since an account without them looks set up and does not work.";

const STEPS = [
  { title: "Team", icon: Building2, hint: "The company or brand this account belongs to." },
  { title: "Warehouse", icon: Warehouse, hint: "Where stock is physically kept." },
  { title: "People", icon: Users, hint: "Who else works here. You can do this later." },
];

export interface SetupPageProps {
  onFinish?(values: { team: string; warehouse: string }): void;
  busy?: boolean;
}

export function SetupPage({ onFinish, busy }: SetupPageProps) {
  const [step, setStep] = useState(0);
  const [team, setTeam] = useState("");
  const [warehouse, setWarehouse] = useState("");

  // Each step gates on its own field. The last has nothing required, which is what makes it
  // skippable without a separate flag.
  const canAdvance = step === 0 ? team.trim().length > 0 : step === 1 ? warehouse.trim().length > 0 : true;

  return (
    <Stack gap="section" maxW="xl" mx="auto" py="8" data-testid="setup-page">
      <Stack gap="1" textAlign="center">
        <Heading size="md">Set up your account</Heading>
        <Text fontSize="sm" color="fg.muted">
          Three short steps. You can change any of it afterwards.
        </Text>
      </Stack>

      <Steps.Root step={step} count={STEPS.length} size="sm">
        <Steps.List>
          {STEPS.map((s, i) => (
            <Steps.Item key={s.title} index={i} title={s.title}>
              <Steps.Indicator />
              <Steps.Title>{s.title}</Steps.Title>
              <Steps.Separator />
            </Steps.Item>
          ))}
        </Steps.List>
      </Steps.Root>

      <Card>
        <Stack gap="card">
          <Text fontSize="sm" color="fg.muted">
            {STEPS[step].hint}
          </Text>

          {step === 0 && (
            <Field label="Team name" required>
              <TextInput value={team} onChange={setTeam} data-testid="setup-team" />
            </Field>
          )}

          {step === 1 && (
            <Field label="Warehouse name" required hint="You can add more warehouses later.">
              <TextInput value={warehouse} onChange={setWarehouse} data-testid="setup-warehouse" />
            </Field>
          )}

          {step === 2 && (
            <Field label="Invite by username" hint="Optional — you can invite people at any time.">
              <TextInput data-testid="setup-invite" />
            </Field>
          )}

          <HStack justify="space-between">
            <Button
              tone="plain"
              variant="ghost"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
              data-testid="setup-back"
            >
              Back
            </Button>

            {step < STEPS.length - 1 ? (
              <Button
                disabled={!canAdvance}
                onClick={() => setStep((s) => s + 1)}
                data-testid="setup-next"
              >
                Continue
              </Button>
            ) : (
              <Button
                icon={CircleCheck}
                loading={busy}
                onClick={() => onFinish?.({ team, warehouse })}
                data-testid="setup-finish"
              >
                Finish setup
              </Button>
            )}
          </HStack>
        </Stack>
      </Card>
    </Stack>
  );
}

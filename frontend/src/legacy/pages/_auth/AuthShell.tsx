import type { ReactNode } from "react";
import { Center, Heading, Stack, Text } from "@chakra-ui/react";
import { Card } from "../../components/display/Card";

// The frame every signed-out screen sits in: a centred card with a title and a sentence.
//
// It exists so the four auth screens are ONE screen with four contents. They are visited in sequence
// by somebody who is already locked out and probably frustrated — login, then forgot-password, then
// the reset — and any drift in width, spacing or heading weight between them reads as being bounced
// between different sites mid-recovery.
export const description =
  "The frame the signed-out screens share — one centred card, so login → forgot → reset reads as one flow rather than three sites.";

export interface AuthShellProps {
  title: string;
  // One sentence saying what this step is for. Every step has one: a bare form with a title makes
  // the reader guess what happens when they submit it.
  subtitle?: string;
  children: ReactNode;
  // Links out of this step — "back to sign in", "create an account".
  footer?: ReactNode;
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <Center minH="100dvh" px="4" py="12" bg="bg.muted" data-testid="auth-shell">
      <Stack gap="section" width="full" maxW="sm">
        <Stack gap="1" textAlign="center">
          <Heading size="md">{title}</Heading>
          {subtitle && (
            <Text fontSize="sm" color="fg.muted">
              {subtitle}
            </Text>
          )}
        </Stack>

        <Card>
          <Stack gap="card">{children}</Stack>
        </Card>

        {footer && (
          <Stack gap="1" fontSize="sm" textAlign="center" color="fg.muted">
            {footer}
          </Stack>
        )}
      </Stack>
    </Center>
  );
}

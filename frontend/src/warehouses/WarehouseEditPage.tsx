import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Field,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { rpcError, teamClient } from "../api/clients";
import { toaster } from "../components/Toaster";
import { WeeklyHoursEditor, dayHoursFromWeek, weekFromDayHours } from "./WeeklyHoursEditor";
import type { WeekHours } from "./WeeklyHoursEditor";

// WarehouseEditPage is the warehouse edit surface as a DEDICATED PAGE (issue #39 comment 6 — not
// a popup). It edits the warehouse's name and description AND its two weekly schedules: general
// operating hours and when it can receive orders.
export function WarehouseEditPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();

  const id = teamId ? BigInt(teamId) : 0n;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [operating, setOperating] = useState<WeekHours>(weekFromDayHours(undefined));
  const [receiving, setReceiving] = useState<WeekHours>(weekFromDayHours(undefined));

  useEffect(() => {
    if (id === 0n) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        // Team basics and warehouse hours come from two RPCs; load them together.
        const [detail, hours] = await Promise.all([
          teamClient.teamDetail({ teamId: id }),
          teamClient.warehouseInfoDetail({ teamId: id }),
        ]);

        if (cancelled) {
          return;
        }

        setName(detail.team?.name ?? "");
        setDescription(detail.team?.description ?? "");
        setOperating(weekFromDayHours(hours.info?.operatingHours));
        setReceiving(weekFromDayHours(hours.info?.receivingHours));
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      // Two writes: the team fields, then the warehouse hours. Both are scoped to this team.
      await teamClient.teamUpdate({ teamId: id, name, description });
      await teamClient.warehouseInfoUpdate({
        teamId: id,
        operatingHours: dayHoursFromWeek(operating),
        receivingHours: dayHoursFromWeek(receiving),
      });

      toaster.create({ type: "success", title: "Warehouse saved" });
      void navigate(`/warehouses/${teamId}`);
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  return (
    <Stack gap="section" maxW="2xl" data-testid="warehouse-edit-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back"
          data-testid="warehouse-edit-back"
          onClick={() => navigate(`/warehouses/${teamId}`)}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">Edit Warehouse</Heading>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="warehouse-edit-error">
          {error}
        </Text>
      )}

      <form onSubmit={save}>
        <Stack gap="section">
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Field.Root required>
                  <Field.Label>Name</Field.Label>
                  <Input
                    value={name}
                    data-testid="warehouse-edit-name"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Textarea
                    value={description}
                    data-testid="warehouse-edit-description"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field.Root>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root>
            <Card.Body>
              <Stack gap="section">
                <WeeklyHoursEditor
                  label="Operating hours"
                  value={operating}
                  onChange={setOperating}
                  testId="operating-hours"
                />

                <WeeklyHoursEditor
                  label="Order-receiving hours"
                  value={receiving}
                  onChange={setReceiving}
                  testId="receiving-hours"
                />
              </Stack>
            </Card.Body>
          </Card.Root>

          <Flex justify="end">
            <Button type="submit" colorPalette="brand" loading={saving} data-testid="warehouse-edit-save">
              Save
            </Button>
          </Flex>
        </Stack>
      </form>
    </Stack>
  );
}

import { Button, SimpleGrid } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, Pencil } from "lucide-react";
import { expect, within } from "storybook/test";

import { Fact, Section, SectionEmpty, description } from "./DetailSection";

const meta = {
  title: "Components/Chrome/DetailSection",
  component: Section,
  parameters: { docs: { description: { component: description } } },
  args: { title: "Info", icon: FileText, children: null },
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

// A section of facts — the shape every detail page's Info takes.
export const WithFacts: Story = {
  render: (args) => (
    <Section {...args} testId="section" action={<Button size="xs" variant="outline"><Pencil />Edit</Button>}>
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
        <Fact label="SKU">SKU-ANG-001</Fact>
        <Fact label="Category">Rumah Tangga › Dapur</Fact>
        <Fact label="Note" />
        <Fact label="Description" full>
          Minyak goreng kelapa sawit, botol 2 liter. Disimpan di rak kering, jauh dari sinar matahari.
        </Fact>
      </SimpleGrid>
    </Section>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A fact with no value is a dash, not an empty line.
    await expect(canvas.getByTestId("section")).toHaveTextContent("Note—");
  },
};

// An empty section still renders, and says what is absent.
export const Empty: Story = {
  render: (args) => (
    <Section {...args} title="Shipping" testId="section">
      <SectionEmpty>No tracking yet.</SectionEmpty>
    </Section>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("empty-note")).toHaveTextContent("No tracking yet.");
  },
};

import type { Preview } from "@storybook/react";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import "../src/styles/tailwind.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#1a1a2e" }],
    },
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
};

export default preview;

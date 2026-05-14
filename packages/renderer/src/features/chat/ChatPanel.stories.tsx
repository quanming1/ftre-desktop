/**
 * Story: ChatView
 *
 * Same component as the main app. No mode param needed.
 * Internally detects that store is empty and falls back to streamManager.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { ChatView } from "./ChatView";

const meta: Meta<typeof ChatView> = {
  title: "Chat/ChatView",
  component: ChatView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-screen bg-[#1a1a2e]">
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const Default: StoryObj<typeof ChatView> = {};

/**
 * Story: ChatView
 *
 * The same component used in the main app, but in "storybook" mode:
 * - Connects to real backend WebSocket
 * - Shows WS Log toggle for debugging
 * - Uses simple input (no Slate dependency issues)
 * - Same message rendering as production
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

/** Storybook mode: real WebSocket, simple input, WS log panel */
export const Storybook: StoryObj<typeof ChatView> = {
  args: {
    mode: "storybook",
    wsUrl: "ws://127.0.0.1:18790/",
  },
};

/** App mode: uses zustand stores, full Slate editor (needs full app context) */
export const AppMode: StoryObj<typeof ChatView> = {
  args: {
    mode: "app",
  },
};

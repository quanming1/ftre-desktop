/**
 * Story: ChatPanel (Full)
 *
 * Renders the REAL ChatPanel component — same as the main app.
 * Uses the real streamManager, wsClient, and all stores.
 *
 * Connect to a running backend to test the full chat experience:
 * - Message list with streaming, tool cards, markdown
 * - Full ChatInput with Slate editor
 * - Model/agent selector
 * - All keyboard shortcuts
 */
import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ChatPanel } from "./ChatPanel";
import { wsClient } from "@/services/websocket-client";
import { useChat } from "@/stores/chat";

const meta: Meta<typeof ChatPanel> = {
  title: "Chat/ChatPanel",
  component: ChatPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => {
      // Connect wsClient on mount if not already connected
      useEffect(() => {
        if (!wsClient.connected) {
          wsClient.connect();
        }
        wsClient.onConnect(() => useChat.getState().setConnected(true));
        wsClient.onDisconnect(() => useChat.getState().setConnected(false));
        wsClient.onStatusChange((s) => useChat.getState().setWsStatus(s));
      }, []);

      return (
        <div className="h-screen bg-[#1a1a2e]">
          <Story />
        </div>
      );
    },
  ],
};

export default meta;

export const Live: StoryObj<typeof ChatPanel> = {};

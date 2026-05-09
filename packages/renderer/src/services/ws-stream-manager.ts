/**
 * WebSocket Stream Manager — manages per-chat message state.
 * Replaces the old SSE-based stream-manager.
 */

import { wsClient } from './websocket-client';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  kind?: 'tool_hint' | 'progress';
  streaming?: boolean;
}

export interface ChatSession {
  chatId: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
}

type ChangeHandler = (session: ChatSession) => void;

let messageIdCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

class WsStreamManager {
  private sessions: Map<string, ChatSession> = new Map();
  private activeChatId: string | null = null;
  private changeHandlers: ChangeHandler[] = [];
  private currentStreamBuf = '';
  private currentStreamMsgId: string | null = null;

  constructor() {
    wsClient.onMessage((data) => this.handleEvent(data));
    wsClient.onConnect(() => {
      console.info('[StreamManager] WS connected');
    });
    wsClient.onDisconnect(() => {
      // Mark all sessions as not streaming
      for (const session of this.sessions.values()) {
        if (session.isStreaming) {
          session.isStreaming = false;
          this.emitChange(session);
        }
      }
    });
  }

  getSession(chatId: string): ChatSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = { chatId, messages: [], isStreaming: false, error: null };
      this.sessions.set(chatId, session);
    }
    return session;
  }

  getActiveSession(): ChatSession | null {
    if (!this.activeChatId) return null;
    return this.getSession(this.activeChatId);
  }

  setActiveChatId(chatId: string): void {
    this.activeChatId = chatId;
  }

  sendMessage(content: string): void {
    const chatId = this.activeChatId || wsClient.chatId;
    if (!chatId) {
      console.warn('[StreamManager] No active chat');
      return;
    }

    // Add user message locally
    const session = this.getSession(chatId);
    session.messages.push({
      id: nextId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    });
    session.error = null;
    this.emitChange(session);

    // Send via WS
    wsClient.sendMessage(chatId, content);
  }

  newChat(): void {
    wsClient.newChat();
  }

  switchChat(chatId: string): void {
    this.activeChatId = chatId;
    wsClient.attachChat(chatId);
    this.emitChange(this.getSession(chatId));
  }

  onChange(handler: ChangeHandler): () => void {
    this.changeHandlers.push(handler);
    return () => { this.changeHandlers = this.changeHandlers.filter(h => h !== handler); };
  }

  getAllChatIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  private handleEvent(data: any): void {
    const chatId = data.chat_id || this.activeChatId;
    if (!chatId) return;

    const session = this.getSession(chatId);

    switch (data.event) {
      case 'ready':
        this.activeChatId = data.chat_id;
        this.emitChange(this.getSession(data.chat_id));
        break;

      case 'attached':
        this.activeChatId = data.chat_id;
        this.emitChange(this.getSession(data.chat_id));
        break;

      case 'delta':
        if (!session.isStreaming) {
          // Start new assistant message
          session.isStreaming = true;
          this.currentStreamBuf = '';
          this.currentStreamMsgId = nextId();
          session.messages.push({
            id: this.currentStreamMsgId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            streaming: true,
          });
        }
        // Append delta
        this.currentStreamBuf += (data.text || '');
        const streamMsg = session.messages.find(m => m.id === this.currentStreamMsgId);
        if (streamMsg) {
          streamMsg.content = this.currentStreamBuf;
        }
        this.emitChange(session);
        break;

      case 'stream_end':
        // Finalize streaming message
        const endMsg = session.messages.find(m => m.id === this.currentStreamMsgId);
        if (endMsg) {
          endMsg.streaming = false;
          endMsg.content = this.currentStreamBuf;
        }
        // Don't set isStreaming=false yet — wait for turn_end
        // (resuming=true means tools are running, more deltas may follow)
        this.currentStreamBuf = '';
        this.currentStreamMsgId = null;
        this.emitChange(session);
        break;

      case 'turn_end':
        session.isStreaming = false;
        this.emitChange(session);
        break;

      case 'message':
        // Full message (non-streaming) or tool_hint/progress
        if (data.kind === 'tool_hint' || data.kind === 'progress') {
          // Tool hint / progress — show inline
          session.messages.push({
            id: nextId(),
            role: 'assistant',
            content: data.text || '',
            timestamp: Date.now(),
            kind: data.kind,
          });
        } else if (data.text) {
          // Complete assistant message (no streaming)
          session.messages.push({
            id: nextId(),
            role: 'assistant',
            content: data.text,
            timestamp: Date.now(),
          });
        }
        this.emitChange(session);
        break;

      case 'error':
        session.isStreaming = false;
        session.error = data.detail || 'Unknown error';
        this.emitChange(session);
        break;

      default:
        // Unknown event, ignore
        break;
    }
  }

  private emitChange(session: ChatSession): void {
    this.changeHandlers.forEach(h => h(session));
  }
}

// Singleton
export const streamManager = new WsStreamManager();

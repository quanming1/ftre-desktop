/**
 * WebSocket client for ai-base gateway.
 * Handles connection, reconnection, and message routing.
 */

type MessageHandler = (data: any) => void;
type ConnectionHandler = () => void;

const DEFAULT_WS_URL = `ws://${window.location.hostname || '127.0.0.1'}:18790/`;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  
  // State
  public connected = false;
  public chatId: string | null = null;
  public clientId: string | null = null;

  // Callbacks
  private messageHandlers: MessageHandler[] = [];
  private connectHandlers: ConnectionHandler[] = [];
  private disconnectHandlers: ConnectionHandler[] = [];

  constructor(url?: string) {
    this.url = url || DEFAULT_WS_URL;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.intentionalClose = false;
    
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempt = 0;
        this.connectHandlers.forEach(h => h());
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.disconnectHandlers.forEach(h => h());
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      };
      this.ws.onerror = (e) => {
        console.error('[WS] Error:', e);
      };
    } catch (e) {
      console.error('[WS] Connect failed:', e);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  send(envelope: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send, not connected');
      return;
    }
    this.ws.send(JSON.stringify(envelope));
  }

  sendMessage(chatId: string, content: string): void {
    this.send({ type: 'message', chat_id: chatId, content, webui: true });
  }

  newChat(): void {
    this.send({ type: 'new_chat' });
  }

  attachChat(chatId: string): void {
    this.send({ type: 'attach', chat_id: chatId });
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => { this.messageHandlers = this.messageHandlers.filter(h => h !== handler); };
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.push(handler);
    return () => { this.connectHandlers = this.connectHandlers.filter(h => h !== handler); };
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.push(handler);
    return () => { this.disconnectHandlers = this.disconnectHandlers.filter(h => h !== handler); };
  }

  private handleMessage(data: any): void {
    // Handle ready event (connection handshake)
    if (data.event === 'ready') {
      this.chatId = data.chat_id;
      this.clientId = data.client_id;
    }
    // Handle attached event (chat switch)
    if (data.event === 'attached') {
      this.chatId = data.chat_id;
    }
    // Dispatch to all handlers
    this.messageHandlers.forEach(h => h(data));
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    console.info(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }
}

// Singleton
export const wsClient = new WebSocketClient();
export type { MessageHandler, ConnectionHandler };

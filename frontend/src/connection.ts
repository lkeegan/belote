import type { ActionBodies, ClientState, Reveal, ServerMessage } from "../../shared/protocol";

interface Handlers {
  state(state: ClientState): void;
  reveal(reveal: Reveal): void;
  offline(offline: boolean): void;
  error(error: string): void;
}

/** One socket, with bounded backoff and no queued actions to replay after reconnect. */
export class GameConnection {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private delay = 1000;
  private stopped = false;

  constructor(private url: string, private handlers: Handlers) {}

  connect(): void {
    this.stopped = false;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.delay = 1000;
      this.handlers.offline(false);
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      let data: ServerMessage;
      try {
        data = JSON.parse(event.data as string);
        if (!data || typeof data !== "object") return;
      } catch {
        return;
      }
      if ("error" in data) this.handlers.error(data.error);
      else if ("reveal" in data) this.handlers.reveal(data.reveal);
      else if ("phase" in data) this.handlers.state(data);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.stopped) return;
      this.handlers.offline(true);
      this.timer = setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(this.delay * 2, 30000);
    });
    socket.addEventListener("error", () => socket.close());
  }

  send<P extends keyof ActionBodies>(path: P, body: ActionBodies[P]): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ path, body }));
    } else {
      this.handlers.offline(true);
    }
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }
}

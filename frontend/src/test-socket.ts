/** In-process socket peer for connection and application tests. */
export class TestSocket extends EventTarget {
  static readonly OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  sent: string[] = [];

  constructor(readonly url: string) {
    super();
    TestSocket.instances.push(this);
  }

  open(): void {
    this.readyState = TestSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  message(value: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }

  send(value: string): void { this.sent.push(value); }

  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

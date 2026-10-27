// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GameConnection } from "./connection";
import { TestSocket } from "./test-socket";

let connection: GameConnection;
const handlers = { state: vi.fn(), reveal: vi.fn(), offline: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  TestSocket.instances = [];
  vi.stubGlobal("WebSocket", TestSocket);
  connection = new GameConnection("ws://localhost:8787", handlers);
  connection.connect();
});
afterEach(() => {
  connection.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("backs off reconnects, resets after opening, and stops when closed", () => {
  TestSocket.instances[0].close();
  expect(handlers.offline).toHaveBeenLastCalledWith(true);
  vi.advanceTimersByTime(999);
  expect(TestSocket.instances).toHaveLength(1);
  vi.advanceTimersByTime(1);
  TestSocket.instances[1].close();
  vi.advanceTimersByTime(1999);
  expect(TestSocket.instances).toHaveLength(2);
  vi.advanceTimersByTime(1);
  TestSocket.instances[2].open();
  expect(handlers.offline).toHaveBeenLastCalledWith(false);
  TestSocket.instances[2].close();
  vi.advanceTimersByTime(1000);
  expect(TestSocket.instances).toHaveLength(4);
  connection.close();
  vi.runAllTimers();
  expect(TestSocket.instances).toHaveLength(4);
});

it("sends only on an open socket and never replays offline actions", () => {
  connection.send("/new", { dealId: 3 });
  expect(handlers.offline).toHaveBeenCalledWith(true);
  const socket = TestSocket.instances[0];
  socket.open();
  expect(socket.sent).toEqual([]);
  connection.send("/new", { dealId: 3 });
  expect(JSON.parse(socket.sent[0])).toEqual({ path: "/new", body: { dealId: 3 } });
});

it("dispatches server messages and ignores malformed JSON", () => {
  const socket = TestSocket.instances[0];
  socket.message(null);
  socket.dispatchEvent(new MessageEvent("message", { data: "{" }));
  socket.message({ error: "stale deal" });
  socket.message({ reveal: { seat: 0, annonces: [] } });
  expect(handlers.error).toHaveBeenCalledWith("stale deal");
  expect(handlers.reveal).toHaveBeenCalledWith({ seat: 0, annonces: [] });
  expect(handlers.state).not.toHaveBeenCalled();
});

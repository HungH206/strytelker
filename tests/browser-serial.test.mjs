import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { BrowserArduino } from "../src/browser-serial.mjs";

function fixture() {
  let input;
  const writes = [],
    connections = [],
    errors = [];
  const port = {
    readable: new ReadableStream({
      start(controller) {
        input = controller;
      },
    }),
    writable: new WritableStream({
      write(chunk) {
        writes.push(new TextDecoder().decode(chunk));
      },
    }),
    async open(options) {
      assert.equal(options.baudRate, 9600);
    },
    async close() {
      assert.equal(this.readable.locked, false);
      assert.equal(this.writable.locked, false);
    },
  };
  const arduino = new BrowserArduino({
    serial: { requestPort: async () => port },
    onConnectionChange: (value) => connections.push(value),
    onError: (error) => errors.push(error.message),
  });
  return {
    arduino,
    port,
    writes,
    connections,
    errors,
    send(text) {
      input.enqueue(new TextEncoder().encode(text));
    },
    unplug() {
      input.error(new Error("USB unplugged"));
    },
  };
}
const nonce = "0123456789abcdef01234567";

test("browser serial handles fragmented input and consumes matching single/double gestures only once", async () => {
  const f = fixture();
  await f.arduino.connect();
  const presses = [];
  await f.arduino.arm(nonce, true, (press) => presses.push(press));
  assert.equal(f.writes[0], `ARM ${nonce} NAV\n`);
  f.send(
    `SOUND 450\nPRESS aaaaaaaaaaaaaaaaaaaaaaaa 1\nPRESS ${nonce.slice(0, 10)}`,
  );
  await setImmediate();
  assert.deepEqual(presses, []);
  f.send(`${nonce.slice(10)} 2\nPRESS ${nonce} 1\n`);
  await setImmediate();
  assert.deepEqual(presses, [{ nonce, count: 2 }]);
  await f.arduino.disconnect();
  assert.deepEqual(f.connections, [true, false]);
  assert.equal(f.writes.at(-1), "DISARM\n");
});

test("browser serial rejects malformed and oversized lines then recovers", async () => {
  const f = fixture();
  await f.arduino.connect();
  const presses = [];
  await f.arduino.arm(nonce, false, (press) => presses.push(press));
  f.send(`PRESS ${nonce} 3\n${"x".repeat(400)}PRESS ${nonce}\n`);
  await setImmediate();
  assert.deepEqual(presses, []);
  f.send(`PRESS ${nonce}\n`);
  await setImmediate();
  assert.deepEqual(presses, [{ nonce, count: 1 }]);
  await f.arduino.disconnect();
});

test("browser disarm and expiry prevent stale dispatch", async (t) => {
  let time = 1000;
  t.mock.method(Date, "now", () => time);
  const f = fixture();
  await f.arduino.connect();
  const presses = [];
  await f.arduino.arm(nonce, true, (press) => presses.push(press));
  await f.arduino.disarm();
  f.send(`PRESS ${nonce} 1\n`);
  await setImmediate();
  assert.deepEqual(presses, []);
  await f.arduino.arm(nonce, true, (press) => presses.push(press));
  time += 30001;
  f.send(`PRESS ${nonce} 1\n`);
  await setImmediate();
  assert.deepEqual(presses, []);
  await f.arduino.disconnect();
});

test("browser unplug releases stream locks and reports disconnection", async () => {
  const f = fixture();
  await f.arduino.connect();
  await f.arduino.arm(nonce, true, () => assert.fail("No press expected"));
  f.unplug();
  await setImmediate();
  await setImmediate();
  assert.equal(f.arduino.connected, false);
  assert.deepEqual(f.connections, [true, false]);
  assert.deepEqual(f.errors, ["USB unplugged"]);
  assert.equal(f.port.readable.locked, false);
  assert.equal(f.port.writable.locked, false);
});

test("press callback errors do not break the serial connection", async () => {
  const f = fixture();
  await f.arduino.connect();
  await f.arduino.arm(nonce, true, () => {
    throw new Error("API failed");
  });
  f.send(`PRESS ${nonce} 1\n`);
  await setImmediate();
  assert.deepEqual(f.errors, ["API failed"]);
  assert.equal(f.arduino.connected, true);
  await f.arduino.disconnect();
});

test("cancelling the device picker never opens a serial connection", async () => {
  const arduino = new BrowserArduino({
    serial: {
      async requestPort() {
        throw new Error("Picker cancelled");
      },
    },
  });
  await assert.rejects(() => arduino.connect(), /Picker cancelled/);
  assert.equal(arduino.connected, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createArduinoBridge } from "../server/arduino.mjs";

class FakePort extends EventEmitter {
  static instance;
  isOpen = true;
  writes = [];
  constructor() {
    super();
    FakePort.instance = this;
  }
  write(line, callback) {
    this.writes.push(line);
    callback();
  }
}

test("hardware bridge accepts only the armed nonce and consumes it once", () => {
  const bridge = createArduinoBridge("test", FakePort);
  const port = FakePort.instance;
  let confirmations = 0;
  bridge.arm(() => confirmations++);
  assert.throws(() => bridge.arm(() => {}), /already armed/);
  const nonce = port.writes[0].trim().split(" ")[1];
  port.emit("data", Buffer.from("PRESS old\n"));
  assert.equal(confirmations, 0);
  port.emit("data", Buffer.from(`PRESS ${nonce.slice(0, 10)}`));
  port.emit("data", Buffer.from(`${nonce.slice(10)}\nPRESS ${nonce}\n`));
  assert.equal(confirmations, 1);
});

test("disconnect cancels an armed press", () => {
  const bridge = createArduinoBridge("test", FakePort);
  const port = FakePort.instance;
  let confirmed = false;
  bridge.arm(() => {
    confirmed = true;
  });
  const nonce = port.writes[0].trim().split(" ")[1];
  port.emit("close");
  port.emit("data", Buffer.from(`PRESS ${nonce}\n`));
  assert.equal(confirmed, false);
});

test("missing hardware reports a useful configuration error", () => {
  const bridge = createArduinoBridge("");
  assert.equal(bridge.status().connected, false);
  assert.throws(() => bridge.arm(() => {}), /ARDUINO_PORT/);
});

test("sound telemetry is reported without confirming an armed journey", () => {
  const bridge = createArduinoBridge("test", FakePort);
  const port = FakePort.instance;
  let confirmations = 0;
  bridge.arm(() => confirmations++);
  port.emit("data", Buffer.from("SOUND 432\nSOUND invalid\n"));
  assert.equal(bridge.status().sound.raw, 432);
  assert.equal(typeof bridge.status().sound.sampledAt, "number");
  assert.equal(confirmations, 0);
});

test("navigation distinguishes single/double gestures and rejects stale or consumed nonces", () => {
  const bridge = createArduinoBridge("test", FakePort);
  const port = FakePort.instance;
  const gestures = [];
  bridge.arm((count) => gestures.push(count), {
    owner: "journey-a",
    gestures: true,
  });
  assert.match(port.writes[0], / NAV\n$/);
  const oldNonce = port.writes[0].split(" ")[1];
  bridge.arm((count) => gestures.push(count), {
    owner: "journey-a",
    gestures: true,
  });
  const freshNonce = port.writes[1].split(" ")[1];
  assert.throws(
    () => bridge.arm(() => {}, { owner: "journey-b" }),
    /already armed/,
  );
  port.emit(
    "data",
    Buffer.from(`PRESS ${oldNonce} 2\nPRESS ${freshNonce} 3\n`),
  );
  assert.deepEqual(gestures, []);
  port.emit(
    "data",
    Buffer.from(`PRESS ${freshNonce} 2\nPRESS ${freshNonce} 1\n`),
  );
  assert.deepEqual(gestures, [2]);
});

test("disarm only cancels the owning journey", () => {
  const bridge = createArduinoBridge("test", FakePort);
  const port = FakePort.instance;
  let confirmed = false;
  bridge.arm(
    () => {
      confirmed = true;
    },
    { owner: "owner" },
  );
  const nonce = port.writes[0].trim().split(" ")[1];
  bridge.disarm("other");
  bridge.disarm("owner");
  assert.equal(port.writes.at(-1), "DISARM\n");
  port.emit("data", Buffer.from(`PRESS ${nonce}\n`));
  assert.equal(confirmed, false);
});

test("a late disarm cannot cancel a newer local arm from the same session", () => {
  const bridge = createArduinoBridge("test", FakePort);
  let count = 0;
  const previous = bridge.arm(() => {}, { owner: "session" });
  const current = bridge.arm(() => count++, { owner: "session" });
  bridge.disarm("session", previous);
  FakePort.instance.emit("data", Buffer.from(`PRESS ${current}\n`));
  assert.equal(count, 1);
});

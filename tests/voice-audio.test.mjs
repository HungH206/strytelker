import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const code = readFileSync(
  new URL("../public/audio/toyo-input.js", import.meta.url),
  "utf8",
);
test("microphone worklet down-samples device audio to 16 kHz signed PCM in 20 ms packets", () => {
  for (const rate of [16000, 48000]) {
    let Processor;
    const packets = [];
    vm.runInNewContext(code, {
      sampleRate: rate,
      AudioWorkletProcessor: class {
        port = {
          postMessage(buffer) {
            packets.push(buffer);
          },
        };
      },
      registerProcessor(_name, implementation) {
        Processor = implementation;
      },
    });
    const processor = new Processor();
    for (let offset = 0; offset < rate; offset += 128)
      processor.process([
        [new Float32Array(Math.min(128, rate - offset)).fill(0.5)],
      ]);
    assert.equal(packets.length, 50);
    assert.equal(packets[0].byteLength, 640);
    assert.equal(new DataView(packets[0]).getInt16(0, true), 16384);
  }
});

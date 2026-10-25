import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import express from "express";
import { createToyoRouter } from "../server/toyo-api.mjs";
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
let badModel = false;
const ai = {
  models: {
    async generateContent() {
      return {
        text: JSON.stringify({
          vehicleId: badModel ? "invented-car" : "corolla-hybrid-2026",
          reason: "A matching sedan within your selected band.",
        }),
      };
    },
  },
};
const app = express();
app.use(express.json());
app.use(
  "/api/toyo",
  createToyoRouter(ai, createArduinoBridge("test", FakePort)),
);
const server = await new Promise((resolve, reject) => {
  const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  listener.on("error", reject);
});
const base = `http://127.0.0.1:${server.address().port}/api/toyo`;
try {
  let token;
  let state;
  async function request(path, body) {
    const response = await fetch(`${base}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Journey-Token": token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  async function event(action) {
    const response = await request("event", {
      revision: state.revision,
      event: action,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    state = response.data;
  }
  async function press(count = 1) {
    const armed = await request("hardware/arm", { revision: state.revision });
    assert.equal(armed.status, 200, JSON.stringify(armed.data));
    const line = FakePort.instance.writes.at(-1);
    const nonce = line.trim().split(" ")[1];
    FakePort.instance.emit("data", Buffer.from(`PRESS ${nonce} ${count}\n`));
    state = (await request("session")).data;
    return nonce;
  }
  const config = (await request("config")).data;
  assert.equal(config.inventory.length, 10);
  assert.equal(config.offers.length, 2);
  assert.ok(config.offers.every((offer) => offer.rebate_usd === 500));
  assert.equal((await request("session")).status, 404);
  const started = await request("sessions", {});
  token = started.data.token;
  state = started.data.state;
  await press(1); // Sedan: yes.
  assert.equal(state.question, "range");
  await press(1); // First price band: yes.
  assert.equal(state.stage, "dealer");
  let response = await request("recommend", { revision: state.revision });
  assert.equal(response.status, 200);
  state = response.data;
  assert.equal(state.vehicleId, "corolla-hybrid-2026");
  const preserved = state.vehicleId;
  badModel = true;
  response = await request("recommend", { revision: state.revision });
  assert.equal(response.status, 503);
  assert.equal((await request("session")).data.vehicleId, preserved);
  const oldNonce = await press(1); // Next car.
  assert.equal(state.vehicleId, "corolla-2026");
  await press(2); // Choose.
  assert.equal(state.stage, "finance");
  const finance = {
    method: "loan",
    savings: 8000,
    downPayment: 5000,
    reserve: 2000,
    monthlyBudget: 700,
    ownershipCosts: 150,
    apr: 6.5,
    months: 60,
  };
  assert.equal(
    (
      await request("event", {
        revision: state.revision,
        event: { type: "FINANCE", finance, offerId: "college-500" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("event", {
        revision: state.revision,
        event: {
          type: "FINANCE",
          finance,
          offerId: ["college-500", "military-500"],
          eligibilityAcknowledged: true,
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("event", {
        revision: state.revision,
        event: {
          type: "FINANCE",
          finance,
          offerId: "military-500",
          rebate: 5000,
          eligibilityAcknowledged: true,
        },
      })
    ).status,
    400,
  );
  await event({
    type: "FINANCE",
    finance,
    offerId: "military-500",
    eligibilityAcknowledged: true,
  });
  assert.equal(state.quote.rebate, 500);
  assert.equal(state.quote.principal, 19825);
  assert.equal(
    (await request("hardware/arm", { revision: state.revision })).status,
    409,
  );
  assert.equal(
    (
      await request("event", {
        revision: state.revision,
        event: { type: "CONFIRM", source: "hardware" },
      })
    ).status,
    400,
  );
  await event({
    type: "INSURANCE",
    insurance: { mode: "additional", monthly: 100, accepted: true },
  });
  const before = state.revision;
  FakePort.instance.emit("data", Buffer.from(`PRESS ${oldNonce} 1\n`));
  assert.equal((await request("session")).data.revision, before);
  const finalNonce = await press(1);
  assert.equal(state.stage, "complete");
  assert.equal(state.confirmationSource, "hardware");
  assert.equal(state.outcome, "simulated_purchase");
  assert.equal(state.quote.rebate, 500);
  assert.equal(state.quote.appliedOfferId, "military-500");
  FakePort.instance.emit("data", Buffer.from(`PRESS ${finalNonce} 1\n`));
  assert.equal((await request("session")).data.revision, state.revision);
  assert.equal(
    (await request("event", { revision: before, event: { type: "CONFIRM" } }))
      .status,
    409,
  );
  console.log(
    "TOYO API checks passed: catalog, HQ/garage hardware gestures, validated model ranking, stale/duplicate presses, insurance gate, and hardware checkout. No provider calls or physical serial access.",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

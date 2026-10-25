import express from "express";
import assert from "node:assert/strict";
import { createDriveRouter } from "../server/drive-api.mjs";
const app = express();
app.use(express.json());
let failAI = false,
  calls = 0;
app.use(
  "/api/drive",
  createDriveRouter({
    models: {
      async generateContent() {
        calls++;
        if (failAI) throw new Error("Offline");
        return {
          text: "Cinderella and Lumi reviewed the plan together. This chapter is a pretend purchase, and thoughtful choices help her write the next page.",
        };
      },
    },
  }),
);
const server = await new Promise((resolve, reject) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
  s.on("error", reject);
});
const base = `http://127.0.0.1:${server.address().port}/api/drive`;
try {
  const request = async (path, body, token) => {
    const r = await fetch(`${base}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Journey-Token": token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  const config = await request("config");
  assert.equal(config.data.vehicles.length, 3);
  assert.equal((await request("event", {})).status, 404);
  for (const affordable of [true, false]) {
    const started = await request("journeys", {}),
      token = started.data.token;
    let state = started.data.state;
    const event = async (event) => {
      const r = await request(
        "event",
        { revision: state.revision, event },
        token,
      );
      assert.equal(r.status, 200, JSON.stringify(r.data));
      state = r.data;
    };
    assert.equal(
      (
        await request(
          "event",
          { revision: 0, event: { type: "CONFIRM", source: "simulator" } },
          token,
        )
      ).status,
      400,
    );
    await event({ type: "SELECT_VEHICLE", vehicleId: "corolla" });
    assert.equal(
      (
        await request(
          "event",
          { revision: 0, event: { type: "COMPARE" } },
          token,
        )
      ).status,
      409,
    );
    await event({ type: "ACCEPT_VEHICLE" });
    await event({
      type: "PREPARE_OFFER",
      finance: {
        method: "loan",
        savings: 8000,
        downPayment: 5000,
        reserve: 2000,
        monthlyBudget: affordable ? 600 : 200,
        ownershipCosts: 150,
        apr: 6.5,
        months: 60,
      },
    });
    assert.equal(state.chapter, 4);
    const quote = structuredClone(state.quote);
    const dialogue = await request("dialogue", {}, token);
    assert.equal(dialogue.status, 200);
    assert.equal(dialogue.data.dialogueSource, "gemini");
    assert.deepEqual(dialogue.data.quote, quote);
    assert.equal(dialogue.data.chapter, 4);
    assert.equal(
      (
        await request(
          "event",
          {
            revision: state.revision,
            event: { type: "CONFIRM", source: "hardware" },
          },
          token,
        )
      ).status,
      400,
      "browser cannot claim a hardware event",
    );
    assert.equal(
      (
        await request(
          "event",
          {
            revision: state.revision,
            event: { type: "CONFIRM", source: "simulator", eligible: true },
          },
          token,
        )
      ).status,
      400,
    );
    failAI = true;
    assert.equal((await request("dialogue", {}, token)).status, 503);
    failAI = false;
    await event({ type: "CONFIRM", source: "simulator" });
    assert.equal(
      state.outcome,
      affordable ? "simulated_purchase" : "savings_plan",
    );
    assert.equal(
      (
        await request(
          "event",
          {
            revision: state.revision,
            event: { type: "CONFIRM", source: "simulator" },
          },
          token,
        )
      ).status,
      400,
    );
  }
  assert.equal(calls, 4);
  console.log(
    "Drive API checks passed: both endings, AI adapter success/failure, quote preservation, stale/duplicate confirmation, and rejection of forged hardware events.",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

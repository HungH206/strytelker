import assert from "node:assert/strict";
import express from "express";
import { createToyoRouter } from "../server/toyo-api.mjs";
const ai = {
  authTokens: {
    async create() {
      return { name: "auth_tokens/mock-session" };
    },
  },
};
const app = express();
app.use(express.json());
app.use("/api/toyo", createToyoRouter(ai, null));
const server = await new Promise((resolve, reject) => {
  const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  listener.on("error", reject);
});
try {
  const base = `http://127.0.0.1:${server.address().port}/api/toyo`;
  let token, state, lease;
  async function request(path, body, expected = 200) {
    const response = await fetch(`${base}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Journey-Token": token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, expected);
    return response.json();
  }
  assert.equal((await request("config")).liveVoice, true);
  const created = await request("sessions", {});
  token = created.token;
  state = created.state;
  const credentials = await request("voice/token", { revision: 0 });
  assert.equal(credentials.token, "auth_tokens/mock-session");
  lease = credentials.voiceSessionId;
  let callNumber = 0;
  async function tool(
    name,
    args,
    expected = 200,
    callId = `call-${++callNumber}`,
  ) {
    const result = await request(
      "voice/tool",
      {
        revision: state.revision,
        voiceSessionId: lease,
        callId,
        name,
        args: { revision: state.revision, ...args },
      },
      expected,
    );
    if (result.state) state = result.state;
    return result;
  }
  await tool("CONFIRM", {}, 400);
  await tool("set_preferences", { kind: "SUV", range: 1 });
  assert.equal(state.stage, "dealer");
  await tool("choose_vehicle", {}, 400);
  state = await request("event", {
    revision: state.revision,
    event: { type: "CHOOSE_CAR" },
  });
  const args = {
    method: "loan",
    savings: 8000,
    reserve: 2000,
    monthlyBudget: 1000,
    ownershipCosts: 150,
    downPayment: 5000,
    apr: 6.5,
    months: 60,
    offerId: "none",
    eligibilityAcknowledged: false,
  };
  const first = await tool("prepare_finance", args, 200, "prepare-once");
  const duplicate = await tool("prepare_finance", args, 200, "prepare-once");
  assert.equal(first.draft.id, duplicate.draft.id);
  assert.equal(state.stage, "finance");
  await tool(
    "confirm_details",
    { draftId: first.draft.id, userConfirmed: false },
    400,
  );
  await tool("confirm_details", {
    draftId: first.draft.id,
    userConfirmed: true,
  });
  assert.equal(state.stage, "checkout");
  assert.equal(state.reviewed, false);
  const draft = await tool("prepare_insurance", {
    mode: "additional",
    monthly: 100,
  });
  await tool("confirm_details", {
    draftId: draft.draft.id,
    userConfirmed: true,
  });
  assert.equal(state.reviewed, true);
  assert.equal(state.stage, "checkout");
  await tool("prepare_insurance", { mode: "additional", monthly: 110 });
  await request(
    "event",
    { revision: state.revision, event: { type: "CONFIRM" } },
    400,
  );
  await request("browser-serial/arm", { revision: state.revision }, 409);
  await tool("CONFIRM", {}, 400);
  const context = await request("voice/context");
  assert.equal(context.state.stage, "checkout");
  await request("voice/stop", { voiceSessionId: lease });
  await tool("revise_plan", {}, 409);
  state = await request("event", {
    revision: state.revision,
    event: { type: "CONFIRM" },
  });
  assert.equal(state.stage, "complete");
  assert.equal(state.outcome, "simulated_purchase");
  console.log(
    "Voice API passed: short-lived constrained tokens, agreed preferences, user-only car selection, staged finance/insurance readback, call deduplication, stopped-lease rejection and user-only final purchase confirmation. No Gemini calls or microphone access.",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

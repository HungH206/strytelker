import assert from "node:assert/strict";
import express from "express";
import { createToyoRouter } from "../server/toyo-api.mjs";

const app = express();
app.use(express.json());
app.use("/api/toyo", createToyoRouter(null, null));
const server = await new Promise((resolve, reject) => {
  const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  listener.on("error", reject);
});
const base = `http://127.0.0.1:${server.address().port}/api/toyo`;
try {
  let token, state;
  async function request(path, body, overrideToken = token) {
    const response = await fetch(`${base}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(overrideToken ? { "X-Journey-Token": overrideToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  async function arm() {
    const response = await request("browser-serial/arm", {
      revision: state.revision,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  }
  async function press(nonce, count) {
    const response = await request("browser-serial/press", {
      revision: state.revision,
      nonce,
      count,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    state = response.data;
  }
  async function event(action) {
    const response = await request("event", {
      revision: state.revision,
      event: action,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    state = response.data;
  }
  const first = await request("sessions", {});
  token = first.data.token;
  state = first.data.state;
  assert.equal(
    (await request("browser-serial/arm", { revision: 0 }, "invalid")).status,
    404,
  );
  const previous = await arm();
  const current = await arm();
  assert.equal(
    (
      await request("browser-serial/press", {
        revision: state.revision,
        nonce: previous.nonce,
        count: 1,
      })
    ).status,
    409,
  );
  await request("browser-serial/disarm", {
    revision: state.revision,
    nonce: previous.nonce,
  });
  const second = await request("sessions", {});
  assert.equal(
    (
      await request(
        "browser-serial/press",
        { revision: 0, nonce: current.nonce, count: 1 },
        second.data.token,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request("browser-serial/press", {
        revision: 0,
        nonce: current.nonce,
        count: 3,
      })
    ).status,
    400,
  );
  await press(current.nonce, 1); // Select Sedan.
  assert.equal(state.question, "range");
  await press((await arm()).nonce, 1); // Select low price band.
  assert.equal(state.stage, "dealer");
  let selected = state.vehicleId;
  await press((await arm()).nonce, 1);
  assert.notEqual(state.vehicleId, selected);
  await press((await arm()).nonce, 2);
  assert.equal(state.stage, "finance");
  assert.equal(
    (await request("browser-serial/arm", { revision: state.revision })).status,
    409,
  );
  await event({
    type: "FINANCE",
    finance: {
      method: "loan",
      savings: 8000,
      downPayment: 5000,
      reserve: 2000,
      monthlyBudget: 1000,
      ownershipCosts: 150,
      apr: 6.5,
      months: 60,
    },
  });
  assert.equal(
    (await request("browser-serial/arm", { revision: state.revision })).status,
    409,
  );
  await event({
    type: "INSURANCE",
    insurance: { mode: "included", monthly: 0, accepted: true },
  });
  const expired = await arm();
  const now = Date.now;
  try {
    const future = now() + 31000;
    Date.now = () => future;
    assert.equal(
      (
        await request("browser-serial/press", {
          revision: state.revision,
          nonce: expired.nonce,
          count: 1,
        })
      ).status,
      409,
    );
  } finally {
    Date.now = now;
  }
  const final = await arm();
  assert.equal(final.gestures, false);
  // A stale local-transport cleanup must not revoke the browser challenge.
  await request("hardware/disarm", {
    revision: state.revision,
    nonce: expired.nonce,
  });
  const finalRevision = state.revision;
  await press(final.nonce, 1);
  assert.equal(state.stage, "complete");
  assert.equal(state.confirmationSource, "browser_serial");
  assert.equal(state.outcome, "simulated_purchase");
  assert.equal(
    (
      await request("browser-serial/press", {
        revision: finalRevision,
        nonce: final.nonce,
        count: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (await request("browser-serial/arm", { revision: state.revision })).status,
    409,
  );
  console.log(
    "Browser serial API checks passed: isolated sessions, single/double navigation, fresh/expired/stale tokens, review gate, transport cleanup, one-shot checkout, and distinct browser_serial attribution.",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

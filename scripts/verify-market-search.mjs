import assert from "node:assert/strict";
import express from "express";
import { createToyoRouter } from "../server/toyo-api.mjs";
import { createMarketSearch } from "../server/market-search.mjs";
let providerCalls = 0;
let release;
let hold = false;
const search = createMarketSearch({
  apiKey: "fake-private-key",
  fetchImpl: async () => {
    providerCalls++;
    if (hold)
      await new Promise((resolve) => {
        release = resolve;
      });
    return Response.json({
      search_metadata: { status: "Success" },
      organic_results: [
        {
          title: "Toyota offer",
          link: "https://www.toyota.com/college-rebate/",
          snippet: "$500 college rebate, subject to requirements.",
        },
      ],
    });
  },
});
const app = express();
app.use(express.json());
app.use("/api/toyo", createToyoRouter(null, null, search));
const server = await new Promise((resolve, reject) => {
  const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  listener.on("error", reject);
});
const base = `http://127.0.0.1:${server.address().port}/api/toyo`;
try {
  let token, state;
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
  const config = await request("config");
  assert.equal(config.serpApi, true);
  assert.ok(!JSON.stringify(config).includes("fake-private-key"));
  await request(
    "market-search",
    { revision: 0, vehicleId: "corolla-2026", kind: "prices" },
    404,
  );
  const created = await request("sessions", {});
  token = created.token;
  state = created.state;
  await request(
    "market-search",
    { revision: state.revision, vehicleId: "corolla-2026", kind: "prices" },
    409,
  );
  async function event(action) {
    state = await request("event", { revision: state.revision, event: action });
  }
  await event({ type: "PROFILE", profile: { kind: "Sedan", range: 0 } });
  const body = {
    revision: state.revision,
    vehicleId: state.vehicleId,
    kind: "prices",
    zip: "78701",
  };
  await request("market-search", { ...body, zip: "invalid" }, 400);
  await request("market-search", { ...body, vehicleId: "camry-2026" }, 409);
  const preserved = structuredClone(state);
  const result = await request("market-search", body);
  assert.equal(result.results.length, 1);
  assert.ok(!JSON.stringify(result).includes("fake-private-key"));
  assert.deepEqual(await request("session"), preserved);
  assert.equal((await request("market-search", body)).cached, true);
  assert.equal(providerCalls, 1);
  hold = true;
  const pending = request("market-search", { ...body, kind: "offers" }, 409);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  await request("market-search", body, 429);
  await event({ type: "NEXT_CAR" });
  release();
  await pending;
  assert.equal(state.vehicleId, "corolla-hybrid-2026");
  console.log(
    "SerpAPI contract checks passed: explicit configured search, session/selection validation, key secrecy, caching, unchanged quotes/state, concurrent search handling and stale selection rejection. No real provider calls.",
  );
} finally {
  release?.();
  await new Promise((resolve) => server.close(resolve));
}

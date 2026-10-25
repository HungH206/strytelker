import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { setTimeout as pause } from "node:timers/promises";
import { createApiProxy } from "../server/api-proxy.mjs";

const probe = createPortProbe();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const backend = spawn(process.execPath, ["server/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "0.0.0.0",
    ARDUINO_PORT: "",
    GEMINI_API_KEY: "",
    ELEVENLABS_API_KEY: "",
    ELEVENLABS_VOICE_ID: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
backend.stderr.on("data", (chunk) => {
  serverOutput += chunk;
});
const backendExit = once(backend, "exit");
let gateway;
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        assert.equal(response.headers.get("cache-control"), "no-store");
        ready = true;
        break;
      }
    } catch {
      /* Wait for the real backend's listener. */
    }
    if (backend.exitCode !== null)
      throw new Error(`Backend exited: ${serverOutput}`);
    await pause(100);
  }
  assert.ok(ready, `Backend did not start: ${serverOutput}`);
  const proxy = createApiProxy({
    backendUrl: "https://backend.example.test",
    fetchImpl: async (url, options) => {
      const local = new URL(url);
      local.protocol = "http:";
      local.hostname = "127.0.0.1";
      local.port = String(port);
      return fetch(local, options);
    },
  });
  gateway = createServer((req, res) => {
    const original = new URL(req.url, "http://gateway.test");
    // Emulate vercel.json's /api/:path* rewrite and Vercel's query helper.
    const path = original.pathname.slice("/api/".length);
    original.searchParams.set("path", path);
    req.url = `/api/proxy?${original.searchParams}`;
    req.query = { path };
    proxy(req, res).catch((error) => {
      res.statusCode = 500;
      res.end(error.message);
    });
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${gateway.address().port}/api`;
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
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type"), /application\/json/);
    return response.json();
  }
  assert.equal((await request("health")).status, "ok");
  await request("does-not-exist", undefined, 404);
  assert.equal((await request("toyo/config")).inventory.length, 10);
  const session = await request("toyo/sessions", {});
  token = session.token;
  state = session.state;
  async function event(event) {
    state = await request("toyo/event", { revision: state.revision, event });
  }
  await event({ type: "PROFILE", profile: { kind: "Sedan", range: 0 } });
  await event({ type: "CHOOSE_CAR" });
  await event({
    type: "FINANCE",
    offerId: "college-500",
    eligibilityAcknowledged: true,
    finance: {
      method: "loan",
      savings: 8000,
      reserve: 2000,
      downPayment: 5000,
      monthlyBudget: 700,
      ownershipCosts: 150,
      apr: 0,
      months: 60,
    },
  });
  await event({
    type: "INSURANCE",
    insurance: { mode: "included", monthly: 0, accepted: true },
  });
  const armed = await request("toyo/browser-serial/arm", {
    revision: state.revision,
  });
  const revision = state.revision;
  state = await request("toyo/browser-serial/press", {
    revision,
    nonce: armed.nonce,
    count: 1,
  });
  assert.equal(state.stage, "complete");
  assert.equal(state.confirmationSource, "browser_serial");
  assert.equal(state.quote.rebate, 500);
  await request(
    "toyo/browser-serial/press",
    { revision, nonce: armed.nonce, count: 1 },
    409,
  );
  assert.equal((await request("toyo/session")).stage, "complete");
  console.log(
    "Deployment path passed: gateway → real Node backend, public bind, JSON health/404, session persistence, rebate quote, insurance, browser USB confirmation and replay rejection. No provider calls or physical serial access.",
  );
} finally {
  if (gateway) await new Promise((resolve) => gateway.close(resolve));
  if (backend.exitCode === null) backend.kill("SIGTERM");
  await backendExit;
}

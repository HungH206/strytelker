import test from "node:test";
import assert from "node:assert/strict";
import { createApiProxy } from "../server/api-proxy.mjs";

function response() {
  return {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}
function request(path = "toyo/config", extra = {}) {
  return {
    method: "GET",
    url: `/api/proxy?path=${path}`,
    query: { path },
    headers: {},
    ...extra,
  };
}

test("Vercel proxy forwards path, session token, JSON body and status without forwarding unrelated credentials", async () => {
  const res = response();
  const proxy = createApiProxy({
    backendUrl: "https://backend.example.test",
    fetchImpl: async (url, options) => {
      assert.equal(
        url.href,
        "https://backend.example.test/api/toyo/event?test=value",
      );
      assert.equal(options.method, "POST");
      assert.equal(options.headers["X-Journey-Token"], "session-token");
      assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, "error");
      assert.deepEqual(JSON.parse(options.body), {
        revision: 1,
        event: { type: "ANSWER", yes: true },
      });
      return Response.json({ error: "Stale revision." }, { status: 409 });
    },
  });
  await proxy(
    request("toyo/event", {
      method: "POST",
      url: "/api/proxy?path=toyo/event&test=value",
      headers: {
        "content-type": "application/json",
        "x-journey-token": "session-token",
        cookie: "private",
        authorization: "private",
      },
      body: { revision: 1, event: { type: "ANSWER", yes: true } },
    }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(JSON.parse(res.body).error, "Stale revision.");
});

test("proxy passes narration binary without decoding it as text", async () => {
  const res = response();
  const bytes = new Uint8Array([0, 255, 73, 68, 51]);
  await createApiProxy({
    backendUrl: "https://backend.example.test",
    fetchImpl: async () =>
      new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } }),
  })(request("drive/narration"), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, Buffer.from(bytes));
});

test("missing setup, invalid origins and traversal paths always return JSON errors", async () => {
  for (const [backendUrl, path, status] of [
    ["", "health", 503],
    ["http://backend.example.test", "health", 503],
    ["https://backend.example.test/api", "health", 503],
    ["https://backend.example.test", "../private", 400],
    ["https://backend.example.test", "https://evil.test", 400],
  ]) {
    const res = response();
    await createApiProxy({
      backendUrl,
      fetchImpl: () => assert.fail("Should not fetch"),
    })(request(path), res);
    assert.equal(res.statusCode, status);
    assert.match(res.headers["Content-Type"], /application\/json/);
    assert.equal(typeof JSON.parse(res.body).error, "string");
  }
});

test("host error pages, sleeping service timeouts and connection failures become actionable JSON", async () => {
  for (const [fetchImpl, status] of [
    [
      async () => new Response("The page could not be found", { status: 404 }),
      502,
    ],
    [
      async () => {
        throw new DOMException("Timed out", "TimeoutError");
      },
      504,
    ],
    [
      async () => {
        throw new Error("Connection refused");
      },
      502,
    ],
  ]) {
    const res = response();
    await createApiProxy({
      backendUrl: "https://backend.example.test",
      fetchImpl,
    })(request(), res);
    assert.equal(res.statusCode, status);
    assert.match(res.headers["Content-Type"], /application\/json/);
    assert.ok(JSON.parse(res.body).error);
  }
});

test("malformed parsed JSON and oversized requests are handled before forwarding", async () => {
  const proxy = createApiProxy({
    backendUrl: "https://backend.example.test",
    fetchImpl: () => assert.fail("Should not fetch"),
  });
  const invalid = request("toyo/event", { method: "POST" });
  Object.defineProperty(invalid, "body", {
    get() {
      throw new Error("Invalid JSON");
    },
  });
  const malformed = response();
  await proxy(invalid, malformed);
  assert.equal(malformed.statusCode, 400);
  const large = response();
  await proxy(
    request("toyo/event", { method: "POST", body: "x".repeat(25 * 1024) }),
    large,
  );
  assert.equal(large.statusCode, 413);
});

test("proxy forwards staff authorization only to monitor routes and supports CSV downloads", async () => {
  const res = response();
  await createApiProxy({
    backendUrl: "https://backend.example.test",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer staff-key");
      return new Response("Field,Value\r\nname,Example", {
        headers: { "Content-Type": "text/csv" },
      });
    },
  })(
    request("monitor/reservations", {
      headers: { authorization: "Bearer staff-key" },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.body.toString(), /Example/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readApiJson } from "../src/api-json.mjs";

test("host text and HTML error pages explain missing API routing instead of exposing JSON parser errors", async () => {
  for (const type of ["text/plain", "text/html"]) {
    const response = new Response("The page could not be found", {
      status: 404,
      headers: { "Content-Type": type },
    });
    await assert.rejects(
      () => readApiJson(response, "/api/toyo/config"),
      /\/api\/toyo\/config \(HTTP 404\).*Vercel.*Node backend/,
    );
  }
});
test("valid API responses and server error messages are preserved", async () => {
  assert.deepEqual(
    await readApiJson(Response.json({ inventory: [] }), "/api/toyo/config"),
    { inventory: [] },
  );
  await assert.rejects(
    () =>
      readApiJson(
        Response.json({ error: "Session expired." }, { status: 404 }),
        "/api/toyo/session",
      ),
    /Session expired\./,
  );
});
test("malformed JSON is reported with the failing endpoint and status", async () => {
  const response = new Response("{invalid", {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(
    () => readApiJson(response, "/api/toyo/session"),
    /invalid JSON.*\/api\/toyo\/session \(HTTP 502\)/,
  );
});

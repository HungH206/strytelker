import { readFileSync } from "node:fs";
// Integration check against a disposable local PostgreSQL database; never a hosted customer database.
import pg from "pg";
import express from "express";
import assert from "node:assert/strict";
import { createTigerReservationStore } from "../server/tiger-reservations.mjs";
import { createReservationStore } from "../server/reservations.mjs";
import { createReservationMonitor } from "../server/reservation-monitor.mjs";
import { inventory } from "../server/toyo-engine.mjs";
const adminToken = "test-only-reservation-key-32-characters";
const stores = [createReservationStore(":memory:")];
if (process.env.TEST_PG_SOCKET)
  stores.push(
    createTigerReservationStore({
      pool: new pg.Pool({
        host: process.env.TEST_PG_SOCKET,
        port: Number(process.env.TEST_PG_PORT) || 55439,
        database: "postgres",
        max: 5,
      }),
    }),
  );
else
  throw new Error(
    "Set TEST_PG_SOCKET to a disposable local PostgreSQL Unix socket directory.",
  );
for (const store of stores) {
  const state = {
    stage: "complete",
    outcome: "simulated_purchase",
    vehicleId: inventory[0].id,
    quote: { eligible: true, monthly: 300 },
    finance: { months: 60 },
    insurance: { accepted: true },
    offerId: null,
  };
  const contact = {
    name: "Reservation Test",
    phone: "+15551234567",
    consent: true,
  };
  const [first, second] = await Promise.all([
    store.save("test-journey", state, contact),
    store.save("test-journey", state, contact),
  ]);
  assert.equal(first.id, second.id);
  assert.equal((await store.list()).length, 1);
  if (store.provider === "tiger") {
    const audit = new pg.Client({
      host: process.env.TEST_PG_SOCKET,
      port: Number(process.env.TEST_PG_PORT) || 55439,
      database: "postgres",
    });
    await audit.connect();
    try {
      await audit.query(
        readFileSync(
          new URL("../server/sql/otd-estimates.sql", import.meta.url),
          "utf8",
        ),
      );
      const result = await audit.query(
        "SELECT model_name,base_msrp,taxes_and_fees,estimated_otd_price FROM toyota_otd_estimates",
      );
      assert.equal(result.rows.length, 9);
      assert.equal(
        result.rows.find((row) => row.model_name === "2026 Toyota bZ")
          .estimated_otd_price,
        "37784.25",
      );
      console.log(
        "Tiger PostgreSQL OTD seed: nine exact estimates, rerun without duplicates passed.",
      );
    } finally {
      await audit.end();
    }
  }
  assert.equal(await store.get("unrelated"), null);
  const app = express();
  app.use(express.json());
  app.use("/api/monitor", createReservationMonitor(store, { adminToken }));
  const server = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/monitor`;
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  try {
    const denied = await fetch(`${base}/reservations`);
    assert.equal(denied.status, 401);
    assert.equal((await denied.text()).includes(contact.name), false);
    const list = await fetch(`${base}/reservations`, { headers });
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.equal((await list.json()).reservations.length, 1);
    const invalid = await fetch(`${base}/reservations/${first.id}/status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "paid" }),
    });
    assert.equal(invalid.status, 400);
    const updated = await fetch(`${base}/reservations/${first.id}/status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "contacted" }),
    });
    assert.equal(updated.status, 200);
    const detail = await updated.json();
    assert.equal(detail.workflowStatus, "contacted");
    assert.equal(detail.events.at(-1).status, "contacted");
    const csv = await fetch(`${base}/reservations/${first.id}?format=csv`, {
      headers,
    });
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    assert.match(await csv.text(), /Reservation Test/);
    assert.equal((await store.get("test-journey")).status, "demo_reservation");
    const missing = await fetch(
      `${base}/reservations/00000000-0000-4000-8000-000000000000`,
      { headers },
    );
    assert.equal(missing.status, 404);
    for (let attempt = 0; attempt < 10; attempt++)
      await fetch(`${base}/reservations`);
    assert.equal((await fetch(`${base}/reservations`)).status, 429);
    console.log(
      `${store.provider}: atomic reservation/retry, private monitor, status history and CSV passed.`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
}

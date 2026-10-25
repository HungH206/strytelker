import test from "node:test";
import assert from "node:assert/strict";
import {
  tigerPoolConfig,
  createTigerReservationStore,
} from "../server/tiger-reservations.mjs";
import { inventory } from "../server/toyo-engine.mjs";
test("Tiger connection enforces verified TLS and bounded pool/timeouts", () => {
  const config = tigerPoolConfig(
    "postgresql://user:secret@db.example:5432/toyo?sslmode=no-verify&ssl=false",
  );
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(
    new URL(config.connectionString).searchParams.has("sslmode"),
    false,
  );
  assert.equal(config.max, 5);
  assert.equal(config.connectionTimeoutMillis, 10000);
  assert.throws(() => tigerPoolConfig("https://db.example"));
});
test("Tiger write failures roll back and release the connection without a SQLite fallback", async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("INSERT INTO toyo_customers"))
        throw new Error("database offline");
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const store = createTigerReservationStore({
    pool: {
      async query() {},
      async connect() {
        return client;
      },
      async end() {},
    },
  });
  await assert.rejects(
    store.save(
      "journey",
      {
        stage: "complete",
        outcome: "simulated_purchase",
        vehicleId: inventory[0].id,
        quote: { eligible: true },
      },
      { name: "Test", phone: "+15551234567", consent: true },
    ),
  );
  assert.ok(queries.includes("ROLLBACK"));
  assert.equal(queries.includes("COMMIT"), false);
  assert.ok(released);
});

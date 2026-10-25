import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  buildReservation,
  hashJourney,
  createReservationStore,
} from "./reservations.mjs";

export function tigerPoolConfig(connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("TIGER_DATABASE_URL must be a PostgreSQL connection URL.");
  // Set TLS explicitly; URL SSL parameters must not override certificate verification.
  for (const key of [
    "sslmode",
    "ssl",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.TIGER_CA_CERT
        ? { ca: process.env.TIGER_CA_CERT.replaceAll("\\n", "\n") }
        : {}),
    },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  };
}

export function createTigerReservationStore({
  pool = new pg.Pool(tigerPoolConfig(process.env.TIGER_DATABASE_URL)),
} = {}) {
  pool.on?.("error", () => console.error("Tiger Data connection interrupted."));
  let ready;
  function initialize() {
    return (ready ??= pool
      .query(
        readFileSync(
          new URL("./sql/reservations.sql", import.meta.url),
          "utf8",
        ),
      )
      .then(async () => {
        const client = await pool.connect();
        try {
          await client.query(
            readFileSync(
              new URL("./sql/otd-estimates.sql", import.meta.url),
              "utf8",
            ),
          );
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      })
      .catch((error) => {
        ready = undefined;
        throw error;
      }));
  }
  async function transaction(work) {
    await initialize();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return {
    provider: "tiger",
    initialize,
    async save(journey, state, contact) {
      const receipt = buildReservation(state, contact);
      return transaction(async (client) => {
        // Serialize retries for one journey, including across backend instances.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [hashJourney(journey)],
        );
        const existing = await client.query(
          "SELECT receipt FROM toyo_reservations WHERE journey_hash=$1",
          [hashJourney(journey)],
        );
        if (existing.rows[0]) return existing.rows[0].receipt;
        const customerId = randomUUID();
        await client.query("INSERT INTO toyo_customers VALUES ($1,$2,$3,$4)", [
          customerId,
          receipt.customer.name,
          receipt.customer.phone,
          receipt.createdAt,
        ]);
        await client.query(
          "INSERT INTO toyo_reservations (id,customer_id,journey_hash,vehicle_id,created_at,receipt) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            receipt.id,
            customerId,
            hashJourney(journey),
            receipt.vehicle.id,
            receipt.createdAt,
            receipt,
          ],
        );
        await client.query(
          "INSERT INTO toyo_reservation_plans VALUES ($1,$2,$3,$4,$5)",
          [
            receipt.id,
            receipt.finance,
            receipt.quote,
            receipt.insurance,
            receipt.offerId,
          ],
        );
        await client.query(
          "INSERT INTO toyo_reservation_events (id,reservation_id,status) VALUES ($1,$2,$3)",
          [randomUUID(), receipt.id, "new"],
        );
        return receipt;
      });
    },
    async get(journey) {
      await initialize();
      const result = await pool.query(
        "SELECT receipt FROM toyo_reservations WHERE journey_hash=$1",
        [hashJourney(journey)],
      );
      return result.rows[0]?.receipt ?? null;
    },
    async list() {
      await initialize();
      const result = await pool.query(
        "SELECT receipt,status FROM toyo_reservations ORDER BY created_at DESC LIMIT 200",
      );
      return result.rows.map((row) => ({
        ...row.receipt,
        workflowStatus: row.status,
      }));
    },
    async detail(id) {
      await initialize();
      const result = await pool.query(
        "SELECT receipt,status FROM toyo_reservations WHERE id=$1",
        [id],
      );
      if (!result.rows[0]) return null;
      const events = await pool.query(
        'SELECT status,created_at AS "createdAt" FROM toyo_reservation_events WHERE reservation_id=$1 ORDER BY created_at',
        [id],
      );
      return {
        ...result.rows[0].receipt,
        workflowStatus: result.rows[0].status,
        events: events.rows,
      };
    },
    async update(id, status) {
      const found = await transaction(async (client) => {
        const result = await client.query(
          "UPDATE toyo_reservations SET status=$2 WHERE id=$1 RETURNING id",
          [id, status],
        );
        if (!result.rowCount) return false;
        await client.query(
          "INSERT INTO toyo_reservation_events (id,reservation_id,status) VALUES ($1,$2,$3)",
          [randomUUID(), id, status],
        );
        return true;
      });
      return found ? this.detail(id) : null;
    },
    close() {
      return pool.end();
    },
  };
}

export function createConfiguredReservationStore() {
  return process.env.TIGER_DATABASE_URL
    ? createTigerReservationStore()
    : createReservationStore();
}

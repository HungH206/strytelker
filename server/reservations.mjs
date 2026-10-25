import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { inventory } from "./toyo-engine.mjs";

export const contactSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value)),
    phone: z
      .string()
      .trim()
      .max(40)
      .transform((value) => value.replace(/[\s().-]/g, ""))
      .refine(
        (value) => /^\+?[1-9]\d{7,14}$/.test(value),
        "Enter a phone number with country code.",
      ),
    consent: z.literal(true),
  })
  .strict();
export const hashJourney = (value) =>
  createHash("sha256").update(value).digest("hex");

export function buildReservation(state, contact) {
  if (state.stage !== "complete" || state.outcome !== "simulated_purchase")
    throw new Error("Confirm an affordable car plan first.");
  const customer = contactSchema.parse(contact);
  const vehicle = inventory.find((item) => item.id === state.vehicleId);
  if (!vehicle || !state.quote?.eligible)
    throw new Error("A confirmed car and finance plan are required.");
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "demo_reservation",
    notice:
      "Demo reservation only. No dealer booking, payment, loan approval, insurance policy or SMS confirmation has been issued.",
    customer: { name: customer.name, phone: customer.phone },
    consent: {
      accepted: true,
      purpose:
        "Save contact details and the confirmed plan for this reservation.",
    },
    vehicle,
    finance: state.finance,
    quote: state.quote,
    insurance: state.insurance,
    offerId: state.offerId,
    confirmationSource: state.confirmationSource,
    reservationSubmissionSource:
      state.reservationSubmissionSource || "simulator",
  };
}

export function createReservationStore(
  path = process.env.RESERVATIONS_DB_PATH || ".local/reservations.sqlite",
) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY, journey_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL, receipt_json TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS reservation_monitor (
    reservation_id TEXT PRIMARY KEY REFERENCES reservations(id), status TEXT NOT NULL DEFAULT 'new', updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS reservation_events (
    id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES reservations(id), status TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  return {
    provider: "sqlite",
    list() {
      return db
        .prepare(
          `SELECT r.receipt_json, COALESCE(m.status, 'new') AS status FROM reservations r LEFT JOIN reservation_monitor m ON m.reservation_id=r.id ORDER BY r.created_at DESC LIMIT 200`,
        )
        .all()
        .map((row) => ({
          ...JSON.parse(row.receipt_json),
          workflowStatus: row.status,
        }));
    },
    detail(id) {
      const row = db
        .prepare("SELECT receipt_json FROM reservations WHERE id=?")
        .get(id);
      if (!row) return null;
      const monitor = db
        .prepare(
          "SELECT status FROM reservation_monitor WHERE reservation_id=?",
        )
        .get(id);
      return {
        ...JSON.parse(row.receipt_json),
        workflowStatus: monitor?.status || "new",
        events: db
          .prepare(
            "SELECT status, created_at AS createdAt FROM reservation_events WHERE reservation_id=? ORDER BY created_at",
          )
          .all(id),
      };
    },
    update(id, status) {
      if (!this.detail(id)) return null;
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT INTO reservation_monitor VALUES (?, ?, ?) ON CONFLICT(reservation_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at",
        ).run(id, status, now);
        db.prepare("INSERT INTO reservation_events VALUES (?, ?, ?, ?)").run(
          randomUUID(),
          id,
          status,
          now,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return this.detail(id);
    },
    save(journey, state, contact) {
      const receipt = buildReservation(state, contact);
      const existing = this.get(journey);
      if (existing) return existing;
      db.prepare("INSERT INTO reservations VALUES (?, ?, ?, ?, ?, ?)").run(
        receipt.id,
        hashJourney(journey),
        receipt.createdAt,
        receipt.customer.name,
        receipt.customer.phone,
        JSON.stringify(receipt),
      );
      return receipt;
    },
    get(journey) {
      const row = db
        .prepare("SELECT receipt_json FROM reservations WHERE journey_hash = ?")
        .get(hashJourney(journey));
      return row ? JSON.parse(row.receipt_json) : null;
    },
    close() {
      db.close();
    },
  };
}

export function reservationCsv(receipt) {
  const rows = [["Field", "Value"]];
  function flatten(value, prefix = "") {
    for (const [key, item] of Object.entries(value)) {
      const field = prefix ? `${prefix}.${key}` : key;
      if (item && typeof item === "object" && !Array.isArray(item))
        flatten(item, field);
      else
        rows.push([
          field,
          Array.isArray(item)
            ? item
                .map((entry) =>
                  entry && typeof entry === "object"
                    ? JSON.stringify(entry)
                    : String(entry ?? ""),
                )
                .join("; ")
            : String(item ?? ""),
        ]);
    }
  }
  flatten(receipt);
  const cell = (value) =>
    `"${(/^[\s]*[=+@-]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

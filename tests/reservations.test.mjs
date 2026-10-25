import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createReservationStore,
  reservationCsv,
} from "../server/reservations.mjs";
import { inventory } from "../server/toyo-engine.mjs";
const state = {
  stage: "complete",
  outcome: "simulated_purchase",
  vehicleId: inventory[0].id,
  quote: { eligible: true, monthly: 300 },
  finance: { months: 60 },
  insurance: { accepted: true },
  offerId: "college-500",
  confirmationSource: "simulator",
};
const contact = {
  name: "Nguyễn Example",
  phone: "+1 (555) 123-4567",
  consent: true,
};
test("reservation persists server-owned snapshot, isolates journeys and deduplicates retries", () => {
  const dir = mkdtempSync(join(tmpdir(), "toyo-reservation-"));
  try {
    let store = createReservationStore(join(dir, "private.sqlite"));
    const receipt = store.save("journey-a", state, contact);
    assert.equal(receipt.customer.phone, "+15551234567");
    assert.equal(receipt.vehicle.id, inventory[0].id);
    assert.equal(receipt.finance.months, 60);
    assert.equal(store.save("journey-a", state, contact).id, receipt.id);
    assert.equal(store.get("journey-b"), null);
    store.close();
    store = createReservationStore(join(dir, "private.sqlite"));
    assert.deepEqual(store.get("journey-a"), receipt);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("reservation rejects incomplete plans, missing consent and invalid contact details", () => {
  const store = createReservationStore(":memory:");
  try {
    assert.throws(() =>
      store.save("a", { ...state, stage: "dealer" }, contact),
    );
    assert.throws(() =>
      store.save("a", { ...state, outcome: "savings_plan" }, contact),
    );
    for (const change of [
      { consent: false },
      { phone: "123" },
      { name: "\n" },
      { name: "a\u0000b" },
    ])
      assert.throws(() => store.save("a", state, { ...contact, ...change }));
  } finally {
    store.close();
  }
});
test("CSV escapes spreadsheet formulas, quotes and exports all receipt sections", () => {
  const csv = reservationCsv({
    customer: { name: '=cmd("x")', phone: "+15551234567" },
    finance: { months: 60 },
    vehicle: { name: "Toyota, Example" },
  });
  assert.ok(csv.includes('\'=cmd(""x"")'));
  assert.ok(csv.includes("'+15551234567"));
  assert.ok(csv.includes("finance.months"));
  assert.ok(csv.includes("Toyota, Example"));
});

test("monitor CSV exports SQLite status history objects and preserves original reservation receipt", () => {
  const store = createReservationStore(":memory:");
  try {
    const receipt = store.save("history", state, contact);
    const updated = store.update(receipt.id, "contacted");
    assert.equal(updated.workflowStatus, "contacted");
    assert.ok(reservationCsv(updated).includes("contacted"));
    assert.equal(store.get("history").status, "demo_reservation");
    assert.equal(store.list()[0].workflowStatus, "contacted");
  } finally {
    store.close();
  }
});

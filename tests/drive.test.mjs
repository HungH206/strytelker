import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateFinancing,
  createJourney,
  transition,
  recommendVehicle,
  scriptedDialogue,
} from "../server/drive-engine.mjs";
const finance = {
  method: "loan",
  savings: 8000,
  downPayment: 5000,
  reserve: 2000,
  monthlyBudget: 600,
  ownershipCosts: 150,
  apr: 6.5,
  months: 60,
};
function offer(params = finance, vehicleId = "corolla") {
  let s = createJourney();
  s = transition(s, { type: "SELECT_VEHICLE", vehicleId });
  s = transition(s, { type: "ACCEPT_VEHICLE" });
  return transition(s, { type: "PREPARE_OFFER", finance: params });
}
test("amortizes the selected car with fees, interest and ownership costs", () => {
  const q = calculateFinancing("corolla", finance);
  assert.equal(q.total, 25325);
  assert.equal(q.principal, 20325);
  const rate = 0.065 / 12,
    expected = (20325 * rate) / (1 - (1 + rate) ** -60);
  assert.equal(q.monthly, Math.round(expected * 100) / 100);
  assert.equal(
    q.monthlyWithOwnership,
    Math.round((q.monthly + 150) * 100) / 100,
  );
  assert.equal(q.totalPaid, Math.round((25325 + q.interest) * 100) / 100);
  assert.equal(q.cashRemaining, 3000);
  assert.equal(q.eligible, true);
  assert.ok(calculateFinancing("rav4", finance).monthly > q.monthly);
});
test("handles zero interest and fully prepaid loans without NaN", () => {
  const q = calculateFinancing("corolla", { ...finance, apr: 0 });
  assert.equal(q.monthly, 338.75);
  assert.equal(q.interest, 0);
  const prepaid = calculateFinancing("corolla", {
    ...finance,
    savings: 40000,
    downPayment: 25325,
  });
  assert.equal(prepaid.principal, 0);
  assert.equal(prepaid.monthly, 0);
  assert.equal(prepaid.interest, 0);
});
test("preserves emergency funds, checks running costs, rejects impossible down payments", () => {
  assert.equal(
    calculateFinancing("corolla", { ...finance, savings: 6000 }).eligible,
    false,
  );
  assert.equal(
    calculateFinancing("corolla", { ...finance, monthlyBudget: 450 }).eligible,
    false,
  );
  assert.equal(
    calculateFinancing("corolla", {
      ...finance,
      savings: 50000,
      downPayment: 30000,
    }).eligible,
    false,
  );
  assert.equal(
    calculateFinancing("corolla", { ...finance, method: "cash" }).cashShortfall,
    19325,
  );
  assert.equal(
    calculateFinancing("corolla", {
      ...finance,
      method: "cash",
      savings: 27325,
    }).eligible,
    true,
  );
  assert.equal(
    calculateFinancing("corolla", {
      ...finance,
      method: "cash",
      savings: 30000,
      monthlyBudget: 100,
    }).eligible,
    false,
  );
});
test("validates numbers and terms before calculating", () => {
  for (const changed of [
    { apr: -1 },
    { months: 0 },
    { savings: NaN },
    { downPayment: -10 },
    { reserve: Infinity },
    { monthlyBudget: "600" },
    { months: 120 },
  ])
    assert.throws(() =>
      calculateFinancing("corolla", { ...finance, ...changed }),
    );
  assert.throws(() => calculateFinancing("not-a-car", finance));
});
test("requires five-chapter ordering and an explicit confirmation; ignores client eligibility", () => {
  const initial = createJourney();
  assert.throws(() =>
    transition(initial, { type: "CONFIRM", source: "simulator" }),
  );
  assert.throws(() => transition(initial, { type: "PREPARE_OFFER", finance }));
  const waiting = offer();
  assert.equal(waiting.chapter, 4);
  assert.equal(waiting.confirmationSource, null);
  const ending = transition(waiting, {
    type: "CONFIRM",
    source: "simulator",
    eligible: false,
  });
  assert.equal(ending.chapter, 5);
  assert.equal(ending.outcome, "simulated_purchase");
  assert.equal(ending.revision, 4);
  assert.throws(() =>
    transition(ending, { type: "CONFIRM", source: "simulator" }),
  );
  assert.equal(waiting.chapter, 4);
});
test("unaffordable choices finish with a savings plan and can be revised before confirmation", () => {
  const waiting = offer({ ...finance, monthlyBudget: 200 });
  assert.equal(
    transition(waiting, { type: "CONFIRM", source: "hardware" }).outcome,
    "savings_plan",
  );
  const revised = transition(waiting, { type: "REVISE" });
  assert.equal(revised.chapter, 3);
  assert.equal(revised.quote, null);
  const compare = transition(waiting, { type: "COMPARE" });
  assert.equal(compare.chapter, 1);
  assert.equal(compare.vehicleId, null);
  assert.equal(compare.revision, 4);
});
test("rechecks saved assumptions at confirmation instead of trusting eligibility flags", () => {
  const waiting = offer({ ...finance, monthlyBudget: 200 });
  waiting.quote.eligible = true;
  assert.equal(
    transition(waiting, { type: "CONFIRM", source: "simulator" }).outcome,
    "savings_plan",
  );
  assert.throws(() => transition(offer(), { type: "CONFIRM", source: "ai" }));
});
test("all chapters have offline narration and recommendations are seeded", () => {
  assert.equal(recommendVehicle("adventure").id, "rav4");
  for (const s of [
    createJourney(),
    { ...createJourney(), chapter: 2, vehicleId: "camry" },
    { ...createJourney(), chapter: 3 },
    offer(),
    transition(offer(), { type: "CONFIRM", source: "simulator" }),
  ])
    assert.ok(scriptedDialogue(s).length > 60);
});

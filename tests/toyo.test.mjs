import test from "node:test";
import assert from "node:assert/strict";
import {
  inventory,
  matchingVehicles,
  createShoppingSession,
  shoppingTransition,
} from "../server/toyo-engine.mjs";

const finance = {
  method: "loan",
  savings: 8000,
  downPayment: 5000,
  reserve: 2000,
  monthlyBudget: 700,
  ownershipCosts: 150,
  apr: 6.5,
  months: 60,
};
function checkout(inputs = finance) {
  let state = shoppingTransition(createShoppingSession(), {
    type: "PROFILE",
    profile: { kind: "Sedan", range: 0 },
  });
  state = shoppingTransition(state, { type: "CHOOSE_CAR" });
  return shoppingTransition(state, { type: "FINANCE", finance: inputs });
}

test("loads all supplied models and maps crossovers, trucks and minivans to HQ categories", () => {
  assert.equal(inventory.length, 10);
  assert.equal(
    inventory.find((car) => car.id === "corolla-cross-2026").kind,
    "SUV",
  );
  assert.equal(
    inventory.find((car) => car.id === "tacoma-2026").kind,
    "Minivans and Trucks",
  );
  assert.equal(inventory.find((car) => car.id === "camry-2026").price, 29600);
  assert.equal(
    inventory.find((car) => car.id === "rav4-2026").image,
    "/vehicles/rav4.png",
  );
});

test("matches both requirements and returns a genuine empty result rather than inventing stock", () => {
  assert.deepEqual(
    matchingVehicles({ kind: "Sedan", range: 0 }).map((car) => car.id),
    ["corolla-2026", "corolla-hybrid-2026"],
  );
  assert.ok(
    matchingVehicles({ kind: "SUV", range: 1 }).every(
      (car) => car.price >= 25000 && car.price <= 40000,
    ),
  );
  assert.deepEqual(
    matchingVehicles({ kind: "Minivans and Trucks", range: 0 }),
    [],
  );
  assert.deepEqual(
    matchingVehicles({ kind: "Minivans and Trucks", range: 1 }).map(
      (car) => car.id,
    ),
    ["tacoma-2026"],
  );
  assert.deepEqual(
    matchingVehicles({ kind: "Minivans and Trucks", range: 2 }).map(
      (car) => car.id,
    ),
    ["sienna-2026"],
  );
  assert.deepEqual(matchingVehicles({ kind: "Sedan", range: 2 }), []);
});

test("single/double HQ choices and garage next/choose follow the requested flow", () => {
  let state = createShoppingSession();
  state = shoppingTransition(state, { type: "ANSWER", yes: false });
  assert.equal(state.option, 1);
  state = shoppingTransition(state, { type: "ANSWER", yes: true });
  assert.equal(state.profile.kind, "SUV");
  assert.equal(state.question, "range");
  state = shoppingTransition(state, { type: "ANSWER", yes: false });
  state = shoppingTransition(state, { type: "ANSWER", yes: true });
  assert.equal(state.stage, "dealer");
  const first = state.vehicleId;
  state = shoppingTransition(state, { type: "NEXT_CAR" });
  assert.notEqual(state.vehicleId, first);
  state = shoppingTransition(state, { type: "CHOOSE_CAR" });
  assert.equal(state.stage, "finance");
});

test("insurance is added exactly once, and confirmation requires a completed review", () => {
  let state = checkout();
  assert.throws(
    () => shoppingTransition(state, { type: "CONFIRM" }),
    /Review payment/,
  );
  state = shoppingTransition(state, {
    type: "INSURANCE",
    insurance: { mode: "additional", monthly: 100, accepted: true },
  });
  assert.equal(state.quote.assumptions.ownershipCosts, 250);
  state = shoppingTransition(state, {
    type: "INSURANCE",
    insurance: { mode: "additional", monthly: 100, accepted: true },
  });
  assert.equal(state.quote.assumptions.ownershipCosts, 250);
  state = shoppingTransition(state, { type: "CONFIRM" }, "hardware");
  assert.equal(state.outcome, "simulated_purchase");
  assert.equal(state.confirmationSource, "hardware");
  assert.throws(() => shoppingTransition(state, { type: "CONFIRM" }));
});

test("unaffordable plans finish with savings, never a successful purchase", () => {
  let state = checkout({ ...finance, monthlyBudget: 1 });
  state = shoppingTransition(state, {
    type: "INSURANCE",
    insurance: { mode: "included", monthly: 0, accepted: true },
  });
  state = shoppingTransition(state, { type: "CONFIRM" });
  assert.equal(state.outcome, "savings_plan");
});

test("revisions invalidate checkout review and invalid finance never advances", () => {
  let state = checkout();
  assert.throws(() =>
    shoppingTransition(state, {
      type: "INSURANCE",
      insurance: { mode: "additional", monthly: -1, accepted: true },
    }),
  );
  state = shoppingTransition(state, {
    type: "INSURANCE",
    insurance: { mode: "included", monthly: 0, accepted: true },
  });
  state = shoppingTransition(state, { type: "BACK" });
  assert.equal(state.reviewed, false);
  assert.throws(() =>
    shoppingTransition(state, {
      type: "FINANCE",
      finance: { ...finance, apr: -3 },
    }),
  );
  state = shoppingTransition(state, { type: "FINANCE", finance });
  assert.throws(() => shoppingTransition(state, { type: "CONFIRM" }));
});

test("building navigation enforces prerequisites and revisiting finance invalidates review", () => {
  assert.throws(
    () =>
      shoppingTransition(createShoppingSession(), {
        type: "VISIT",
        location: "dealer",
      }),
    /HQ questions/,
  );
  assert.throws(
    () =>
      shoppingTransition(createShoppingSession(), {
        type: "VISIT",
        location: "checkout",
      }),
    /Calculate a payment plan/,
  );
  let state = checkout();
  state = shoppingTransition(state, {
    type: "INSURANCE",
    insurance: { mode: "included", monthly: 0, accepted: true },
  });
  state = shoppingTransition(state, { type: "VISIT", location: "finance" });
  assert.equal(state.stage, "finance");
  assert.equal(state.reviewed, false);
  state = shoppingTransition(state, { type: "VISIT", location: "hq" });
  assert.equal(state.vehicleId, null);
  assert.equal(state.quote, null);
});

test("each listed rebate reduces principal by $500 and survives insurance and confirmation exactly once", () => {
  for (const offerId of ["college-500", "military-500"]) {
    let state = shoppingTransition(createShoppingSession(), {
      type: "PROFILE",
      profile: { kind: "Sedan", range: 0 },
    });
    state = shoppingTransition(state, { type: "CHOOSE_CAR" });
    state = shoppingTransition(state, {
      type: "FINANCE",
      finance,
      offerId,
      eligibilityAcknowledged: true,
    });
    const baseline = checkout().quote;
    assert.equal(state.quote.rebate, 500);
    assert.equal(state.quote.price, baseline.price);
    assert.equal(state.quote.total, baseline.total - 500);
    assert.equal(state.quote.principal, baseline.principal - 500);
    assert.ok(state.quote.monthly < baseline.monthly);
    assert.equal(state.quote.appliedOfferId, offerId);
    state = shoppingTransition(state, {
      type: "INSURANCE",
      insurance: { mode: "additional", monthly: 50, accepted: true },
    });
    state = shoppingTransition(state, {
      type: "INSURANCE",
      insurance: { mode: "additional", monthly: 50, accepted: true },
    });
    state = shoppingTransition(state, { type: "CONFIRM" });
    assert.equal(state.quote.total, baseline.total - 500);
    assert.equal(
      state.quote.assumptions.ownershipCosts,
      finance.ownershipCosts + 50,
    );
    assert.equal(state.quote.rebate, 500);
  }
});

test("rebates reject unknown IDs, stacking, unacknowledged eligibility and pay-in-full application", () => {
  let state = shoppingTransition(createShoppingSession(), {
    type: "PROFILE",
    profile: { kind: "Sedan", range: 0 },
  });
  state = shoppingTransition(state, { type: "CHOOSE_CAR" });
  assert.throws(
    () =>
      shoppingTransition(state, {
        type: "FINANCE",
        finance,
        offerId: "college-500",
      }),
    /Acknowledge/,
  );
  assert.throws(
    () =>
      shoppingTransition(state, {
        type: "FINANCE",
        finance,
        offerId: "fake-5000",
        eligibilityAcknowledged: true,
      }),
    /Unknown rebate/,
  );
  assert.throws(
    () =>
      shoppingTransition(state, {
        type: "FINANCE",
        finance,
        offerId: ["college-500", "military-500"],
        eligibilityAcknowledged: true,
      }),
    /Unknown rebate/,
  );
  assert.throws(
    () =>
      shoppingTransition(state, {
        type: "FINANCE",
        finance: { ...finance, method: "cash" },
        offerId: "military-500",
        eligibilityAcknowledged: true,
      }),
    /financing scenario/,
  );
  const noRebate = shoppingTransition(state, {
    type: "FINANCE",
    finance,
    offerId: null,
  });
  assert.equal(noRebate.quote.rebate, 0);
});

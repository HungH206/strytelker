import test from "node:test";
import assert from "node:assert/strict";
import { otdEstimates, vehicleEstimate } from "../server/otd-estimates.mjs";
import { inventory, calculateShoppingQuote } from "../server/toyo-engine.mjs";
const finance = {
  method: "loan",
  savings: 8000,
  reserve: 2000,
  monthlyBudget: 1000,
  ownershipCosts: 150,
  downPayment: 5000,
  apr: 0,
  months: 60,
};
test("all nine supplied fee estimates map exactly to catalog models and financing, with rebate applied once", () => {
  assert.equal(otdEstimates.length, 9);
  for (const row of otdEstimates) {
    const car = inventory.find((car) => car.id === row.vehicle_id);
    assert.equal(car.name, row.model_name);
    assert.equal(car.estimatedFees, row.taxes_and_fees);
    const quote = calculateShoppingQuote(car.id, finance);
    assert.equal(quote.fees, row.taxes_and_fees);
    assert.equal(quote.estimatedOtdPrice, row.estimated_otd_price);
    assert.equal(quote.total, row.estimated_otd_price);
    assert.equal(
      quote.principal,
      Math.round((row.estimated_otd_price - 5000) * 100) / 100,
    );
    const rebated = calculateShoppingQuote(car.id, finance, "college-500");
    assert.equal(rebated.total, row.estimated_otd_price - 500);
    assert.equal(rebated.estimatedOtdPrice, row.estimated_otd_price);
    assert.equal(rebated.fees, row.taxes_and_fees);
  }
});
test("missing Corolla estimate is labeled as a fallback and catalog price drift fails explicitly", () => {
  assert.match(
    inventory.find((car) => car.id === "corolla-2026").feeSource,
    /Fallback/,
  );
  assert.equal(vehicleEstimate("corolla-2026", 23125).estimatedFees, 2200);
  assert.throws(() => vehicleEstimate("camry-2026", 30000), /does not match/);
});

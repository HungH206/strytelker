import { z } from "zod";
export const vehicles = [
  {
    id: "corolla",
    name: "Toyota Corolla",
    price: 23125,
    character: "Practical",
    description: "A compact companion for everyday adventures.",
  },
  {
    id: "camry",
    name: "Toyota Camry",
    price: 29500,
    character: "Elegant",
    description: "A roomy carriage for comfortable journeys.",
  },
  {
    id: "rav4",
    name: "Toyota RAV4",
    price: 32000,
    character: "Adventure",
    description: "A taller companion for weekends and new horizons.",
  },
]; // Seeded fictional demo prices, not live offers or current MSRPs.
const money = z.number().finite().min(0).max(1000000);
export const financeSchema = z
  .object({
    method: z.enum(["cash", "loan"]),
    savings: money,
    downPayment: money,
    reserve: money,
    monthlyBudget: money,
    ownershipCosts: money,
    apr: z.number().finite().min(0).max(35),
    months: z.union([
      z.literal(36),
      z.literal(48),
      z.literal(60),
      z.literal(72),
    ]),
  })
  .strict();
const cents = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function calculateFinancing(
  vehicleId,
  raw,
  catalog = vehicles,
  rebateAmount = 0,
) {
  const p = financeSchema.parse(raw);
  const vehicle = catalog.find((v) => v.id === vehicleId);
  if (!vehicle) throw new Error("Choose a vehicle first.");
  const rebate = money.max(vehicle.price).parse(rebateAmount);
  const fees = money.parse(vehicle.estimatedFees ?? 2200),
    total = cents(vehicle.price + fees - rebate),
    reasons = [];
  let principal = 0,
    monthly = 0,
    interest = 0;
  if (p.reserve > p.savings)
    reasons.push("Your emergency reserve exceeds available savings.");
  if (p.method === "cash") {
    if (total > p.savings - p.reserve)
      reasons.push(
        "Paying in full would use the emergency reserve or exceed savings.",
      );
  } else {
    if (p.downPayment > total)
      reasons.push("The down payment exceeds the purchase total.");
    if (p.downPayment > p.savings - p.reserve)
      reasons.push(
        "The down payment would use the emergency reserve or exceed savings.",
      );
    principal = cents(Math.max(0, total - p.downPayment));
    const r = p.apr / 1200;
    const exact =
      principal === 0
        ? 0
        : r === 0
          ? principal / p.months
          : (principal * r) / (1 - Math.pow(1 + r, -p.months));
    monthly = cents(exact);
    interest = cents(exact * p.months - principal);
    if (monthly + p.ownershipCosts > p.monthlyBudget)
      reasons.push(
        "The payment plus estimated ownership costs exceeds the monthly budget.",
      );
  }
  if (p.method === "cash" && p.ownershipCosts > p.monthlyBudget)
    reasons.push("Estimated ownership costs exceed the monthly budget.");
  return {
    vehicleId,
    method: p.method,
    price: vehicle.price,
    rebate,
    fees,
    estimatedOtdPrice: cents(vehicle.price + fees),
    feeSource: vehicle.feeSource || "Illustrative fee assumption",
    total,
    principal,
    monthly,
    interest,
    totalPaid: cents(total + interest),
    monthlyWithOwnership: cents(monthly + p.ownershipCosts),
    cashRemaining: cents(
      p.savings - (p.method === "cash" ? total : p.downPayment),
    ),
    cashShortfall: cents(
      Math.max(
        0,
        (p.method === "cash" ? total : p.downPayment) + p.reserve - p.savings,
      ),
    ),
    eligible: reasons.length === 0,
    reasons,
    assumptions: p,
  };
}
export function recommendVehicle(preference = "practical") {
  return (
    vehicles.find(
      (v) => v.character.toLowerCase() === preference.toLowerCase(),
    ) || vehicles[0]
  );
}
export function createJourney() {
  return {
    chapter: 1,
    revision: 0,
    vehicleId: null,
    quote: null,
    confirmationSource: null,
    outcome: null,
  };
}
export function transition(state, event) {
  const next = structuredClone(state);
  const fail = () => {
    throw new Error("That action is not available in this chapter.");
  };
  switch (event.type) {
    case "SELECT_VEHICLE":
      if (state.chapter !== 1) fail();
      if (!vehicles.some((v) => v.id === event.vehicleId))
        throw new Error("Unknown vehicle.");
      Object.assign(next, {
        chapter: 2,
        vehicleId: event.vehicleId,
        quote: null,
        outcome: null,
        confirmationSource: null,
      });
      break;
    case "COMPARE":
      if (![2, 3, 4].includes(state.chapter)) fail();
      Object.assign(next, createJourney());
      break;
    case "ACCEPT_VEHICLE":
      if (state.chapter !== 2) fail();
      next.chapter = 3;
      break;
    case "PREPARE_OFFER":
      if (state.chapter !== 3) fail();
      next.quote = calculateFinancing(state.vehicleId, event.finance);
      next.chapter = 4;
      break;
    case "REVISE":
      if (state.chapter !== 4) fail();
      next.chapter = 3;
      next.quote = null;
      break;
    case "CONFIRM":
      if (state.chapter !== 4 || !state.quote) fail();
      if (!["simulator", "hardware"].includes(event.source))
        throw new Error("Unknown confirmation source.");
      // Recompute from stored inputs. Narrative output and client booleans never authorize a deal.
      next.quote = calculateFinancing(state.vehicleId, state.quote.assumptions);
      Object.assign(next, {
        chapter: 5,
        confirmationSource: event.source,
        outcome: next.quote.eligible ? "simulated_purchase" : "savings_plan",
      });
      break;
    default:
      fail();
  }
  next.revision = state.revision + 1;
  return next;
}
export function scriptedDialogue(state) {
  const car = vehicles.find((v) => v.id === state.vehicleId)?.name || "Toyota";
  return [
    "Cinderella wished for a little freedom: visiting friends, exploring new places, and finding her own way home. At the showroom, Lumi greeted her. “Every wonderful journey begins with a thoughtful choice. Which carriage feels like you?”",
    `Cinderella paused beside the ${car}. “I can picture our first adventure,” she said. Lumi smiled. “Let’s enjoy the dream and look at the whole price. Comparing another car is always a smart choice.”`,
    "“The best carriage leaves room for the rest of your life,” Lumi said. Together they counted savings, protected an emergency reserve, and included everyday ownership costs. Cinderella could compare paying in full with a pretend loan before making her choice.",
    state.quote?.eligible
      ? "“Your plan fits the assumptions we entered,” Lumi said. “This is an illustration, not a loan approval. Review every number. When you are ready, the Magic Button will confirm only our pretend purchase.”"
      : "Lumi gently closed the pretend offer. “This plan needs more room in your budget. We can compare another car, revise the numbers, or press the Magic Button to finish with a savings-plan ending. A thoughtful pause is progress, too.”",
    state.outcome === "simulated_purchase"
      ? `Cinderella held a pretend silver key to the ${car}. Her new chapter began with a choice she understood. “The real magic was taking time to plan,” Lumi said. No money changed hands, and no loan application was made.`
      : `Cinderella left the showroom with something valuable: a clearer plan. She would protect her emergency savings, review the costs, and compare another carriage when she was ready. Her dream had not ended; she had found a thoughtful next step.`,
  ][state.chapter - 1];
}

import { z } from "zod";
import { getSelectedOffer } from "./offers.mjs";
import { calculateFinancing } from "./drive-engine.mjs";

import { readFileSync } from "node:fs";

// Preserve the supplied catalog as data; map its fields at this boundary.
const rawInventory = z
  .array(
    z.object({
      id: z.string().min(1),
      make: z.string(),
      model: z.string(),
      year: z.number().int(),
      starting_msrp_usd: z.number().finite().nonnegative(),
      body_type: z.string(),
      fuel_type: z.string(),
      official_url: z.string().url(),
      price_observed_on: z.string(),
    }),
  )
  .parse(
    JSON.parse(
      readFileSync(new URL("../data/vehicles.json", import.meta.url), "utf8"),
    ),
  );
const suppliedImages = {
  "corolla-2026": "/vehicles/corolla.png",
  "camry-2026": "/vehicles/camry.png",
  "corolla-hybrid-2026": "/vehicles/corolla-hybrid.png",
  "corolla-cross-2026": "/vehicles/corolla-cross.png",
  "corolla-cross-hybrid-2026": "/vehicles/corolla-crosshybrid.png",
  "rav4-2026": "/vehicles/rav4.png",
  "bz-2026": "/vehicles/bz.png",
  "sienna-2026": "/vehicles/sienna.avif",
  "tacoma-2026": "/vehicles/tacoma.webp",
};
export const inventory = rawInventory.map((vehicle) => ({
  id: vehicle.id,
  name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
  model: vehicle.model,
  bodyType: vehicle.body_type,
  fuel: vehicle.fuel_type,
  kind: /SUV|Crossover/.test(vehicle.body_type)
    ? "SUV"
    : ["Truck", "Minivan"].includes(vehicle.body_type)
      ? "Minivans and Trucks"
      : vehicle.body_type,
  price: vehicle.starting_msrp_usd,
  image: suppliedImages[vehicle.id] || null,
  imageNote: "",
  source: vehicle.official_url,
  sourceDate: vehicle.price_observed_on,
  priceLabel: "Starting MSRP · supplied catalog",
  availability: "Reference catalog · dealer stock not connected",
}));

export function calculateShoppingQuote(vehicleId, finance, offerId = null) {
  const offer = getSelectedOffer(offerId, finance.method);
  const quote = calculateFinancing(
    vehicleId,
    finance,
    inventory,
    offer?.rebate_usd || 0,
  );
  return {
    ...quote,
    appliedOfferId: offer?.id || null,
    offerName: offer?.name || null,
  };
}

export const kinds = ["Sedan", "SUV", "Minivans and Trucks"];
export const ranges = ["$15,000–$25,000", "$25,000–$40,000", "Over $40,000"];
export const profileSchema = z
  .object({ kind: z.enum(kinds), range: z.number().int().min(0).max(2) })
  .strict();
export function matchingVehicles(profile) {
  const { kind, range } = profileSchema.parse(profile);
  return inventory
    .filter(
      (car) =>
        car.kind === kind &&
        (range === 0
          ? car.price >= 15000 && car.price < 25000
          : range === 1
            ? car.price >= 25000 && car.price <= 40000
            : car.price > 40000),
    )
    .sort((a, b) => a.price - b.price);
}
export function createShoppingSession() {
  return {
    revision: 0,
    stage: "hq",
    question: "kind",
    option: 0,
    profile: {},
    matches: [],
    vehicleId: null,
    quote: null,
    finance: null,
    offerId: null,
    insurance: null,
    reviewed: false,
    outcome: null,
    confirmationSource: null,
    recommendationSource: "rules",
    recommendation: "",
    browseAll: false,
  };
}
function chooseProfile(state, profile) {
  const matches = matchingVehicles(profile).map((car) => car.id);
  return {
    ...state,
    profile,
    matches,
    browseAll: false,
    stage: "dealer",
    vehicleId: matches[0] || null,
    recommendationSource: "rules",
    recommendation: matches.length
      ? "TOYO matched your body style and price band, with the lowest reference price first."
      : "No catalog vehicle matches both choices. Change your preferences or browse the full garage.",
  };
}
export function shoppingTransition(state, event, source = "simulator") {
  let next = structuredClone(state);
  const requireStage = (...stages) => {
    if (!stages.includes(state.stage))
      throw new Error("This action is not available at this location.");
  };
  switch (event.type) {
    case "VISIT": {
      if (state.stage === "complete")
        throw new Error("Start a new journey to shop again.");
      const location = z
        .enum(["hq", "dealer", "finance", "checkout"])
        .parse(event.location);
      if (location === state.stage) break;
      if (location === "hq") next = createShoppingSession();
      else if (location === "dealer") {
        if (!state.profile.kind || state.profile.range === undefined)
          throw new Error(
            "Complete the two HQ questions before opening the garage.",
          );
        next.stage = "dealer";
        next.reviewed = false;
      } else if (location === "finance") {
        if (!state.vehicleId)
          throw new Error("Choose a vehicle at the dealership first.");
        next.stage = "finance";
        next.reviewed = false;
      } else {
        if (!state.quote)
          throw new Error(
            "Calculate a payment plan in the financial district first.",
          );
        next.stage = "checkout";
        next.reviewed = false;
      }
      break;
    }
    case "ANSWER": {
      requireStage("hq");
      if (typeof event.yes !== "boolean") throw new Error("Choose yes or no.");
      if (!event.yes) next.option = (state.option + 1) % 3;
      else if (state.question === "kind") {
        next.profile.kind = kinds[state.option];
        next.question = "range";
        next.option = 0;
      } else
        next = chooseProfile(next, { ...state.profile, range: state.option });
      break;
    }
    case "PROFILE":
      requireStage("hq", "dealer");
      next = chooseProfile(next, profileSchema.parse(event.profile));
      break;
    case "NEXT_CAR": {
      requireStage("dealer");
      const ids = state.browseAll
        ? inventory.map((car) => car.id)
        : state.matches;
      if (!ids.length)
        throw new Error(
          "No matching cars. Change your preferences or browse all inventory.",
        );
      next.vehicleId = ids[(ids.indexOf(state.vehicleId) + 1) % ids.length];
      break;
    }
    case "BROWSE_ALL":
      requireStage("dealer");
      next.browseAll = !state.browseAll;
      next.vehicleId =
        (next.browseAll ? inventory[0]?.id : state.matches[0]) || null;
      break;
    case "INSPECT_CAR":
      requireStage("dealer");
      if (!inventory.some((car) => car.id === event.vehicleId))
        throw new Error("Unknown vehicle.");
      next.vehicleId = event.vehicleId;
      break;
    case "CHOOSE_CAR":
      requireStage("dealer");
      if (!inventory.some((car) => car.id === state.vehicleId))
        throw new Error("Inspect a vehicle first.");
      next.stage = "finance";
      next.quote = null;
      next.reviewed = false;
      break;
    case "FINANCE":
      requireStage("finance");
      if (event.offerId != null && event.eligibilityAcknowledged !== true)
        throw new Error(
          "Acknowledge assumed rebate eligibility before applying an offer.",
        );
      next.quote = calculateShoppingQuote(
        state.vehicleId,
        event.finance,
        event.offerId,
      );
      next.offerId = next.quote.appliedOfferId;
      next.finance = next.quote.assumptions;
      next.stage = "checkout";
      next.reviewed = false;
      next.insurance = null;
      break;
    case "INSURANCE": {
      requireStage("checkout");
      const insurance = z
        .object({
          mode: z.enum(["included", "additional"]),
          monthly: z.number().finite().min(0).max(1000000),
          accepted: z.literal(true),
        })
        .strict()
        .parse(event.insurance);
      next.insurance = insurance;
      next.quote = calculateShoppingQuote(
        state.vehicleId,
        {
          ...state.finance,
          ownershipCosts:
            state.finance.ownershipCosts +
            (insurance.mode === "additional" ? insurance.monthly : 0),
        },
        state.offerId,
      );
      next.reviewed = true;
      break;
    }
    case "CONFIRM":
      requireStage("checkout");
      if (!state.reviewed || !state.quote || !state.insurance?.accepted)
        throw new Error(
          "Review payment and insurance before using the magic wand.",
        );
      next.quote = calculateShoppingQuote(
        state.vehicleId,
        state.quote.assumptions,
        state.offerId,
      );
      next.outcome = next.quote.eligible
        ? "simulated_purchase"
        : "savings_plan";
      next.confirmationSource = source;
      next.stage = "complete";
      break;
    case "BACK":
      if (state.stage === "dealer") {
        next = createShoppingSession();
      } else if (state.stage === "finance") next.stage = "dealer";
      else if (state.stage === "checkout") {
        next.stage = "finance";
        next.reviewed = false;
      } else throw new Error("Cannot go back from this location.");
      break;
    default:
      throw new Error("Unknown TOYO action.");
  }
  next.revision = state.revision + 1;
  return next;
}

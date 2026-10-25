// Both transports share the same allowed actions and checkout review gate.
export function arduinoAction(state, count) {
  if (![1, 2].includes(count)) throw new Error("Invalid button gesture.");
  if (state.stage === "hq") return { type: "ANSWER", yes: count === 1 };
  if (state.stage === "dealer" && state.vehicleId)
    return { type: count === 1 ? "NEXT_CAR" : "CHOOSE_CAR" };
  if (state.stage === "checkout" && state.reviewed) return { type: "CONFIRM" };
  throw new Error(
    "Arduino navigation is available at HQ, the garage, and after checkout review.",
  );
}

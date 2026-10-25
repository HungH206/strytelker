import { readFileSync } from "node:fs";
import { z } from "zod";
const amount = z.number().finite().nonnegative();
export const otdEstimates = z
  .array(
    z
      .object({
        vehicle_id: z.string(),
        model_name: z.string(),
        base_msrp: amount,
        taxes_and_fees: amount,
        estimated_otd_price: amount,
      })
      .refine(
        (row) =>
          Math.round((row.base_msrp + row.taxes_and_fees) * 100) ===
          Math.round(row.estimated_otd_price * 100),
        "OTD must equal MSRP plus taxes and fees.",
      ),
  )
  .parse(
    JSON.parse(
      readFileSync(
        new URL("../data/otd-estimates.json", import.meta.url),
        "utf8",
      ),
    ),
  );
export function vehicleEstimate(id, price) {
  const row = otdEstimates.find((row) => row.vehicle_id === id);
  if (row && row.base_msrp !== price)
    throw new Error(`OTD estimate MSRP does not match catalog: ${id}`);
  const fees = row?.taxes_and_fees ?? 2200;
  return {
    estimatedFees: fees,
    estimatedOtdPrice: Math.round((price + fees) * 100) / 100,
    feeSource: row
      ? "User-supplied OTD estimate"
      : "Fallback assumption · no model-specific estimate supplied",
  };
}

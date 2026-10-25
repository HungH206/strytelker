import { readFileSync } from "node:fs";
import { z } from "zod";

const offerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    offer_type: z.literal("rebate"),
    rebate_usd: z.number().finite().nonnegative(),
    payment_methods: z.array(z.enum(["loan", "cash"])).min(1),
    stacking_group: z.string(),
    eligibility: z.string(),
    source_url: z.string().url(),
    terms_source_url: z.string().url(),
    valid_until: z.string().nullable(),
    region: z.string(),
    is_simulated: z.literal(true),
    verification_status: z.string(),
    observed_on: z.string(),
  })
  .strict();
export const offers = z
  .array(offerSchema)
  .parse(
    JSON.parse(
      readFileSync(new URL("../data/offers.json", import.meta.url), "utf8"),
    ),
  );

export function getSelectedOffer(offerId, method) {
  if (offerId === null || offerId === undefined) return null;
  const offer = offers.find((candidate) => candidate.id === offerId);
  if (!offer) throw new Error("Unknown rebate. Choose a listed offer.");
  if (!offer.payment_methods.includes(method))
    throw new Error(
      "These rebates require a financing scenario. Remove the rebate for a pay-in-full plan.",
    );
  if (
    offer.valid_until &&
    Date.now() > Date.parse(`${offer.valid_until}T23:59:59Z`)
  )
    throw new Error("This offer has expired.");
  return offer;
}

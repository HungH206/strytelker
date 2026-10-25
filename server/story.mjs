import { z } from "zod";
export const settingsSchema = z.object({
  hero: z.enum([
    "Little Fox",
    "Baby Dragon",
    "Curious Rabbit",
    "Young Astronaut",
  ]),
  world: z.enum([
    "Moonlit Forest",
    "Floating Islands",
    "Underwater Kingdom",
    "Starry Galaxy",
  ]),
  mood: z.enum(["Cozy", "Adventurous", "Funny"]),
  age: z.enum(["4–5", "6–9", "10–12"]),
});
export const sceneSchema = z
  .object({
    title: z.string().min(1).max(120),
    narrative: z.string().min(20).max(2400),
    choices: z.array(z.string().min(1).max(160)).max(2),
    ending: z.boolean(),
    location: z.enum(["Willow Home", "Moonlit Lake", "Crystal Cave"]),
  })
  .refine(
    (s) => (s.ending ? s.choices.length === 0 : s.choices.length === 2),
    "Scene requires two choices or an ending",
  );
export const requestSchema = settingsSchema
  .extend({
    history: z.array(sceneSchema).max(3),
    choice: z.string().max(160).optional(),
    mode: z.enum(["demo", "gemini"]).default("gemini"),
  })
  .superRefine((v, ctx) => {
    const last = v.history.at(-1);
    if (last && (last.ending || !last.choices.includes(v.choice)))
      ctx.addIssue({
        code: "custom",
        message: "Choose an offered story branch",
      });
    if (!last && v.choice)
      ctx.addIssue({ code: "custom", message: "Start without a choice" });
  });
export function demoScene({ hero, world, mood, history, choice }) {
  const step = history.length;
  const lake =
    choice?.toLowerCase().includes("lake") ||
    history.at(-1)?.location === "Moonlit Lake";
  const location =
    step === 0 ? "Willow Home" : lake ? "Moonlit Lake" : "Crystal Cave";
  const detail =
    mood === "Funny"
      ? "The star sneezed a tiny shower of sparkles. “Excuse my glitter!” it giggled."
      : mood === "Adventurous"
        ? "A ribbon of starlight unfurled like a treasure map. A wonderful discovery waited just beyond the next bend."
        : "The evening felt as soft as a favorite blanket, and every little light seemed to whisper hello.";
  const scenes = [
    {
      title: "The star that lost its way",
      narrative: `In the ${world}, a ${hero.toLowerCase()} was getting ready for a quiet evening when a gentle tap sounded at the window. Outside sat a tiny golden star, no bigger than a teacup. “I tumbled out of my constellation,” it whispered. “Could you help me find my way home?” ${detail} Lumi lit a little lantern. Two paths shimmered ahead: one toward a silver lake, the other toward a cave full of singing crystals. The little star nestled safely in the lantern, ready to go.`,
      choices: ["Visit the Moonlit Lake", "Explore the Crystal Cave"],
    },
    {
      title: lake
        ? "A lake full of little wishes"
        : "The song inside the crystals",
      narrative: `The ${hero.toLowerCase()} chose to ${choice?.toLowerCase()}. ${lake ? "At the lake, a friendly turtle offered a ride on a lily pad. The water reflected every constellation except one: a little star-shaped space waiting for their new friend." : "Inside the cave, glowing crystals hummed a gentle tune. A friendly owl explained that each crystal remembered a different constellation."} ${detail} “We can help together,” said Lumi. The star began to glow a little brighter. Nearby, a shy firefly carried a silver thread. Perhaps a gift of kindness, or a song shared with a new friend, could help them reach the sky.`,
      choices: [
        "Help the firefly weave a star ladder",
        "Sing a wishing song together",
      ],
    },
    {
      title: "A little kindness, a little magic",
      narrative: `Remembering the plan to ${choice?.toLowerCase()}, the ${hero.toLowerCase()} gathered the new friends. ${choice?.includes("ladder") ? "They wove silver threads into a sparkling ladder, making each rung together. The firefly checked every knot with its tiny lantern." : "They sang a soft wishing song. The turtle tapped a rhythm, the owl hummed, and Lumi added a bright little chime."} A bridge of light stretched toward the waiting constellation. The star hesitated. “Will you remember me?” it asked. “Always,” said the ${hero.toLowerCase()}. There was just one more thing to do before their friend could shine at home again.`,
      choices: [
        "Give the star a brave goodbye hug",
        "Make a wish for all our new friends",
      ],
    },
    {
      title: "Home among the stars",
      narrative: `The ${hero.toLowerCase()} decided to ${choice?.toLowerCase()}. With a happy shimmer, the little star floated up the bridge of light and settled into its very own place in the sky. The whole constellation twinkled a thank-you. Back in the ${world}, Lumi tucked the lantern away. ${detail} Their new friends waved goodnight, promising another adventure someday. The ${hero.toLowerCase()} curled up at home and looked through the window. One tiny star blinked twice, just for them. Helping a friend had made the whole sky a little brighter.`,
      choices: [],
    },
  ];
  return { ...scenes[step], ending: step === 3, location };
}

import type { ReactNode } from "react";
export type Stop =
  "home" | "dealer" | "finance" | "insurance" | "market" | "hq";
type IconName =
  | "spark"
  | "home"
  | "car"
  | "bank"
  | "shield"
  | "chart"
  | "hq"
  | "pin"
  | "play"
  | "reset"
  | "bolt"
  | "voice"
  | "mute";

export const stops: Record<
  Stop,
  { label: string; x: number; y: number; icon: IconName; note: string }
> = {
  home: {
    label: "Buyer's Home",
    x: 18,
    y: 68,
    icon: "home",
    note: "Budget and preferences",
  },
  dealer: {
    label: "Toyota Dealership",
    x: 47,
    y: 25,
    icon: "car",
    note: "10 models · photo garage",
  },
  finance: {
    label: "Finance District",
    x: 73,
    y: 30,
    icon: "bank",
    note: "Explore payment assumptions",
  },
  insurance: {
    label: "Payment + Insurance",
    x: 82,
    y: 63,
    icon: "shield",
    note: "Review, confirm and collect your key",
  },
  market: {
    label: "Market Center",
    x: 49,
    y: 74,
    icon: "chart",
    note: "Catalog price references",
  },
  hq: {
    label: "Agent Headquarters",
    x: 25,
    y: 35,
    icon: "hq",
    note: "Meet TOYO · preferences questionnaire",
  },
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    spark: (
      <path d="m12 2 1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2ZM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15Z" />
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    car: (
      <>
        <path d="m4 15 1.5-6h13l1.5 6M3 15h18v4H3z" />
        <circle cx="7" cy="19" r="1.5" />
        <circle cx="17" cy="19" r="1.5" />
      </>
    ),
    bank: (
      <>
        <path d="m3 9 9-6 9 6M5 10v8m5-8v8m4-8v8m5-8v8M3 21h18" />
      </>
    ),
    shield: (
      <path d="M12 3 4.5 6v5.5c0 4.7 3.2 8.1 7.5 9.5 4.3-1.4 7.5-4.8 7.5-9.5V6L12 3Zm-3 9 2 2 4-4" />
    ),
    chart: (
      <>
        <path d="M4 19V9m6 10V5m6 14v-7m5 7H2" />
      </>
    ),
    hq: (
      <>
        <path d="M4 21V7l8-4 8 4v14M8 10h2m4 0h2M8 14h2m4 0h2M9 21v-4h6v4" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7V5Z" />,
    reset: (
      <>
        <path d="M4 4v6h6" />
        <path d="M5.5 17A8 8 0 1 0 4 10" />
      </>
    ),
    bolt: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />,
    voice: (
      <>
        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6" />
      </>
    ),
    mute: (
      <>
        <path d="m11 5-5 4H3v6h3l5 4V5Z" />
        <path d="m17 9 4 4m0-4-4 4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

// Standard static carbon conversion factors (kg CO2e per unit).
// Sources: UK DEFRA 2023 / EPA / IPCC AR6 (approximate values for demo).
export const CARBON_FACTORS = {
  energy: {
    // per kWh
    electricity_eu_grid: 0.253,
    electricity_us_grid: 0.386,
    natural_gas: 0.202,
    // per liter
    diesel: 2.68,
    gasoline: 2.31,
    heating_oil: 2.52,
    // per kg
    lpg: 2.94,
    coal: 2.42,
  },
  materials: {
    // per kg
    steel: 1.85,
    aluminum: 8.24,
    plastic_pet: 3.15,
    plastic_hdpe: 2.02,
    cardboard: 0.94,
    paper: 1.09,
    glass: 0.85,
    concrete: 0.11,
    cotton: 8.3,
  },
} as const;

export interface ExtractedDocument {
  energy: { value: number; unit: string; type: string } | null;
  materials: { weightKg: number; type: string } | null;
  isEstimated: boolean;
  confidenceScore: number;
}

export interface CO2eBreakdown {
  totalKg: number;
  fromEnergy: number;
  fromMaterials: number;
  factorUsed: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "_");

export function computeCO2e(doc: ExtractedDocument): CO2eBreakdown {
  const factors: string[] = [];
  let fromEnergy = 0;
  let fromMaterials = 0;

  if (doc.energy && doc.energy.value > 0) {
    const t = norm(doc.energy.type);
    const map = CARBON_FACTORS.energy as Record<string, number>;
    const factor =
      map[t] ??
      (t.includes("diesel")
        ? map.diesel
        : t.includes("gas") && (doc.energy.unit || "").toLowerCase().startsWith("l")
          ? map.gasoline
          : t.includes("natural") || t.includes("gas")
            ? map.natural_gas
            : t.includes("elect")
              ? map.electricity_eu_grid
              : map.electricity_eu_grid);
    fromEnergy = doc.energy.value * factor;
    factors.push(`energy:${t}×${factor}`);
  }

  if (doc.materials && doc.materials.weightKg > 0) {
    const t = norm(doc.materials.type);
    const map = CARBON_FACTORS.materials as Record<string, number>;
    const factor =
      map[t] ??
      (t.includes("steel")
        ? map.steel
        : t.includes("alum")
          ? map.aluminum
          : t.includes("card")
            ? map.cardboard
            : t.includes("paper")
              ? map.paper
              : t.includes("plastic")
                ? map.plastic_pet
                : map.cardboard);
    fromMaterials = doc.materials.weightKg * factor;
    factors.push(`material:${t}×${factor}`);
  }

  return {
    totalKg: fromEnergy + fromMaterials,
    fromEnergy,
    fromMaterials,
    factorUsed: factors,
  };
}

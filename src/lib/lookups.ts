"use client";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Lookups = {
  regions: string[]; businessTypes: string[]; training: string[]; specialisations: string[];
  supplyChannels: string[]; notScanning: string[]; shopTypes: string[]; productLines: string[];
  skus: string[]; competitors: string[];
};

async function names(table: string, col = "name") {
  const { data, error } = await supabase().from(table).select(col).order(col);
  if (error) throw error;
  return (data as unknown as Record<string, string>[]).map((r) => r[col]);
}

export function useLookups() {
  const [l, setL] = useState<Lookups | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const [regions, businessTypes, training, specialisations, supplyChannels, notScanning, shopTypes, productLines, skus, competitors] =
          await Promise.all([
            names("regions"), names("business_types"), names("training_backgrounds"), names("specialisations"),
            names("supply_channels"), names("not_scanning_reasons"), names("shop_types"), names("castrol_product_lines"),
            names("castrol_skus", "label"), names("competitor_brands"),
          ]);
        setL({ regions, businessTypes, training, specialisations, supplyChannels, notScanning, shopTypes, productLines, skus, competitors });
      } catch (e) { setError(e instanceof Error ? e.message : "Could not load lists"); }
    })();
  }, []);
  return { lookups: l, error };
}

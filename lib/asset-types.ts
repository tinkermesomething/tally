import { Banknote, Building2, Car, LineChart, Box, type LucideIcon } from "lucide-react";
import type { AssetType } from "./db/assets";

export type { AssetType };

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  cash: "Cash",
  investment: "Investment",
  property: "Property",
  vehicle: "Vehicle",
  other: "Other",
};

export const ASSET_TYPE_ICONS: Record<AssetType, LucideIcon> = {
  cash: Banknote,
  investment: LineChart,
  property: Building2,
  vehicle: Car,
  other: Box,
};

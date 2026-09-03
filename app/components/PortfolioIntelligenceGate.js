"use client";

import { usePathname } from "next/navigation";
import PositionIntelligence from "./PositionIntelligence";

export default function PortfolioIntelligenceGate() {
  const pathname = usePathname();
  if (pathname !== "/" && pathname !== "/dashboard") return null;
  return <PositionIntelligence />;
}

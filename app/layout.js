import "./globals.css";
import AlertDock from "./components/AlertDock";
import ChangeDock from "./components/ChangeDock";
import DecisionDock from "./components/DecisionDock";
import RunScanButton from "./components/RunScanButton";
import LiveStockTable from "./components/LiveStockTable";
import CoverageBadge from "./components/CoverageBadge";
import PositionIntelligence from "./components/PositionIntelligence";

export const metadata={title:"Portfolio AI",description:"Personal portfolio tracker"};

export default function RootLayout({children}){return <html lang="en"><body>{children}<RunScanButton /><DecisionDock /><ChangeDock /><AlertDock /><LiveStockTable /><CoverageBadge /><PositionIntelligence /></body></html>}

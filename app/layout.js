import "./globals.css";
import AlertDock from "./components/AlertDock";
import ChangeDock from "./components/ChangeDock";
import DecisionDock from "./components/DecisionDock";
import RunScanButton from "./components/RunScanButton";
import LiveStockTable from "./components/LiveStockTable";

export const metadata={title:"Portfolio AI",description:"Personal portfolio tracker"};

export default function RootLayout({children}){return <html lang="en"><body>{children}<RunScanButton /><DecisionDock /><ChangeDock /><AlertDock /><LiveStockTable /></body></html>}

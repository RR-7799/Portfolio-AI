import "./globals.css";
import AlertDock from "./components/AlertDock";
import ChangeDock from "./components/ChangeDock";
import DecisionDock from "./components/DecisionDock";

export const metadata={title:"Portfolio AI",description:"Personal portfolio tracker"};

export default function RootLayout({children}){return <html lang="en"><body>{children}<DecisionDock /><ChangeDock /><AlertDock /></body></html>}

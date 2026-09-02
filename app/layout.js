import "./globals.css";
import AlertDock from "./components/AlertDock";

export const metadata={title:"Portfolio AI",description:"Personal portfolio tracker"};

export default function RootLayout({children}){return <html lang="en"><body>{children}<AlertDock /></body></html>}

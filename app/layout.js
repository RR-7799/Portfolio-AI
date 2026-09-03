import "./globals.css";
import RunScanButton from "./components/RunScanButton";
import PortfolioIntelligenceGate from "./components/PortfolioIntelligenceGate";

export const metadata = { title: "Portfolio AI", description: "Personal portfolio tracker" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RunScanButton />
        <PortfolioIntelligenceGate />
      </body>
    </html>
  );
}

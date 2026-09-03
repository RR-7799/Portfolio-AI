import "./globals.css";
import RunScanButton from "./components/RunScanButton";
import PositionIntelligence from "./components/PositionIntelligence";

export const metadata = { title: "Portfolio AI", description: "Personal portfolio tracker" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RunScanButton />
        <PositionIntelligence />
      </body>
    </html>
  );
}

import "./globals.css";
import RunScanButton from "./components/RunScanButton";

export const metadata = { title: "Portfolio AI", description: "Personal portfolio tracker" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RunScanButton />
      </body>
    </html>
  );
}

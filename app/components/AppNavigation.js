"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Portfolio" },
  { href: "/health", label: "Health" },
  { href: "/ai", label: "AI Analysis" },
  { href: "/decisions", label: "Decisions" },
  { href: "/rebalance", label: "Rebalance" },
  { href: "/alerts", label: "Alerts" },
  { href: "/banking-data", label: "Banking Audit" },
];

export default function AppNavigation() {
  const pathname = usePathname();

  return (
    <nav className="appNav" aria-label="Portfolio AI navigation">
      <div className="appNavInner">
        <Link href="/" className="appNavBrand">Portfolio AI</Link>
        <div className="appNavLinks">
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={`appNavLink${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

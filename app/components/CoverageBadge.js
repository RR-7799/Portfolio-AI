"use client";

import { useEffect } from "react";

export default function CoverageBadge() {
  useEffect(() => {
    const apply = () => {
      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,span,div"));
      const heading = headings.find((node) => String(node.textContent || "").trim().toUpperCase() === "STOCK HOLDINGS");
      const section = heading?.closest("section");
      if (!section) return;

      const title = section.querySelector("h2");
      const table = section.querySelector("table");
      const rows = table ? table.querySelectorAll("tbody tr").length : 0;
      if (!title || !rows) return;

      const aiHeading = headings.find((node) => String(node.textContent || "").trim().toUpperCase() === "PORTFOLIO AI");
      const aiSection = aiHeading?.closest("section");
      const aiTable = aiSection?.querySelector("table");
      const scored = aiTable ? aiTable.querySelectorAll("tbody tr").length : 0;
      const coverage = rows ? Math.min(100, (scored / rows) * 100) : 100;
      const unscored = Math.max(0, rows - scored);

      let badge = section.querySelector('[data-coverage-badge="true"]');
      if (!badge) {
        badge = document.createElement("span");
        badge.dataset.coverageBadge = "true";
        badge.style.cssText = "display:inline-flex;align-items:center;margin-left:10px;padding:5px 9px;border:1px solid #e2e8f0;border-radius:999px;font-size:12px;font-weight:700;vertical-align:middle;";
        title.insertAdjacentElement("afterend", badge);
      }

      badge.textContent = `${scored}/${rows} AI scored · ${coverage.toFixed(1)}%`;
      badge.title = unscored ? `${unscored} holding${unscored === 1 ? "" : "s"} without an AI score` : "All holdings have an AI score";
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

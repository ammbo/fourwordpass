import type { PayPalMode } from "../../shared/types";
import { usePaymentMode } from "../paymentMode";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { pageMeta, renderHead, type PageMeta } from "../../shared/site";

export function updateMetadata(meta: PageMeta, mode: PayPalMode | null = "sandbox") {
  // Parse through a template so JSON-LD stays inert until it is attached.
  const template = document.createElement("template");
  template.innerHTML = renderHead(meta, mode);
  document.head.querySelectorAll("[data-seo]").forEach((node) => node.remove());
  document.head.append(template.content);
}

export function PageMetadata() {
  const [path] = useLocation();
  const mode = usePaymentMode();
  useEffect(() => {
    // Preserve the server's story metadata while its live data loads.
    if (!/^\/b\/[^/]+$/.test(path)) updateMetadata(pageMeta(path, mode), mode);
  }, [path, mode]);
  return null;
}

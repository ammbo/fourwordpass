import { useEffect } from "react";
import { useLocation } from "wouter";
import { pageMeta, renderHead, type PageMeta } from "../../shared/site";

export function updateMetadata(meta: PageMeta) {
  // Parse through a template so JSON-LD stays inert until it is attached.
  const template = document.createElement("template");
  template.innerHTML = renderHead(meta);
  document.head.querySelectorAll("[data-seo]").forEach((node) => node.remove());
  document.head.append(template.content);
}

export function PageMetadata() {
  const [path] = useLocation();
  useEffect(() => {
    // Preserve the server's story metadata while its live data loads.
    if (!/^\/b\/[^/]+$/.test(path)) updateMetadata(pageMeta(path));
  }, [path]);
  return null;
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { PAGES, renderHead } from "./shared/site.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare(), {
    name: "public-metadata",
    transformIndexHtml(html) {
      return html.replace("<!-- page-metadata -->", renderHead(PAGES["/"]));
    },
  }],
});

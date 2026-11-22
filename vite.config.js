import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { setupApiPlugin } from "./server/setup-api.js";
import { pagesPlugin } from "./scripts/pages-plugin.js";
import { defaultSetup, validateSetup } from "./src/settings.js";

const setupFile = fileURLToPath(
  new URL("./public/settings.json", import.meta.url),
);
export default defineConfig({
  base: "./",
  plugins: [
    pagesPlugin(),
    setupApiPlugin(setupFile, undefined, {
      defaults: defaultSetup,
      validate: validateSetup,
    }),
  ],
  define: {
    __BUNDLED_SETUP__: JSON.stringify(
      validateSetup(JSON.parse(readFileSync(setupFile, "utf8"))),
    ),
  },
  server: { host: "127.0.0.1", port: 1234, strictPort: false, open: false },
});

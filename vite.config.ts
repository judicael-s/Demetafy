import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./src/ui", import.meta.url));
const outDir = fileURLToPath(new URL("./dist/ui", import.meta.url));

export default defineConfig({
  root,
  publicDir: false,
  plugins: [solid(), tailwindcss()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: "esnext",
    sourcemap: !!process.env.TAURI_DEBUG,
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
  },
});

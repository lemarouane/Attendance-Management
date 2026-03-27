import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serverProcess = null;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
    {
      name: "start-backend",
      configureServer() {
        if (serverProcess) return;

        const serverDir = path.resolve(__dirname, "server");

        serverProcess = spawn("node", ["index.js"], {
          cwd: serverDir,
          stdio: "inherit",
          shell: true,
        });

        serverProcess.on("error", (err) => {
          console.error("❌ Failed to start backend:", err.message);
        });

        process.on("exit", () => serverProcess?.kill());
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
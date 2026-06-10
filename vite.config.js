import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

function preventApiPortConflict(apiPort) {
  return {
    name: "prevent-api-port-conflict",
    configureServer(server) {
      const vitePort = Number(server.config.server.port || 5173)
      if (vitePort !== apiPort) return

      throw new Error(
        `Vite cannot run on port ${vitePort} because ELSET_API_PORT is also ${apiPort}. `
        + "Start the frontend on a different port or change ELSET_API_PORT."
      )
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const apiPort = Number(env.ELSET_API_PORT || env.PORT || 3101)
  const frontendPort = Number(env.ELSET_FRONTEND_PORT || 5173)

  return {
    plugins: [react(), tailwindcss(), preventApiPortConflict(apiPort)],
    server: {
      port: frontendPort,
      strictPort: true,
      watch: {
        ignored: [
          "**/data/**",
          "**/*.log",
        ],
      },
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
})

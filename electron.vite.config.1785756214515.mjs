// electron.vite.config.ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var __electron_vite_injected_dirname = "C:\\Users\\Glace\\Desktop\\wps\\wps-agent-editor";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__electron_vite_injected_dirname, "electron/main.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__electron_vite_injected_dirname, "electron/preload.ts")
      }
    }
  },
  renderer: {
    root: resolve(__electron_vite_injected_dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/renderer/index.html")
      }
    },
    resolve: {
      alias: {
        "@": resolve(__electron_vite_injected_dirname, "src")
      }
    },
    plugins: [react()]
  }
});
export {
  electron_vite_config_default as default
};

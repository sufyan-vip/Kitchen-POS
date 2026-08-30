import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/**
 * Inject a strict Content-Security-Policy into the production bundle only.
 * Dev mode is left untouched so Vite HMR and the React refresh preamble work.
 * The policy allows only same-origin scripts; inline styles, data/blob/local
 * images and websockets are permitted for the offline-first desktop app.
 */
function productionCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: file: local:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return {
    name: "inject-production-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig(() => {
  return {
    base: "./",
    plugins: [react(), productionCsp()],
    server: {
      port: 5205,
      host: "0.0.0.0",
      allowedHosts: true,
      cors: true,
      headers: {
        "Cross-Origin-Embedder-Policy": "unsafe-none",
        "Cross-Origin-Opener-Policy": "same-origin",
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // Vendor chunks - split by library
            if (id.includes("node_modules")) {
              if (id.includes("react") || id.includes("react-dom")) {
                return "vendor-react";
              }
              if (id.includes("react-router-dom")) {
                return "vendor-router";
              }
              return "vendor";
            }

            // Split layouts into separate chunks
            if (id.includes("/layouts/")) {
              return "layouts";
            }

            // Split pages into separate chunks (each page gets its own chunk)
            if (id.includes("/pages/")) {
              const pageName = id.split("/pages/")[1]?.split("/")[0];
              if (pageName) {
                return `page-${pageName.toLowerCase()}`;
              }
            }

            // Split organisms (heavy components) into separate chunk
            if (id.includes("/components/organisms/")) {
              return "components-organisms";
            }

            // Split contexts into separate chunk
            if (id.includes("/contexts/")) {
              return "contexts";
            }

            // Split SVG sprite loader into separate chunk
            if (id.includes("/components/atoms/svg-sprite-loader/")) {
              return "components-svg-sprite";
            }

            // demo/ and examples/ fall through to Rollup's default chunking
          },
          // Optimize chunk file names for better caching
          chunkFileNames: "assets/js/[name]-[hash].js",
          entryFileNames: "assets/js/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            // Separate CSS into its own directory for better organization
            if (assetInfo.name?.endsWith(".css")) {
              return "assets/css/[name]-[hash][extname]";
            }
            return "assets/[ext]/[name]-[hash].[ext]";
          },
        },
      },
      target: "esnext",
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          pure_funcs: ["console.log", "console.info"],
          passes: 2,
        },
        format: {
          comments: false,
        },
      },
      cssCodeSplit: true,
      cssMinify: true,
      cssTarget: "esnext",
      sourcemap: false,
      chunkSizeWarningLimit: 500,
      modulePreload: {
        polyfill: false,
        // Only preload vendor chunks and main entry, not page-specific chunks
        resolveDependencies: (filename, deps) => {
          if (
            filename.includes("vendor-") ||
            filename.includes("index") ||
            !filename.includes("page-")
          ) {
            return deps;
          }
          return [];
        },
      },
    },
    resolve: {
      tsconfigPaths: true,
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-router-dom", "zustand"],
    },
  };
});

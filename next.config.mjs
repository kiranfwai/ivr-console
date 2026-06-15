/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Run src/instrumentation.ts on server boot to start the bulk-call worker.
    instrumentationHook: true,
    serverActions: { bodySizeLimit: "8mb" },
    // @resvg/resvg-js ships a platform-specific .node binary; let Node require it
    // at runtime rather than letting webpack try to parse it.
    serverComponentsExternalPackages: ["@resvg/resvg-js"],
  },
};
export default nextConfig;

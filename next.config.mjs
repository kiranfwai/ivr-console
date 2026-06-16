/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Run src/instrumentation.ts on server boot to start the bulk-call worker.
    instrumentationHook: true,
    // Large contact uploads (BUG 5). Route handlers (/api/bulk) have no built-in
    // body cap, so the real limit is nginx's client_max_body_size — see README
    // §Deploy. This raises the Server Actions cap to match for any action path.
    serverActions: { bodySizeLimit: "50mb" },
    // @resvg/resvg-js ships a platform-specific .node binary; let Node require it
    // at runtime rather than letting webpack try to parse it.
    serverComponentsExternalPackages: ["@resvg/resvg-js"],
  },
};
export default nextConfig;

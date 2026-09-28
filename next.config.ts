import type { NextConfig } from "next";

// Static export so the prototype can be hosted anywhere (Vercel, GitHub Pages, etc).
// NEXT_PUBLIC_BASE_PATH is set only when hosting under a sub-path (e.g. GitHub Pages).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "export",
  trailingSlash: true,
  basePath: basePath || undefined,
  images: { unoptimized: true },
};

export default nextConfig;

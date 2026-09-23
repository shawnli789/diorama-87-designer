/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/diorama-87-designer",
  assetPrefix: "/diorama-87-designer/",
  trailingSlash: true,
  images: { unoptimized: true },
};

module.exports = nextConfig;

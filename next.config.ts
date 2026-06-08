import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Allow epubjs to register unload listeners inside the epub iframe
          {
            key: "Permissions-Policy",
            value: "unload=*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

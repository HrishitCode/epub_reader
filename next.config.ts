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
          // Don't let other sites frame the app (clickjacking)
          { key: "X-Frame-Options", value: "DENY" },
          // Don't MIME-sniff responses into executable types
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak full URLs (which include bookUrl params) to third parties
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

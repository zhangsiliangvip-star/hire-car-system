import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.DRIVER_PWA_TEST_MODE === "zsipqwipauzgbqvppwjf"
    ? { distDir: ".next-driver-pwa", allowedDevOrigins: ["172.20.10.4"] }
    : {}),
};

export default nextConfig;

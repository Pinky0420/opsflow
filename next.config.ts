import type { NextConfig } from "next";
import { existsSync } from "fs";
import { join } from "path";

const hasLocalApi = existsSync(join(__dirname, "src/app/api"));

const nextConfig: NextConfig = {
  ...(hasLocalApi
    ? {}
    : { output: "export", trailingSlash: true, images: { unoptimized: true } }),
};

export default nextConfig;

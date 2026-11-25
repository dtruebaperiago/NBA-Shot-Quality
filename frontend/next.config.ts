import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  agentRules: false,
  outputFileTracingIncludes: {
    "/*": ["./.local/archive.json", "./.local/player-seasons.json"],
  },
  images: {
    remotePatterns: [{
      protocol: "https",
      hostname: "cdn.nba.com",
      pathname: "/headshots/nba/latest/260x190/*.png",
      search: "",
    }],
  },
};

export default config;

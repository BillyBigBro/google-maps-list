import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stops `next dev` regenerating AGENTS.md / CLAUDE.md at the project root.
  // Without this, deleting them only lasts until the next dev server start.
  agentRules: false,
};

export default nextConfig;

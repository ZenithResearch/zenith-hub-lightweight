import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  reactStrictMode: true,
  // This small local operator builds on the same Mac as its native services.
  experimental: { cpus: 1 },
}

export default nextConfig

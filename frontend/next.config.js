/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy /api/* to backend — works for both dev (localhost:3001) and prod (via nginx)
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_URL || 'http://localhost:8080'}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

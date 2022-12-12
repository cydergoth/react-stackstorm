/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    output: 'standalone',
    swcMinify: true,
    experimental: {
        modularizeImports: {
            '@mui/material': {
                transform: '@mui/material/{{member}}'
            },
            '@mui/icons-material/?(((\\w*)?/?)*)': {
                transform: '@mui/icons-material/{{ matches.[1] }}/{{member}}',
            },
       },
    },
    async rewrites() {
        return [
            {
                source: "/lifecycle/api/:slug*",
                destination: process.env.LIFECYCLE_API + "/api/:slug*",
            },
            {
                source: "/lifecycle/echo",
                destination: process.env.LIFECYCLE_API + "/echo",
            },
            {
                source: "/st2api/:slug*",
                destination: process.env.STACKSTORM + "/st2api/:slug*"
            }
        ];
    },
};

module.exports = nextConfig;

import type { NextConfig } from 'next';
const config: NextConfig = {agentRules:false,distDir:process.env.NEXT_DIST_DIR||'.next',turbopack:{root:process.cwd()},output:'standalone',serverExternalPackages:['pdfjs-dist','@napi-rs/canvas','sharp','qiniu','@aws-sdk/client-s3'],experimental:{proxyClientMaxBodySize:'52mb'}};
export default config;

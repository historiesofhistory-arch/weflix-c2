#!/bin/bash
set -e

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Error: CLOUDFLARE_API_TOKEN environment variable is required"
  echo "Get your token from: https://dash.cloudflare.com/profile/api-tokens"
  echo "Create a token with 'Edit Cloudflare Workers' permissions"
  exit 1
fi

echo "Deploying MovieBox proxy worker to Cloudflare..."
npx wrangler deploy --var API_KEY:"$(openssl rand -hex 16)" 2>&1

echo ""
echo "Deployment complete!"
echo "Your worker URL will be shown above (e.g., https://moviebox-proxy.<your-subdomain>.workers.dev)"
echo ""
echo "Next steps:"
echo "1. Copy the worker URL and set it as CF_MOVIEBOX_PROXY_URL in Replit secrets"
echo "2. If you set an API_KEY above, also set CF_MOVIEBOX_API_KEY to the same value"

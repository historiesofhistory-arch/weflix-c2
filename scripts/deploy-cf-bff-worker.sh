#!/bin/bash
set -e

ACCOUNT_ID="6adb999bffd33abc3b2437ca58014534"
WORKER_NAME="weflix-bff-proxy"
SCRIPT_PATH="scripts/cf-bff-worker.js"

echo "Deploying Cloudflare Worker: $WORKER_NAME"

METADATA='{"main_module":"cf-bff-worker.js","compatibility_date":"2024-01-01","bindings":[]}'

RESPONSE=$(curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$WORKER_NAME" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F "cf-bff-worker.js=@$SCRIPT_PATH;type=application/javascript+module" \
  -F "metadata=$METADATA;type=application/json")

SUCCESS=$(echo "$RESPONSE" | grep -o '"success":\s*[a-z]*' | head -1 | grep -o 'true\|false')

if [ "$SUCCESS" = "true" ]; then
  echo "Worker deployed successfully!"
  
  echo "Enabling workers.dev subdomain..."
  SUBDOMAIN_RESP=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$WORKER_NAME/subdomain" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled":true}')
  echo "Subdomain response: $SUBDOMAIN_RESP"
  
  echo ""
  echo "Checking workers.dev subdomain..."
  SUBDOMAIN_INFO=$(curl -s \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
  echo "Subdomain info: $SUBDOMAIN_INFO"
  
  SUBDOMAIN=$(echo "$SUBDOMAIN_INFO" | grep -o '"subdomain":"[^"]*"' | head -1 | cut -d'"' -f4)
  
  if [ -n "$SUBDOMAIN" ]; then
    WORKER_URL="https://$WORKER_NAME.$SUBDOMAIN.workers.dev"
    echo ""
    echo "Worker URL: $WORKER_URL"
    echo ""
    echo "Set this as BFF_PROXY_URL in production:"
    echo "  BFF_PROXY_URL=$WORKER_URL"
  else
    echo "Could not determine subdomain. Check Cloudflare dashboard."
  fi
else
  echo "Deployment failed!"
  echo "$RESPONSE"
fi

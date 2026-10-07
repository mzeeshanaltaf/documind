#!/usr/bin/env bash
# Queue a Coolify deploy for one application, retrying with backoff.
#   COOLIFY_BASE_URL=… COOLIFY_API_TOKEN=… coolify-deploy.sh <application-uuid>
# Coolify's own push webhook is fire-once (a transient 502 drops the deploy), so
# GitHub Actions is the only deploy trigger; "Auto Deploy" is off on both apps.
set -u
uuid="$1"
: "${COOLIFY_BASE_URL:?}" "${COOLIFY_API_TOKEN:?}"

for i in 1 2 3 4 5; do
  # POST is required (GET returns a 405 stub). 90 s: the shared VPS can be busy.
  code=$(curl -sS -o /tmp/coolify-deploy.json -w "%{http_code}" --max-time 90 -X POST \
    "${COOLIFY_BASE_URL%/}/api/v1/deploy?uuid=${uuid}&force=false" \
    -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" || echo "000")
  echo "Attempt $i -> HTTP $code"
  if [ "$code" = "200" ]; then
    cat /tmp/coolify-deploy.json; echo
    exit 0
  fi
  [ "$i" -lt 5 ] && sleep $((i * 20))
done
echo "::error::Could not queue the Coolify deploy for ${uuid} after 5 attempts."
exit 1

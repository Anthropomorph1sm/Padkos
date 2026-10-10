#!/usr/bin/env bash
# Installed as /usr/local/bin/padkos-deploy and run (via sudo) as the forced command of the
# padkos-deploy SSH key. Reads a gzipped `docker save` of padkos:<git sha> on stdin, makes it
# live, and rolls back to the previous image if the health check fails.
set -euo pipefail
cd /opt/padkos

tag=$(gunzip | docker load | sed -n 's/^Loaded image: \(padkos:[0-9a-f]\{7,40\}\)$/\1/p' | tail -n 1)
if [ -z "$tag" ]; then
  echo "upload did not contain a padkos:<sha> image" >&2
  exit 1
fi
echo "loaded $tag"

if docker image inspect padkos:live >/dev/null 2>&1; then
  docker tag padkos:live padkos:previous
fi
docker tag "$tag" padkos:live
docker compose up -d --remove-orphans

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    echo "$tag is live"
    # keep live and previous, drop older builds
    docker images padkos --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
      | while read -r ref id; do
          case "$ref" in padkos:live | padkos:previous | "$tag") continue ;; esac
          docker rmi "$ref" >/dev/null 2>&1 || true
        done
    exit 0
  fi
  sleep 2
done

echo "health check failed, rolling back" >&2
docker compose logs --tail 50 app >&2 || true
if docker image inspect padkos:previous >/dev/null 2>&1; then
  docker tag padkos:previous padkos:live
  docker compose up -d
fi
exit 1

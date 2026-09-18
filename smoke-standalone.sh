#!/usr/bin/env bash
# Boots the freshly built standalone bundle and requests one *rendered* page,
# so a bundle that can't load its own modules never gets deployed.
#
# Run after "pnpm run build:selfhosted". "/auth/login" on purpose: it is
# public and rendered. A redirect-only path like "/" is answered by the proxy
# before any page module loads, so it would pass on a broken bundle.

set -uo pipefail

cd "$(dirname "$0")" || exit 1

PORT="${SMOKE_PORT:-3999}"
URL="http://127.0.0.1:$PORT/auth/login"
TIMEOUT="${SMOKE_TIMEOUT:-45}"

if [ ! -f dist/server.js ]; then
  echo "smoke: dist/server.js not found - run 'pnpm run build:selfhosted' first"
  exit 1
fi

# Files pulled in by "outputFileTracingIncludes" are read from disk at runtime
# on paths no page reaches at boot, so check the bundle got them first. The
# globs come from the serialized config inside the bundle.
node -e '
  const fs = require("node:fs");
  const manifest = "dist/.next/required-server-files.json";

  if (!fs.existsSync(manifest)) {
    console.error(`smoke: ${manifest} not found - is dist/ a standalone build?`);
    process.exit(1);
  }

  const includes =
    JSON.parse(fs.readFileSync(manifest, "utf8")).config
      ?.outputFileTracingIncludes ?? {};
  let missing = 0;

  for (const [route, globs] of Object.entries(includes)) {
    for (const glob of globs) {
      if (fs.globSync(glob.replace(/^\.\//, ""), { cwd: "dist" }).length === 0) {
        console.error(`smoke: "${route}" traced nothing for ${glob}`);
        missing += 1;
      }
    }
  }

  process.exit(missing === 0 ? 0 : 1);
' || exit 1

# the bundle has no .env of its own; hand it the environment the app runs with
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PORT="$PORT" HOSTNAME=127.0.0.1 node dist/server.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null' EXIT

status=""

for _ in $(seq "$TIMEOUT"); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "smoke: server exited during boot"
    exit 1
  fi

  status="$(node -e 'fetch(process.argv[1]).then((r) => console.log(r.status)).catch(() => {})' "$URL")"

  if [ "$status" = "200" ]; then
    echo "smoke: $URL -> 200"
    exit 0
  fi

  sleep 1
done

echo "smoke: $URL -> ${status:-no response} after ${TIMEOUT}s"
exit 1

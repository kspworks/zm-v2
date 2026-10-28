#!/bin/sh
# Boots the standalone bundle and requests one *rendered* page, so a bundle
# that can't load its own modules never gets deployed.
#
# POSIX sh, not bash: besides the repository's dist/ (after
# "pnpm run build:selfhosted", with the environment from ./.env), it runs
# inside the alpine runtime image, fed on stdin so the script itself never has
# to be part of that image - see the "build" job in .gitlab-ci.yml:
#
#   docker run --rm -i -e SMOKE_DIR=/app -e DATABASE_URL=... <image> sh -s < smoke-standalone.sh
#
# "/auth/login" on purpose: it is public and rendered. A redirect-only path
# like "/" is answered by the proxy before any page module loads, so it would
# pass on a broken bundle. The page reads the database (does an admin exist?),
# so DATABASE_URL has to reach a migrated one.

set -u

PORT="${SMOKE_PORT:-3999}"
URL="http://127.0.0.1:$PORT/auth/login"
TIMEOUT="${SMOKE_TIMEOUT:-45}"

if [ -n "${SMOKE_DIR:-}" ]; then
  cd "$SMOKE_DIR" || exit 1
else
  cd "$(dirname "$0")" || exit 1

  # the bundle has no .env of its own; hand it the environment the app runs with
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
  fi

  cd dist 2>/dev/null || {
    echo "smoke: dist/ not found - run 'pnpm run build:selfhosted' first"
    exit 1
  }
fi

if [ ! -f server.js ]; then
  echo "smoke: $(pwd)/server.js not found - is this a standalone build?"
  exit 1
fi

# Files pulled in by "outputFileTracingIncludes" are read from disk at runtime
# on paths no page reaches at boot, so check the bundle got them first. The
# globs come from the serialized config inside the bundle.
node -e '
  const fs = require("node:fs");
  const manifest = ".next/required-server-files.json";

  if (!fs.existsSync(manifest)) {
    console.error(`smoke: ${manifest} not found - is this a standalone build?`);
    process.exit(1);
  }

  const includes =
    JSON.parse(fs.readFileSync(manifest, "utf8")).config
      ?.outputFileTracingIncludes ?? {};
  let missing = 0;

  for (const [route, globs] of Object.entries(includes)) {
    for (const glob of globs) {
      if (fs.globSync(glob.replace(/^\.\//, "")).length === 0) {
        console.error(`smoke: "${route}" traced nothing for ${glob}`);
        missing += 1;
      }
    }
  }

  process.exit(missing === 0 ? 0 : 1);
' || exit 1

PORT="$PORT" HOSTNAME=127.0.0.1 node server.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null' EXIT

status=""
elapsed=0

while [ "$elapsed" -lt "$TIMEOUT" ]; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "smoke: server exited during boot"
    exit 1
  fi

  # node rather than curl or wget: it is the one tool every place this runs has
  status="$(node -e 'fetch(process.argv[1]).then((r) => console.log(r.status)).catch(() => {})' "$URL")"

  if [ "$status" = "200" ]; then
    echo "smoke: $URL -> 200"
    exit 0
  fi

  sleep 1
  elapsed=$((elapsed + 1))
done

echo "smoke: $URL -> ${status:-no response} after ${TIMEOUT}s"
exit 1

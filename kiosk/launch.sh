#!/usr/bin/env bash
# Launch the station in kiosk mode. Run from the project root:  bash kiosk/launch.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}/"

if [ ! -d dist ]; then
  echo "Building..."
  npm run build
fi

# Serve the built files locally. Module workers do not run from file:// URLs.
npx --yes vite preview --port "$PORT" --host 127.0.0.1 >/tmp/casa-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  if curl -sf "$URL" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

# Keep the laptop awake for the length of the fair.
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dimsu &
  CAFFEINE_PID=$!
  trap 'kill $SERVER_PID $CAFFEINE_PID 2>/dev/null || true' EXIT
fi

CHROME=""
for candidate in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then CHROME="$candidate"; break; fi
done

if [ -z "$CHROME" ]; then
  echo "Chrome not found. Open $URL manually and press F11 for fullscreen."
  wait $SERVER_PID
fi

"$CHROME" \
  --kiosk \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --disable-features=TranslateUI,MediaRouter \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir="/tmp/casa-kiosk-profile" \
  --app="$URL"

#!/usr/bin/env bash
# X display can put a lock in, that sometimes will stay in the container. Nuke it as it isn't needed
rm /tmp/.X99-lock
set -e
# Check if STREAM_KEY is empty
if [ -z "$STREAM_KEY" ]; then
  echo "Error: STREAM_KEY is not set or empty"
  exit 1
fi
# Start PulseAudio (virtual audio) in the background
/twitch-streamer/pulse-virtual-audio.sh &

# Start Xvfb (the in-memory X server) in the background
Xvfb $DISPLAY -screen 0 1920x1080x24 &
echo "Display is ${DISPLAY}"

# Give Xvfb a moment to start
sleep 2

mkdir -p /home/chrome

# Launch Chrome in the background, pointing at your site.
#   --disable-background-timer-throttling & related flags to prevent fps throttling in headless/Xvfb
DISPLAY=$DISPLAY google-chrome \
  --remote-debugging-port=9222 \
  --disable-dev-shm-usage \
  --disable-infobars \
  --no-first-run \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --user-data-dir=/home/chrome/chrome-data \
  --window-size=1920,1080 --window-position=0,0 \
  --kiosk \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --disable-features=TranslateUI \
  --disable-ipc-flooding-protection \
  --max_old_space_size=4096 \
  "http://diplomacy:4173" &

sleep 5 # let the page load or animations start

# Start streaming with FFmpeg.
#  - For video: x11grab at 30fps
#  - For audio: pulse from the default device
exec ffmpeg -y \
  -f x11grab -thread_queue_size 1024 -r 30 -s 1920x1080 -draw_mouse 0 -i $DISPLAY \
  -f pulse -thread_queue_size 1024 -i default \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -b:v 6000k -maxrate 6000k -bufsize 6000k \
  -pix_fmt yuv420p -g 60 -keyint_min 60 \
  -c:a aac -b:a 160k -ar 44100 \
  -vsync cfr -fps_mode cfr \
  -force_key_frames "expr:gte(t,n_forced*2)" \
  -f flv "rtmp://ingest.global-contribute.live-video.net/app/$STREAM_KEY"

# 'exec' ensures ffmpeg catches any SIGTERM and stops gracefully,
# which will then terminate the container once ffmpeg ends.

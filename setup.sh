#!/usr/bin/env bash
# SWEDEN one-time setup (Raspberry Pi OS 64-bit / Debian / Ubuntu)
set -e
cd "$(dirname "$0")"
echo "== system packages"
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip tmux
echo "== python venv"
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt
mkdir -p data logs
chmod +x start.sh stop.sh status.sh
echo
echo "Setup complete. Next: ./start.sh   (then ./status.sh to check it is collecting)"

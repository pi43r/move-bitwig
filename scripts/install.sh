#!/bin/bash
# Install Move Bitwig module to Move
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$REPO_ROOT"

if [ ! -f "dist/move-bitwig-module.tar.gz" ]; then
    echo "Error: module archive not found. Run python3 scripts/build.py first."
    exit 1
fi

echo "=== Installing Move Bitwig Module ==="

# Deploy to Move - overtake subdirectory
echo "Copying module to Move..."
ssh ableton@move.local "mkdir -p /data/UserData/schwung/modules/overtake/move-bitwig"
ssh ableton@move.local "tar -xzf - -C /data/UserData/schwung/modules/overtake" < dist/move-bitwig-module.tar.gz

# Set permissions so Module Store can update later
echo "Setting permissions..."
ssh ableton@move.local "chmod -R a+rw /data/UserData/schwung/modules/overtake/move-bitwig"

echo ""
echo "=== Install Complete ==="
echo "Module installed to: /data/UserData/schwung/modules/overtake/move-bitwig/"
echo ""
echo "Leave and reopen Move Bitwig in Schwung to load the new module."

#!/bin/bash
# Install Move Bitwig module to Move
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$REPO_ROOT"

if [ ! -d "dist/move-bitwig" ]; then
    echo "Error: dist/move-bitwig not found. Run ./scripts/build.sh first."
    exit 1
fi

echo "=== Installing Move Bitwig Module ==="

# Deploy to Move - overtake subdirectory
echo "Copying module to Move..."
ssh ableton@move.local "mkdir -p /data/UserData/schwung/modules/overtake/move-bitwig"
scp -r dist/move-bitwig/* ableton@move.local:/data/UserData/schwung/modules/overtake/move-bitwig/

# Clean up old tools path if it exists
ssh ableton@move.local "rm -rf /data/UserData/schwung/modules/tools/move-bitwig" 2>/dev/null || true

# Set permissions so Module Store can update later
echo "Setting permissions..."
ssh ableton@move.local "chmod -R a+rw /data/UserData/schwung/modules/overtake/move-bitwig"

echo ""
echo "=== Install Complete ==="
echo "Module installed to: /data/UserData/schwung/modules/overtake/move-bitwig/"
echo ""
echo "Restart Move Anything to load the new module."
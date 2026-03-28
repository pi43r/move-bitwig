#!/usr/bin/env bash
# Build Control module for Move Anything
# This is a JS-only module, so just package the files.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$REPO_ROOT"

echo "=== Building Control Module ==="

# Create dist directory
mkdir -p dist/move-bitwig

# Copy files
echo "Packaging..."
cp src/module.json dist/move-bitwig/
cp src/ui.js dist/move-bitwig/

# Create tarball for release
cd dist
tar -czvf move-bitwig-module.tar.gz move-bitwig/
cd ..

echo ""
echo "=== Build Complete ==="
echo "Output: dist/move-bitwig/"
echo "Tarball: dist/move-bitwig-module.tar.gz"
echo ""
echo "To install on Move:"
echo "  ./scripts/install.sh"

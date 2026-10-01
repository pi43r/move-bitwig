#!/usr/bin/env python3
"""Build both release archives from an explicit source list, using only Python's stdlib."""

import argparse
import gzip
import io
import json
from pathlib import Path
import re
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
MODULE_FILES = ("module.json", "ui.js", "help.json")


def release_sources(tag=None):
    module = json.loads((ROOT / "src/module.json").read_text(encoding="utf-8"))
    release = json.loads((ROOT / "release.json").read_text(encoding="utf-8"))
    folder = ROOT / "Controller Scripts"
    entry = folder / "Move.control.js"
    source = entry.read_text(encoding="utf-8")
    version = module["version"]
    controller_version = re.search(r'host\.defineController\("[^"]+",\s*"[^"]+",\s*"([^"]+)"', source)
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Expected a release version in major.minor.patch form")
    if release["version"] != version or not controller_version or controller_version[1] != version:
        raise ValueError("Versions must match in module.json, release.json and Move.control.js")
    if tag is not None and tag != "v" + version:
        raise ValueError("Release tag must be v" + version)
    expected_url = f"https://github.com/pi43r/move-bitwig/releases/download/v{version}/move-bitwig-module.tar.gz"
    if release["download_url"] != expected_url:
        raise ValueError("release.json download_url does not match the version")

    # The loader defines the release contents; stray scripts cannot enter the ZIP.
    scripts = {entry.name: entry}
    pending = [entry]
    while pending:
        for name in re.findall(r'\bload\("([^"]+)"\)', pending.pop().read_text(encoding="utf-8")):
            if Path(name).name != name or not name.endswith(".js"):
                raise ValueError("Invalid controller load target: " + name)
            path = folder / name
            if not path.is_file():
                raise ValueError("Missing controller load target: " + name)
            if name not in scripts:
                scripts[name] = path
                pending.append(path)
    return version, [scripts[name] for name in sorted(scripts)]


def build(tag=None):
    version, scripts = release_sources(tag)
    module_sources = {name: (ROOT / "src" / name).read_bytes() for name in MODULE_FILES}
    help_data = json.loads(module_sources["help.json"])
    if not help_data.get("children"):
        raise ValueError("Schwung help.json must have a non-empty children array")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    # Fixed timestamps and permissions make repeat builds byte-for-byte identical.
    with (dist / "move-bitwig-module.tar.gz").open("wb") as output:
        with gzip.GzipFile(filename="", fileobj=output, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                for name, data in module_sources.items():
                    info = tarfile.TarInfo("move-bitwig/" + name)
                    info.size = len(data)
                    info.mode = 0o644
                    archive.addfile(info, io.BytesIO(data))
    with zipfile.ZipFile(dist / "move-bitwig-controller-scripts.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in scripts:
            info = zipfile.ZipInfo(path.name, (2020, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    print(f"Move Bitwig {version}: {len(module_sources)} module files, {len(scripts)} controller scripts")
    print("dist/move-bitwig-module.tar.gz")
    print("dist/move-bitwig-controller-scripts.zip")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="Require the metadata to match this release tag")
    args = parser.parse_args()
    try:
        build(args.tag)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Build failed: {error}\n")

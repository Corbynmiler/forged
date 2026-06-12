#!/usr/bin/env python3
"""
Merge animation clips from multiple single-clip GLBs into one master GLB.
Stdlib-only — no external dependencies.

Usage:
  python3 scripts/merge-glb.py base.glb:ClipName extra.glb:ClipName output.glb

Example:
  python3 scripts/merge-glb.py \\
    public/smith-idle.glb:Idle \\
    public/smith-hammer.glb:HeavyHammerSwing \\
    public/forge-companion.glb
"""
import sys, json, struct


def read_glb(path):
    with open(path, "rb") as f:
        raw = f.read()
    magic, _ver, total = struct.unpack_from("<III", raw)
    assert magic == 0x46546C67, f"{path}: not a GLB file"
    chunks, pos = {}, 12
    while pos < total:
        clen, ctype = struct.unpack_from("<II", raw, pos)
        chunks[ctype] = raw[pos + 8 : pos + 8 + clen]
        pos += 8 + clen
    gltf = json.loads(chunks[0x4E4F534A])
    buf  = bytearray(chunks.get(0x004E4942, b""))
    return gltf, buf


def write_glb(path, gltf, buf):
    j = json.dumps(gltf, separators=(",", ":")).encode()
    j += b" " * (-len(j) % 4)
    b  = bytes(buf) + b"\x00" * (-len(buf) % 4)
    hdr  = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(b))
    jchk = struct.pack("<II", len(j), 0x4E4F534A) + j
    bchk = struct.pack("<II", len(b), 0x004E4942) + b
    with open(path, "wb") as f:
        f.write(hdr + jchk + bchk)


def merge(specs, output):
    base_path, base_name = specs[0]
    gltf, buf = read_glb(base_path)

    # Rename base animation
    if gltf.get("animations"):
        gltf["animations"][0]["name"] = base_name

    # Force OPAQUE + doubleSided — fixes Three.js depth-write issue from FBX imports
    for m in gltf.get("materials", []):
        m["alphaMode"] = "OPAQUE"
        m["doubleSided"] = True
        m.pop("alphaCutoff", None)

    # Build node name → index map for base
    base_nodes    = gltf.get("nodes", [])
    base_node_map = {n.get("name", ""): i for i, n in enumerate(base_nodes)}

    for extra_path, clip_name in specs[1:]:
        eg, eb = read_glb(extra_path)
        if not eg.get("animations"):
            print(f"  WARNING: {extra_path} has no animations — skipping")
            continue

        anim = json.loads(json.dumps(eg["animations"][0]))  # deep copy
        anim["name"] = clip_name

        # Remap extra node indices → base node indices by matching names
        extra_nodes    = eg.get("nodes", [])
        extra_node_map = {n.get("name", ""): i for i, n in enumerate(extra_nodes)}
        node_remap     = {
            ei: base_node_map[name]
            for name, ei in extra_node_map.items()
            if name in base_node_map
        }

        bv_off  = len(gltf.get("bufferViews", []))
        acc_off = len(gltf.get("accessors",   []))
        buf_off = len(buf)

        # Append extra binary
        buf.extend(eb)

        # Copy buffer views (shift byteOffset into merged buffer)
        for bv in eg.get("bufferViews", []):
            nbv = dict(bv)
            nbv["buffer"]     = 0
            nbv["byteOffset"] = nbv.get("byteOffset", 0) + buf_off
            gltf.setdefault("bufferViews", []).append(nbv)

        # Copy accessors (shift bufferView index)
        for ac in eg.get("accessors", []):
            nac = dict(ac)
            if "bufferView" in nac:
                nac["bufferView"] += bv_off
            gltf.setdefault("accessors", []).append(nac)

        # Shift sampler accessor indices
        for s in anim["samplers"]:
            s["input"]  += acc_off
            s["output"] += acc_off

        # Remap channel node targets; drop any with no match in base skeleton
        good = []
        for ch in anim["channels"]:
            tgt = ch.get("target", {})
            ni  = tgt.get("node")
            if ni not in node_remap:
                continue
            good.append({**ch, "target": {**tgt, "node": node_remap[ni]}})
        anim["channels"] = good

        gltf.setdefault("animations", []).append(anim)
        print(f"  + {clip_name}  ({len(good)} channels)  from {extra_path}")

    gltf["buffers"] = [{"byteLength": len(buf)}]
    write_glb(output, gltf, buf)

    names = [a.get("name", f"anim_{i}") for i, a in enumerate(gltf.get("animations", []))]
    print(f"✓  {output}")
    print(f"   clips : {names}")
    print(f"   buf   : {len(buf) / 1024:.0f} KB")


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 3:
        print(__doc__)
        sys.exit(1)
    specs = [
        (s.rsplit(":", 1)[0], s.rsplit(":", 1)[1]) if ":" in s else (s, s.replace(".glb", ""))
        for s in args[:-1]
    ]
    merge(specs, output=args[-1])

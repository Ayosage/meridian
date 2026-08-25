"""Headless GLB export for the beauty slice. Run:
blender --background assets/slice.blend --python assets/export_slice.py
Each collection exports to its own GLB, re-centered to the origin
(assets are parked at x-offsets in the .blend for side-by-side work).
"""
import bpy
import os

OUT = os.path.join(os.path.dirname(bpy.data.filepath), "..", "apps", "client", "public", "assets", "slice")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)

# collection -> (glb name, parking x-offset, object-name prefixes to EXCLUDE)
EXPORTS = {
    "tile_base": ("tile_base", 0.0, ("tile_base_",)),  # exclude linked forest/fields pucks
    "terrain_mountains": ("terrain_mountains", 0.0, ()),
    "terrain_forest": ("terrain_forest", 2.0, ("tile_base_",)),
    "terrain_fields": ("terrain_fields", 4.0, ("tile_base_",)),
    "piece_settlement": ("settlement", 6.0, ()),
    "piece_road": ("road", 7.2, ()),
    "piece_token": ("token", 8.0, ()),
    "terrain_pasture": ("terrain_pasture", 10.0, ()),
    "terrain_hills": ("terrain_hills", 12.0, ()),
    "terrain_desert": ("terrain_desert", 14.0, ()),
    "piece_city": ("city", 16.0, ()),
    "piece_robber": ("robber", 17.0, ()),
    "piece_port": ("port", 18.0, ()),
    # tokens are parked in a grid around x=20; only the collection offset is
    # removed — per-token grid offsets stay in node transforms, and the CLIENT
    # clones each token_<n> MESH by name, ignoring the node transform.
    "piece_tokens": ("tokens", 20.0, ()),
    "piece_raft": ("raft", 22.0, ()),
}

for coll_name, (glb, xoff, excludes) in EXPORTS.items():
    coll = bpy.data.collections.get(coll_name)
    if not coll:
        print("MISSING COLLECTION:", coll_name)
        continue
    objs = [o for o in coll.objects
            if not any(o.name.startswith(p) for p in excludes)]
    # re-center: shift by parking offset
    for o in objs:
        o.location.x -= xoff
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, glb + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
    )
    # restore parking position
    for o in objs:
        o.location.x += xoff
    size_kb = os.path.getsize(path) / 1024
    print("EXPORTED %s.glb  %.1f KB  (%d objects)" % (glb, size_kb, len(objs)))

print("ALL EXPORTS DONE ->", OUT)

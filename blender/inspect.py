import bpy, json, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:\Dev\Websites\landing-test\blender\src\mesh.glb")
info = {}
for o in bpy.data.objects:
    if o.type == "MESH":
        info[o.name] = {"verts": len(o.data.vertices), "polys": len(o.data.polygons), "dims": [round(x,3) for x in o.dimensions], "mats": [m.name for m in o.data.materials]}
info["images"] = [(i.name, list(i.size)) for i in bpy.data.images]
open(r"C:\Dev\Websites\landing-test\blender\inspect.json","w").write(json.dumps(info))

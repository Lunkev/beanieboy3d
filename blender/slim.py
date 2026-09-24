import bpy, json, os
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:\Dev\Websites\landing-test\blender\src\mesh.glb")
o = next(x for x in bpy.data.objects if x.type == "MESH")
bpy.context.view_layer.objects.active = o; o.select_set(True)
m = o.modifiers.new("dec", "DECIMATE"); m.ratio = 0.03; m.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="dec")
for img in bpy.data.images:
    if img.size[0] > 2048:
        s = 1024 if img.name.startswith("ORM") else 2048
        img.scale(s, s)
out = r"C:\Dev\Websites\landing-test\blender\src\mesh-slim.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=88)
open(r"C:\Dev\Websites\landing-test\blender\slim.json","w").write(json.dumps({"polys": len(o.data.polygons), "verts": len(o.data.vertices), "size": os.path.getsize(out)}))

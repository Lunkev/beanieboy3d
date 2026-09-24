# Körs i bakgrunds-Blender: importerar bas-riggen (idle) + varje klipp-GLB från Meshy-riggning,
# retargetar klippen till basens skelett (olika rigg-jobb har olika bone roll → vridna händer/fötter annars),
# krymper texturen och exporterar EN glb med alla actions.
import bpy, os, math, json
from mathutils import Matrix, Vector
ROOT = r"C:\Dev\Websites\landing-test"
SRC = os.path.join(ROOT, "blender", "src")
CFG = json.load(open(os.path.join(SRC, "clips.json")))   # {"base":"idle","clips":{"idle":{"arm":8},...},"out":"public/models/x.glb","tex":2048}

def clean():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions): bpy.data.actions.remove(a)
    for c in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for x in list(c):
            if x.users == 0: c.remove(x)

def imp(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    return arm, new

clean()
base_arm, base_objs = imp(os.path.join(SRC, CFG["base"] + ".glb"))
base_arm.name = "Armature"
# basens egen action
for o in base_objs:
    if o.type == "EMPTY" and o is not base_arm and not o.children: bpy.data.objects.remove(o, do_unlink=True)
tb = base_arm.data.bones
order = []
def walk(b):
    order.append(b.name)
    for c in b.children: walk(c)
for b in tb:
    if b.parent is None: walk(b)

report = {}
for name, opt in CFG["clips"].items():
    arm_deg = opt.get("arm", 0)
    if name == CFG["base"]:
        src_arm, objs = base_arm, []
    else:
        src_arm, objs = imp(os.path.join(SRC, name + ".glb"))
    src_act = src_arm.animation_data.action
    f0, f1 = [int(round(x)) for x in src_act.frame_range]
    sb = src_arm.data.bones
    # sampla källans posematriser (armature space)
    samples = []
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        samples.append({b.name: src_arm.pose.bones[b.name].matrix.copy() for b in sb})
    rest_src = {b.name: b.matrix_local.copy() for b in sb}
    if src_arm is base_arm:
        base_arm.animation_data.action = None
        for pb in base_arm.pose.bones: pb.matrix_basis = Matrix()
    act = bpy.data.actions.new(name)
    base_arm.animation_data_create(); base_arm.animation_data.action = act
    for i, S in enumerate(samples):
        Pt = {}
        for bn in order:
            b = tb[bn]; Rt = b.matrix_local
            if bn in S:
                D = S[bn].to_3x3() @ rest_src[bn].to_3x3().inverted()
                rot = D @ Rt.to_3x3()
            else:
                rot = Rt.to_3x3()
            if arm_deg and ("Arm" in bn and "Fore" not in bn and "Shoulder" not in bn):
                s = -1 if bn.startswith("Left") else 1
                rot = Matrix.Rotation(math.radians(arm_deg * s), 3, 'Y') @ rot
            if b.parent:
                attach = Pt[b.parent.name] @ (b.parent.matrix_local.inverted() @ Rt)
                pos = attach.translation
            else:
                attach = Rt
                pos = Rt.translation + ((S[bn].translation - rest_src[bn].translation) if bn in S else Vector())
            M = Matrix.Translation(pos) @ rot.to_4x4()
            Pt[bn] = M
            pb = base_arm.pose.bones[bn]
            pb.matrix_basis = attach.inverted() @ M
            fr = f0 + i
            pb.keyframe_insert("location", frame=fr, group=bn)
            pb.keyframe_insert("rotation_quaternion", frame=fr, group=bn)
    act.use_fake_user = True
    tr = base_arm.animation_data.nla_tracks.new(); tr.name = name
    tr.strips.new(name, f0, act)
    base_arm.animation_data.action = None
    report[name] = [f0, f1]
    if objs:
        for o in objs: bpy.data.objects.remove(o, do_unlink=True)

for pb in base_arm.pose.bones: pb.matrix_basis = Matrix()
# textur: skala ned
tex = CFG.get("tex", 2048)
for img in bpy.data.images:
    if img.size[0] > tex: img.scale(tex, tex)
# Meshy lägger basfärgen som emissive → urblekt; sänk
for m in bpy.data.materials:
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Emission Strength"].default_value = CFG.get("emit", 0.0)
                n.inputs["Metallic"].default_value = 0.0
                n.inputs["Roughness"].default_value = CFG.get("rough", 0.55)
out = os.path.join(ROOT, CFG["out"])
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animation_mode="NLA_TRACKS", export_image_format="WEBP", export_apply=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "char.blend"))
result = {"clips": report, "size": os.path.getsize(out), "bones": len(order), "imgs": [(i.name, list(i.size)) for i in bpy.data.images]}

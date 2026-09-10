"""
Wearables for the shared character rig: guard cap, duty belt with holster, a
pistol, the thief's red hood and the Dalí mask. Metres, glTF Y-up, +z forward.
Each file's origin is the bone it is bound to (head bone = top of the neck,
hips bone = pelvis, palm = centre of the hand).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_wear.py -- public/models
"""
import math
import os
import sys

import bmesh
import bpy

out_dir = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "public/models"


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgb, metallic=0.0, roughness=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    return m


def finish(obj, mat, name):
    obj.name = name
    obj.data.materials.append(mat)
    return obj


# Blender is Z-up, Y-back. We author in Blender coords with +Y = back, so that
# the glTF export (x, z, -y) gives +z forward. Helper: fwd(d) = -d on Blender Y.
def cube(size, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(loc[0], -loc[2], loc[1]), rotation=rot)
    o = bpy.context.active_object
    o.scale = (size[0], size[2], size[1])
    return o


def cyl(r, h, loc, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(loc[0], -loc[2], loc[1]), rotation=rot)
    return bpy.context.active_object


def sphere(r, loc, scale=(1, 1, 1), seg=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(loc[0], -loc[2], loc[1]), segments=seg, ring_count=rings)
    o = bpy.context.active_object
    o.scale = (scale[0], scale[2], scale[1])
    return o


def torus(major, minor, loc, seg=32, ring=10):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=(loc[0], -loc[2], loc[1]),
                                     major_segments=seg, minor_segments=ring)
    return bpy.context.active_object


def cut_front(obj, y_min, y_max, z_front):
    """Delete vertices in the face opening: Blender coords, front is -Y."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    kill = [v for v in bm.verts if (-v.co.y) > z_front and y_min < v.co.z < y_max]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True, export_yup=True,
                              export_animations=False, use_selection=True)
    print("wrote", path)


# ------------------------------------------------------------------ cap
reset()
navy = material("Navy", (0.05, 0.11, 0.24), roughness=0.75)
black = material("Black", (0.02, 0.02, 0.025), roughness=0.5)
gold = material("Gold", (0.85, 0.65, 0.2), metallic=1.0, roughness=0.3)
crown = cyl(0.108, 0.07, (0, 0.20, 0.0))
finish(crown, navy, "Crown")
top = sphere(0.108, (0, 0.235, 0.0), scale=(1, 0.35, 1))
finish(top, navy, "Top")
band = cyl(0.112, 0.022, (0, 0.172, 0.0))
finish(band, black, "Band")
peak = cube((0.2, 0.012, 0.11), (0, 0.166, 0.115), rot=(math.radians(8), 0, 0))
finish(peak, black, "Peak")
badge = cube((0.04, 0.045, 0.01), (0, 0.205, 0.108))
finish(badge, gold, "Badge")
export(os.path.join(out_dir, "wear_cap.glb"))

# ------------------------------------------------------------------ belt
reset()
black = material("Black", (0.03, 0.03, 0.035), roughness=0.55)
gold = material("Gold", (0.85, 0.65, 0.2), metallic=1.0, roughness=0.3)
belt = torus(0.168, 0.02, (0, 0.13, 0.0))
finish(belt, black, "Belt")
buckle = cube((0.06, 0.045, 0.015), (0, 0.13, 0.17))
finish(buckle, gold, "Buckle")
holster = cube((0.045, 0.17, 0.07), (-0.19, 0.05, 0.02), rot=(0, 0, math.radians(-8)))
finish(holster, black, "Holster")
pouch = cube((0.07, 0.06, 0.04), (0.14, 0.11, -0.13))
finish(pouch, black, "Pouch")
radio = cube((0.035, 0.09, 0.03), (0.16, 0.12, 0.08))
finish(radio, black, "Radio")
export(os.path.join(out_dir, "wear_belt.glb"))

# ------------------------------------------------------------------ pistol
# Hand frame: origin at the palm, +z toward the fingers, +y up (back of hand).
reset()
gun = material("Gun", (0.06, 0.06, 0.07), metallic=0.6, roughness=0.4)
grip = cube((0.03, 0.09, 0.035), (0, -0.045, 0.0), rot=(math.radians(15), 0, 0))
finish(grip, gun, "Grip")
slide = cube((0.03, 0.035, 0.17), (0, 0.02, 0.06))
finish(slide, gun, "Slide")
guard = cube((0.02, 0.03, 0.04), (0, -0.015, 0.03))
finish(guard, gun, "TriggerGuard")
export(os.path.join(out_dir, "wear_pistol.glb"))

# ------------------------------------------------------------------ hood
reset()
red = material("Red", (0.55, 0.05, 0.08), roughness=0.85)
hood = sphere(0.14, (0, 0.11, -0.01), seg=32, rings=20)
cut_front(hood, 0.02, 0.21, 0.045)
finish(hood, red, "Hood")
drape = cyl(0.165, 0.09, (0, 0.0, -0.01))
finish(drape, red, "Drape")
export(os.path.join(out_dir, "wear_hood.glb"))

# ------------------------------------------------------------------ mask
reset()
cream = material("Cream", (0.93, 0.89, 0.8), roughness=0.4)
ink = material("Ink", (0.02, 0.02, 0.02), roughness=0.6)
plate = sphere(0.1, (0, 0.11, 0.05), scale=(0.95, 1.2, 0.7), seg=32, rings=20)
cut_front(plate, -1, 1, 0.0)  # keep only the back half... we want the front: cut the back instead
# rebuild: keep front half by cutting behind the centre
bpy.data.objects.remove(plate)
plate = sphere(0.1, (0, 0.11, 0.05), scale=(0.95, 1.2, 0.7), seg=32, rings=20)
bm = bmesh.new()
bm.from_mesh(plate.data)
kill = [v for v in bm.verts if (-v.co.y) < 0.0]
bmesh.ops.delete(bm, geom=kill, context="VERTS")
bm.to_mesh(plate.data)
bm.free()
finish(plate, cream, "Face")
for sx in (-1, 1):
    eye = sphere(0.02, (sx * 0.035, 0.135, 0.115), scale=(1.2, 0.8, 0.5))
    finish(eye, ink, "Eye")
    brow = cube((0.045, 0.008, 0.01), (sx * 0.035, 0.162, 0.118), rot=(0, 0, sx * math.radians(12)))
    finish(brow, ink, "Brow")
    # The moustache: thin tubes sweeping up and out.
    for k, (dx, dy, ang) in enumerate(((0.03, 0.078, 10), (0.06, 0.095, 40), (0.075, 0.125, 75))):
        seg = cyl(0.005, 0.035, (sx * dx, dy, 0.118), rot=(0, sx * math.radians(ang), 0), verts=8)
        finish(seg, ink, "Moustache")
nose = sphere(0.018, (0, 0.105, 0.125), scale=(0.8, 1.0, 0.8))
finish(nose, cream, "Nose")
export(os.path.join(out_dir, "wear_mask.glb"))

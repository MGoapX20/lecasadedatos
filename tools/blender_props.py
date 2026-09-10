"""
Hero props for La Casa de Datos, built procedurally in Blender and exported as glTF.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_props.py -- public/models

Produces vault_door.glb and press.glb. Units are metres; both stand on y=0 in
glTF (Blender's Z up becomes Y up on export).
"""
import math
import os
import sys

import bpy

out_dir = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "public/models"
os.makedirs(out_dir, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgb, metallic=0.0, roughness=0.5, emission=None, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def add(obj, mat, name, parent=None):
    obj.name = name
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def cylinder(r, depth, loc, rot=(0, 0, 0), verts=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    return bpy.context.active_object


def cube(size, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    return o


def torus(major, minor, loc, rot=(0, 0, 0), seg=40, ring=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot,
                                     major_segments=seg, minor_segments=ring)
    return bpy.context.active_object


def bevel(obj, width=0.02, segments=2):
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True, export_yup=True,
                              export_animations=False, use_selection=True)
    print("wrote", path)


# ----------------------------------------------------------------- vault door
# A round steel door in a rectangular frame. The slab is 2.2 wide, 2.45 tall,
# hinged along its left edge (x = -1.1). The wheel object is named "Wheel" so
# the game can spin it while the lock is being worked. Front face is +Y in
# Blender, which becomes -Z... we build front toward -Y so it exports to +Z.
reset()
steel = material("Steel", (0.62, 0.64, 0.68), metallic=0.9, roughness=0.32)
steel_dark = material("SteelDark", (0.3, 0.32, 0.36), metallic=0.85, roughness=0.45)
brass = material("Brass", (0.85, 0.62, 0.22), metallic=1.0, roughness=0.28)
rubber = material("Rubber", (0.06, 0.06, 0.07), roughness=0.9)

root = bpy.data.objects.new("VaultDoor", None)
bpy.context.collection.objects.link(root)

# Frame around the opening.
frame_w, frame_h, depth = 2.2, 2.45, 0.5
for (sx, sy, sz, loc) in [
    (0.16, depth + 0.1, frame_h, (-frame_w / 2 - 0.08, 0, frame_h / 2)),
    (0.16, depth + 0.1, frame_h, (frame_w / 2 + 0.08, 0, frame_h / 2)),
    (frame_w + 0.32, depth + 0.1, 0.16, (0, 0, frame_h + 0.08)),
]:
    o = cube((sx, sy, sz), loc)
    bevel(o, 0.02)
    add(o, steel_dark, "Frame", root)

# Slab: a fat rounded box, front toward -Y (which becomes +Z in glTF).
slab = cube((frame_w - 0.06, depth * 0.7, frame_h - 0.04), (0, 0, frame_h / 2))
bevel(slab, 0.06, 4)
add(slab, steel, "Slab", root)

# Big round boss on the front face.
front_y = -depth * 0.35
boss = cylinder(0.92, 0.12, (0, front_y - 0.06, frame_h * 0.52), rot=(math.pi / 2, 0, 0), verts=64)
bevel(boss, 0.03, 3)
add(boss, steel, "Boss", root)
rim = torus(0.92, 0.05, (0, front_y - 0.12, frame_h * 0.52), rot=(math.pi / 2, 0, 0), seg=64)
add(rim, brass, "Rim", root)

# Bolts around the rim.
for i in range(16):
    a = i / 16 * math.tau
    b = cylinder(0.05, 0.08, (math.cos(a) * 0.8, front_y - 0.15, frame_h * 0.52 + math.sin(a) * 0.8),
                 rot=(math.pi / 2, 0, 0), verts=12)
    add(b, brass, "Bolt", root)

# Handwheel: hub + ring + spokes, named so the game can turn it.
wheel = bpy.data.objects.new("Wheel", None)
bpy.context.collection.objects.link(wheel)
wheel.parent = root
wheel.location = (0, front_y - 0.3, frame_h * 0.52)
hub = cylinder(0.12, 0.2, (0, 0, 0), rot=(math.pi / 2, 0, 0), verts=24)
add(hub, brass, "Hub", wheel)
ring = torus(0.46, 0.045, (0, 0, 0), rot=(math.pi / 2, 0, 0), seg=48)
add(ring, steel, "Ring", wheel)
for i in range(6):
    a = i / 6 * math.tau
    sp = cylinder(0.03, 0.9, (math.cos(a) * 0.23, 0, math.sin(a) * 0.23), rot=(0, a, 0), verts=8)
    # spokes lie in the wheel plane (XZ): rotate about Y to point outward
    sp.rotation_euler = (0, math.pi / 2 - a, 0)
    sp.location = (math.cos(a) * 0.23, 0, math.sin(a) * 0.23)
    add(sp, steel, "Spoke", wheel)

# Hinges on the left edge.
for z in (0.45, frame_h / 2, frame_h - 0.45):
    h = cylinder(0.11, 0.5, (-frame_w / 2 - 0.02, front_y + 0.1, z), verts=16)
    add(h, steel_dark, "Hinge", root)

# Locking bars that slide into the frame on the right.
for z in (0.6, frame_h / 2, frame_h - 0.6):
    bar = cylinder(0.06, 0.4, (frame_w / 2 - 0.1, 0, z), rot=(0, math.pi / 2, 0), verts=12)
    add(bar, brass, "Bar", root)

export(os.path.join(out_dir, "vault_door.glb"))

# ----------------------------------------------------------------- press
# A banknote press: a heavy base, twin rollers on a frame, a hopper feeding
# sheets in and a stack of notes coming out, plus a small control panel.
reset()
iron = material("Iron", (0.2, 0.22, 0.26), metallic=0.8, roughness=0.55)
green = material("MachineGreen", (0.16, 0.34, 0.24), metallic=0.2, roughness=0.6)
brass = material("Brass", (0.85, 0.62, 0.22), metallic=1.0, roughness=0.28)
paper = material("Paper", (0.85, 0.83, 0.74), roughness=0.9)
ink = material("Ink", (0.05, 0.05, 0.06), roughness=0.4)
lamp = material("Lamp", (1.0, 0.85, 0.5), emission=(1.0, 0.75, 0.3), strength=4.0)
red_lamp = material("RedLamp", (1.0, 0.2, 0.2), emission=(1.0, 0.15, 0.15), strength=4.0)

root = bpy.data.objects.new("Press", None)
bpy.context.collection.objects.link(root)

base = cube((3.0, 1.9, 0.9), (0, 0, 0.45))
bevel(base, 0.04, 3)
add(base, green, "Base", root)
skirt = cube((3.1, 2.0, 0.12), (0, 0, 0.06))
add(skirt, iron, "Skirt", root)

# Frame uprights and the roller pair.
for x in (-1.1, 1.1):
    up = cube((0.22, 1.5, 1.3), (x, 0, 0.9 + 0.65))
    bevel(up, 0.02)
    add(up, iron, "Upright", root)
top = cube((2.5, 1.6, 0.16), (0, 0, 2.25))
add(top, iron, "Top", root)
for z, r in ((1.35, 0.3), (1.85, 0.26)):
    roller = cylinder(r, 2.1, (0, 0, z), rot=(0, math.pi / 2, 0), verts=32)
    add(roller, iron if z > 1.5 else brass, "Roller", root)
    for x in (-1.15, 1.15):
        axle = cylinder(0.08, 0.3, (x, 0, z), rot=(0, math.pi / 2, 0), verts=12)
        add(axle, brass, "Axle", root)

# Hopper on the back, feeding blank sheets in.
hop = cube((1.6, 0.6, 0.9), (0, 0.95, 1.55), rot=(math.radians(-25), 0, 0))
add(hop, iron, "Hopper", root)
for i in range(6):
    sheet = cube((1.3, 0.5, 0.01), (0, 0.9 + i * 0.02, 1.7 + i * 0.05), rot=(math.radians(-25), 0, 0))
    add(sheet, paper, "Sheet", root)

# Printed notes sliding out the front and stacking up.
tray = cube((1.7, 0.7, 0.05), (0, -1.2, 0.95), rot=(math.radians(10), 0, 0))
add(tray, iron, "Tray", root)
for i in range(10):
    note = cube((0.62, 0.3, 0.02), (-0.4 + (i % 2) * 0.8, -1.25, 1.0 + i * 0.025), rot=(0, 0, (i % 3 - 1) * 0.08))
    add(note, paper, "Note", root)
    stripe = cube((0.4, 0.18, 0.021), (-0.4 + (i % 2) * 0.8, -1.25, 1.0 + i * 0.025 + 0.011), rot=(0, 0, (i % 3 - 1) * 0.08))
    add(stripe, green, "Stripe", root)

# Control panel with lamps.
panel = cube((0.7, 0.3, 0.5), (1.2, -0.85, 1.2), rot=(math.radians(20), 0, 0))
bevel(panel, 0.02)
add(panel, ink, "Panel", root)
for i, m in enumerate((lamp, red_lamp, lamp)):
    l = cylinder(0.05, 0.05, (1.0 + i * 0.2, -0.99, 1.32), rot=(math.radians(20), 0, 0), verts=12)
    add(l, m, "Lamp", root)
lever = cylinder(0.03, 0.5, (1.45, -0.9, 1.6), rot=(math.radians(-30), 0, 0), verts=8)
add(lever, brass, "Lever", root)
knob = cylinder(0.07, 0.08, (1.45, -1.02, 1.82), rot=(math.radians(-30), 0, 0), verts=12)
add(knob, ink, "Knob", root)

# Pipes and a flywheel on the side.
fly = cylinder(0.45, 0.12, (-1.62, 0, 1.4), rot=(0, math.pi / 2, 0), verts=32)
add(fly, iron, "Flywheel", root)
fly_rim = torus(0.45, 0.05, (-1.66, 0, 1.4), rot=(0, math.pi / 2, 0), seg=40)
add(fly_rim, brass, "FlyRim", root)
pipe = cylinder(0.06, 1.4, (-1.5, 0.6, 1.5), verts=10)
add(pipe, brass, "Pipe", root)

export(os.path.join(out_dir, "press.glb"))

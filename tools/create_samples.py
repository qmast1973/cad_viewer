"""
CAD 샘플 생성기 (2D DXF, 3D STL)
- sample/bracket-2d.dxf: 모터 브래킷 2D 도면 (레이어: OUTLINE, HOLES, CENTER, DIM)
- sample/gear-2d.dxf: 평기어 2D 도면 (레이어: TEETH, BORE, KEYWAY, PITCH_CIRCLE)
- sample/sample-3d.stl: 3D 기계 브래킷 (ASCII STL)
"""
import os
import math

SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "sample")
os.makedirs(SAMPLE_DIR, exist_ok=True)

def create_bracket_dxf():
    # AutoCAD R12 DXF format
    lines = [
        "0", "SECTION",
        "2", "HEADER",
        "9", "$ACADVER", "1", "AC1009",
        "9", "$INSUNITS", "70", "4", # mm
        "0", "ENDSEC",
        "0", "SECTION",
        "2", "TABLES",
        "0", "TABLE",
        "2", "LAYER",
        "70", "4",
        # Layer OUTLINE (Cyan, 4)
        "0", "LAYER", "2", "OUTLINE", "70", "0", "62", "4", "6", "CONTINUOUS",
        # Layer HOLES (Yellow, 2)
        "0", "LAYER", "2", "HOLES", "70", "0", "62", "2", "6", "CONTINUOUS",
        # Layer CENTER (Red, 1)
        "0", "LAYER", "2", "CENTER", "70", "0", "62", "1", "6", "CENTER",
        # Layer DIM (Green, 3)
        "0", "LAYER", "2", "DIM", "70", "0", "62", "3", "6", "CONTINUOUS",
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "SECTION",
        "2", "ENTITIES",
    ]

    # Bracket Outer Contour (160 x 100 with rounded corners R15)
    # Using LINE and ARC
    w, h, r = 160.0, 100.0, 15.0
    
    def add_line(layer, color, x1, y1, x2, y2):
        lines.extend([
            "0", "LINE",
            "8", layer,
            "62", str(color),
            "10", f"{x1:.3f}", "20", f"{y1:.3f}", "30", "0.0",
            "11", f"{x2:.3f}", "21", f"{y2:.3f}", "31", "0.0"
        ])

    def add_arc(layer, color, cx, cy, rad, sa, ea):
        lines.extend([
            "0", "ARC",
            "8", layer,
            "62", str(color),
            "10", f"{cx:.3f}", "20", f"{cy:.3f}", "30", "0.0",
            "40", f"{rad:.3f}",
            "50", f"{sa:.3f}",
            "51", f"{ea:.3f}"
        ])

    def add_circle(layer, color, cx, cy, rad):
        lines.extend([
            "0", "CIRCLE",
            "8", layer,
            "62", str(color),
            "10", f"{cx:.3f}", "20", f"{cy:.3f}", "30", "0.0",
            "40", f"{rad:.3f}"
        ])

    def add_text(layer, color, text, x, y, height, rot=0.0):
        lines.extend([
            "0", "TEXT",
            "8", layer,
            "62", str(color),
            "10", f"{x:.3f}", "20", f"{y:.3f}", "30", "0.0",
            "40", f"{height:.3f}",
            "1", text,
            "50", f"{rot:.3f}"
        ])

    # Outer lines
    add_line("OUTLINE", 4, r, 0, w - r, 0)
    add_arc("OUTLINE", 4, w - r, r, r, 270, 360)
    add_line("OUTLINE", 4, w, r, w, h - r)
    add_arc("OUTLINE", 4, w - r, h - r, r, 0, 90)
    add_line("OUTLINE", 4, w - r, h, r, h)
    add_arc("OUTLINE", 4, r, h - r, r, 90, 180)
    add_line("OUTLINE", 4, 0, h - r, 0, r)
    add_arc("OUTLINE", 4, r, r, r, 180, 270)

    # 4 Corner mounting holes (Dia 10 -> R5)
    holes = [(r, r), (w - r, r), (w - r, h - r), (r, h - r)]
    for hx, hy in holes:
        add_circle("HOLES", 2, hx, hy, 5.0)
        # Centerlines
        add_line("CENTER", 1, hx - 8, hy, hx + 8, hy)
        add_line("CENTER", 1, hx, hy - 8, hx, hy + 8)

    # Large Center Motor Bore (Dia 50 -> R25) at (80, 50)
    add_circle("HOLES", 2, w / 2, h / 2, 25.0)
    add_circle("HOLES", 2, w / 2, h / 2, 35.0) # PCD 70
    add_line("CENTER", 1, w / 2 - 45, h / 2, w / 2 + 45, h / 2)
    add_line("CENTER", 1, w / 2, h / 2 - 45, w / 2, h / 2 + 45)

    # PCD 4 small bolt holes (Dia 6 -> R3)
    pcd_rad = 35.0
    for deg in [45, 135, 225, 315]:
        rad = math.radians(deg)
        bx = w / 2 + pcd_rad * math.cos(rad)
        by = h / 2 + pcd_rad * math.sin(rad)
        add_circle("HOLES", 2, bx, by, 3.0)

    # Dimensions & Annotations
    add_text("DIM", 3, "MOTOR MOUNT BRACKET", 40.0, 115.0, 6.0)
    add_text("DIM", 3, "SCALE 1:1  [UNIT: mm]", 45.0, -18.0, 4.0)
    add_text("DIM", 3, "WIDTH: 160 mm", 65.0, -8.0, 3.5)
    add_text("DIM", 3, "HEIGHT: 100 mm", -15.0, 45.0, 3.5, rot=90.0)

    # Dimension extension lines
    add_line("DIM", 3, 0, -4, w, -4)
    add_line("DIM", 3, 0, -2, 0, -6)
    add_line("DIM", 3, w, -2, w, -6)

    add_line("DIM", 3, -4, 0, -4, h)
    add_line("DIM", 3, -2, 0, -6, 0)
    add_line("DIM", 3, -2, h, -6, h)

    lines.extend([
        "0", "ENDSEC",
        "0", "EOF"
    ])

    path = os.path.join(SAMPLE_DIR, "bracket-2d.dxf")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Created: {path}")

def create_gear_dxf():
    # Spur Gear 2D
    lines = [
        "0", "SECTION",
        "2", "TABLES",
        "0", "TABLE",
        "2", "LAYER",
        "70", "4",
        "0", "LAYER", "2", "TEETH", "70", "0", "62", "4", "6", "CONTINUOUS",
        "0", "LAYER", "2", "PITCH_CIRCLE", "70", "0", "62", "1", "6", "CENTER",
        "0", "LAYER", "2", "BORE", "70", "0", "62", "2", "6", "CONTINUOUS",
        "0", "LAYER", "2", "ANNOTATION", "70", "0", "62", "3", "6", "CONTINUOUS",
        "0", "ENDTAB",
        "0", "ENDSEC",
        "0", "SECTION",
        "2", "ENTITIES",
    ]

    def add_line(layer, color, x1, y1, x2, y2):
        lines.extend([
            "0", "LINE",
            "8", layer,
            "62", str(color),
            "10", f"{x1:.3f}", "20", f"{y1:.3f}", "30", "0.0",
            "11", f"{x2:.3f}", "21", f"{y2:.3f}", "31", "0.0"
        ])

    def add_circle(layer, color, cx, cy, rad):
        lines.extend([
            "0", "CIRCLE",
            "8", layer,
            "62", str(color),
            "10", f"{cx:.3f}", "20", f"{cy:.3f}", "30", "0.0",
            "40", f"{rad:.3f}"
        ])

    num_teeth = 16
    r_pitch = 40.0
    r_root = 35.0
    r_tip = 45.0
    
    # Teeth profile points
    tooth_pts = []
    d_theta = 2 * math.pi / num_teeth
    for i in range(num_teeth):
        t0 = i * d_theta
        t1 = t0 + d_theta * 0.25
        t2 = t0 + d_theta * 0.50
        t3 = t0 + d_theta * 0.75
        t4 = (i + 1) * d_theta

        p0 = (r_root * math.cos(t0), r_root * math.sin(t0))
        p1 = (r_tip * math.cos(t1), r_tip * math.sin(t1))
        p2 = (r_tip * math.cos(t2), r_tip * math.sin(t2))
        p3 = (r_root * math.cos(t3), r_root * math.sin(t3))
        p4 = (r_root * math.cos(t4), r_root * math.sin(t4))

        tooth_pts.extend([(p0, p1), (p1, p2), (p2, p3), (p3, p4)])

    for (pA, pB) in tooth_pts:
        add_line("TEETH", 4, pA[0], pA[1], pB[0], pB[1])

    # Pitch Circle
    add_circle("PITCH_CIRCLE", 1, 0, 0, r_pitch)
    # Bore
    add_circle("BORE", 2, 0, 0, 12.0)
    # Keyway
    kw_w = 4.0
    kw_h = 14.5
    add_line("BORE", 2, -kw_w/2, 10.0, -kw_w/2, kw_h)
    add_line("BORE", 2, -kw_w/2, kw_h, kw_w/2, kw_h)
    add_line("BORE", 2, kw_w/2, kw_h, kw_w/2, 10.0)

    # Center cross
    add_line("PITCH_CIRCLE", 1, -55, 0, 55, 0)
    add_line("PITCH_CIRCLE", 1, 0, -55, 0, 55)

    lines.extend([
        "0", "TEXT",
        "8", "ANNOTATION",
        "62", "3",
        "10", "-28.0", "20", "-65.0", "30", "0.0",
        "40", "4.0",
        "1", "SPUR GEAR (m=5, z=16)",
        "0", "ENDSEC",
        "0", "EOF"
    ])

    path = os.path.join(SAMPLE_DIR, "gear-2d.dxf")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Created: {path}")

def create_sample_stl():
    # 3D Mechanical L-Bracket in ASCII STL format
    # Dimensions: Base 60x40x10, Vertical Wall 60x10x50, with chamfered stiffener rib
    facets = []

    def quad(v1, v2, v3, v4, n):
        # Two triangles: (v1, v2, v3) and (v1, v3, v4)
        facets.append((n, v1, v2, v3))
        facets.append((n, v1, v3, v4))

    # Box 1: Base (0..60, 0..40, 0..10)
    # Bottom (z=0)
    quad((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), (0, 0, -1))
    # Top (z=10, y=10..40)
    quad((0, 10, 10), (0, 40, 10), (60, 40, 10), (60, 10, 10), (0, 0, 1))
    # Front (y=40)
    quad((0, 40, 0), (60, 40, 0), (60, 40, 10), (0, 40, 10), (0, 1, 0))
    # Left (x=0, y=10..40)
    quad((0, 10, 0), (0, 40, 0), (0, 40, 10), (0, 10, 10), (-1, 0, 0))
    # Right (x=60, y=10..40)
    quad((60, 10, 0), (60, 10, 10), (60, 40, 10), (60, 40, 0), (1, 0, 0))

    # Box 2: Vertical Wall (0..60, 0..10, 0..50)
    # Back (y=0)
    quad((0, 0, 0), (0, 0, 50), (60, 0, 50), (60, 0, 0), (0, -1, 0))
    # Top (z=50)
    quad((0, 0, 50), (0, 10, 50), (60, 10, 50), (60, 0, 50), (0, 0, 1))
    # Front-facing part of wall (y=10, z=10..50)
    quad((0, 10, 10), (60, 10, 10), (60, 10, 50), (0, 10, 50), (0, 1, 0))
    # Left (x=0, y=0..10)
    quad((0, 0, 0), (0, 10, 0), (0, 10, 50), (0, 0, 50), (-1, 0, 0))
    # Right (x=60, y=0..10)
    quad((60, 0, 0), (60, 0, 50), (60, 10, 50), (60, 10, 0), (1, 0, 0))

    # Stiffener triangular gusset in center (x=26..34, y=10..35, z=10..45)
    gx1, gx2 = 26.0, 34.0
    # Left triangle
    facets.append(((-1, 0, 0), (gx1, 10, 10), (gx1, 35, 10), (gx1, 10, 45)))
    # Right triangle
    facets.append(((1, 0, 0), (gx2, 10, 10), (gx2, 10, 45), (gx2, 35, 10)))
    # Slope surface
    n_slope = (0, 35/math.hypot(25, 35), 25/math.hypot(25, 35))
    quad((gx1, 35, 10), (gx2, 35, 10), (gx2, 10, 45), (gx1, 10, 45), n_slope)

    out = ["solid L_BRACKET"]
    for n, v1, v2, v3 in facets:
        out.append(f"  facet normal {n[0]:.4f} {n[1]:.4f} {n[2]:.4f}")
        out.append("    outer loop")
        out.append(f"      vertex {v1[0]:.4f} {v1[1]:.4f} {v1[2]:.4f}")
        out.append(f"      vertex {v2[0]:.4f} {v2[1]:.4f} {v2[2]:.4f}")
        out.append(f"      vertex {v3[0]:.4f} {v3[1]:.4f} {v3[2]:.4f}")
        out.append("    endloop")
        out.append("  endfacet")
    out.append("endsolid L_BRACKET\n")

    path = os.path.join(SAMPLE_DIR, "sample-3d.stl")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(f"Created: {path}")

if __name__ == "__main__":
    create_bracket_dxf()
    create_gear_dxf()
    create_sample_stl()

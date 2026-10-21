"""
CAD 파일 검사 및 통계 추출 CLI 도구 (inspect_cad.py)
DXF, STL, OBJ 파일을 분석하여 레이어, 엔터티 개수, 바운딩 박스, 크기를 JSON으로 출력합니다.
"""
import sys
import os
import json
import math

def inspect_dxf(filepath):
    layers = {}
    entities = {}
    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    
    current_section = None
    current_table = None
    in_layer_table = False
    current_layer = None

    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = [line.rstrip("\r\n") for line in f]

    i = 0
    n = len(lines)
    while i < n - 1:
        code = lines[i].strip()
        val = lines[i + 1].strip()
        i += 2

        if code == "0":
            if val == "SECTION":
                pass
            elif val == "TABLE":
                pass
            elif val == "ENDTAB":
                in_layer_table = False
            elif val == "ENDSEC":
                current_section = None
            elif in_layer_table and val == "LAYER":
                current_layer = {}
            elif current_section == "ENTITIES":
                ent_type = val
                entities[ent_type] = entities.get(ent_type, 0) + 1
        elif code == "2":
            if val in ("HEADER", "TABLES", "BLOCKS", "ENTITIES"):
                current_section = val
            elif val == "LAYER":
                in_layer_table = True
            elif in_layer_table and current_layer is not None and "name" not in current_layer:
                current_layer["name"] = val
                layers[val] = current_layer
        elif code == "62": # Color
            if in_layer_table and current_layer is not None:
                current_layer["color"] = int(val)
        elif code in ("10", "11", "12", "13"): # X coord
            try:
                x = float(val)
                min_x = min(min_x, x)
                max_x = max(max_x, x)
            except ValueError:
                pass
        elif code in ("20", "21", "22", "23"): # Y coord
            try:
                y = float(val)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
            except ValueError:
                pass
        elif code in ("30", "31", "32", "33"): # Z coord
            try:
                z = float(val)
                min_z = min(min_z, z)
                max_z = max(max_z, z)
            except ValueError:
                pass

    has_bounds = min_x != float("inf")
    return {
        "file": os.path.basename(filepath),
        "format": "DXF",
        "layers": list(layers.keys()),
        "layer_count": len(layers),
        "entities": entities,
        "total_entities": sum(entities.values()),
        "bounds": {
            "min": [min_x, min_y, min_z] if has_bounds else [0, 0, 0],
            "max": [max_x, max_y, max_z] if has_bounds else [0, 0, 0],
            "size": [max_x - min_x, max_y - min_y, max_z - min_z] if has_bounds else [0, 0, 0]
        }
    }

def inspect_stl(filepath):
    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    triangles = 0
    is_binary = False

    with open(filepath, "rb") as f:
        header = f.read(80)
        if len(header) == 80:
            count_bytes = f.read(4)
            if len(count_bytes) == 4:
                expected_tris = int.from_bytes(count_bytes, byteorder="little")
                expected_size = 84 + expected_tris * 50
                file_size = os.path.getsize(filepath)
                if file_size == expected_size:
                    is_binary = True
                    triangles = expected_tris
                    for _ in range(min(triangles, 500000)):
                        data = f.read(50)
                        if len(data) < 50:
                            break
                        # Read 3 vertices (each 3 floats)
                        import struct
                        pts = struct.unpack("<12f", data[12:48])
                        for v in range(3):
                            vx, vy, vz = pts[v*3], pts[v*3+1], pts[v*3+2]
                            min_x, max_x = min(min_x, vx), max(max_x, vx)
                            min_y, max_y = min(min_y, vy), max(max_y, vy)
                            min_z, max_z = min(min_z, vz), max(max_z, vz)

    if not is_binary:
        # ASCII STL
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                parts = line.strip().split()
                if not parts:
                    continue
                if parts[0] == "facet":
                    triangles += 1
                elif parts[0] == "vertex" and len(parts) >= 4:
                    try:
                        x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                        min_x, max_x = min(min_x, x), max(max_x, x)
                        min_y, max_y = min(min_y, y), max(max_y, y)
                        min_z, max_z = min(min_z, z), max(max_z, z)
                    except ValueError:
                        pass

    has_bounds = min_x != float("inf")
    return {
        "file": os.path.basename(filepath),
        "format": "STL",
        "sub_type": "Binary" if is_binary else "ASCII",
        "triangles": triangles,
        "bounds": {
            "min": [min_x, min_y, min_z] if has_bounds else [0, 0, 0],
            "max": [max_x, max_y, max_z] if has_bounds else [0, 0, 0],
            "size": [max_x - min_x, max_y - min_y, max_z - min_z] if has_bounds else [0, 0, 0]
        }
    }

def inspect_dwg(filepath):
    import subprocess
    import tempfile
    tools_dir = os.path.dirname(__file__)
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        temp_dxf = tmp.name
    try:
        script = f"const {{convertDwgToDxf}} = require('dwg2dxf-converter'); convertDwgToDxf({json.dumps(filepath)}, {json.dumps(temp_dxf)}).then(() => process.exit(0)).catch(() => process.exit(1));"
        res = subprocess.run(["node", "-e", script], cwd=tools_dir, capture_output=True)
        if res.returncode == 0 and os.path.exists(temp_dxf):
            info = inspect_dxf(temp_dxf)
            info["file"] = os.path.basename(filepath)
            info["format"] = "DWG"
            return info
        else:
            return {"file": os.path.basename(filepath), "format": "DWG", "error": "DWG conversion failed"}
    finally:
        if os.path.exists(temp_dxf):
            try:
                os.remove(temp_dxf)
            except Exception:
                pass

def main():
    if len(sys.argv) < 2:
        print("Usage: python inspect_cad.py <file.dwg|file.dxf|file.stl|file.obj>")
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(json.dumps({"error": f"File not found: {path}"}, ensure_ascii=False))
        sys.exit(1)

    ext = os.path.splitext(path)[1].lower()
    if ext == ".dwg":
        res = inspect_dwg(path)
    elif ext == ".dxf":
        res = inspect_dxf(path)
    elif ext == ".stl":
        res = inspect_stl(path)
    else:
        res = {"file": os.path.basename(path), "format": ext.replace(".", "").upper(), "note": "Unsupported format for inspect CLI"}

    print(json.dumps(res, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()

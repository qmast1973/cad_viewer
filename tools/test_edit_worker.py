"""부품 이동·복사 편집 서버(bin/dwg2lite.exe --edit-server) 시험:
  python -X utf8 tools/test_edit_worker.py [도면.dwg|dxf] [--fmt=dxf|dwg]    (기본: sample/sample.dwg, 저장 형식 dxf)
확인: 열기 → 점으로 부품 고르기(미리보기 선) → 복사+이동 저장 → 새 파일을 다시 열어 위치·개수 확인, 원본 해시 불변, 두 번 저장해도 쌓이지 않음."""
import sys, json, subprocess, tempfile, hashlib, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith('--')]
SRC = Path(args[0]) if args else ROOT / 'sample' / 'sample.dwg'
FMT = next((a[6:] for a in sys.argv if a.startswith('--fmt=')), 'dxf')
EXE = ROOT / 'bin' / 'dwg2lite.exe'
fails = []


def check(name, ok, info=''):
    print(('  OK  ' if ok else ' FAIL ') + name, info)
    if not ok:
        fails.append(name)


def start():
    return subprocess.Popen([str(EXE), '--edit-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')


def call(p, line):
    p.stdin.write(line + '\n')
    p.stdin.flush()
    return json.loads(p.stdout.readline())


sha = lambda f: hashlib.sha1(Path(f).read_bytes()).hexdigest()
h0 = sha(SRC)
typ = 'dxf' if SRC.suffix.lower() == '.dxf' else 'dwg'
p = start()
t0 = time.time()
r = call(p, f'open {typ} {SRC}')
check('열기', r.get('ok') and r.get('inserts', 0) > 0, f"{r.get('inserts')}개 부품, {time.time() - t0:.1f}초 {r.get('error', '')}")
if not r.get('ok'):
    sys.exit(1)
lst = call(p, 'list 6')
found = None
for it in lst['items']:
    b = it['bbox']
    q = call(p, f"pick {(b[0] + b[2]) / 2} {(b[1] + b[3]) / 2} 0")
    if q.get('found'):
        found = q['found']
        break
check('점으로 부품 고르기', found is not None, (found or {}).get('name'))
if not found:
    sys.exit(1)
check('미리보기 선 있음', len(found['polys']) > 0, f"선 {len(found['polys'])}개")
out_dir = Path(tempfile.mkdtemp(prefix='cadedit-out-'))
ops = out_dir / 'ops.txt'
h = found['handle']
ops.write_text(f'copy {h} 100.0 50.0\nmove {h} -25.0 10.0\n', encoding='utf-8')
outs = []
for k in (1, 2):
    out = out_dir / f'결과{k}.{FMT}'
    t1 = time.time()
    s = call(p, f'save {FMT} {ops} {out}')
    check(f'저장 {k}', s.get('ok') and out.exists(), f"{time.time() - t1:.1f}초 {s.get('error', '')}")
    outs.append((out, s))
check('원본 도면 파일 불변', sha(SRC) == h0)
if all(o[1].get('ok') for o in outs):
    # 저장한 파일을 새 편집 서버로 다시 열어, 같은 위치를 두 번 찍어 부품이 하나 늘었는지 확인
    p2 = start()
    r2 = call(p2, f'open {FMT} {outs[0][0]}')
    check('저장본 다시 열기', r2.get('ok'), f"부품 {r2.get('inserts')}개 (원본 {r.get('inserts')}개)")
    check('복사로 부품이 하나 늘어남', r2.get('inserts') == r.get('inserts') + 1, f"{r.get('inserts')} → {r2.get('inserts')}")
    b = found['bbox']
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    moved = call(p2, f"pick {cx + 100 - 25 + 0.0} {cy + 50 + 10 + 0.0} 0")     # 복사본은 (+100,+50) 에서 다시 (-25,+10) 이동하지 않음 → 복사본 위치
    q_copy = call(p2, f"pick {cx + 100} {cy + 50} 0")
    q_moved = call(p2, f"pick {cx - 25} {cy + 10} 0")
    check('복사본이 (+100,+50) 자리에 있음', bool(q_copy.get('found')) and q_copy['found']['name'] == found['name'])
    check('원본이 (-25,+10) 이동해 있음', bool(q_moved.get('found')) and q_moved['found']['name'] == found['name'])
    p2.stdin.write('close\n'); p2.stdin.flush()
    check('두 번 저장 결과 크기 비슷(쌓이지 않음)', abs(outs[0][0].stat().st_size - outs[1][0].stat().st_size) < 1000, f"{outs[0][0].stat().st_size} vs {outs[1][0].stat().st_size}")
p.stdin.write('close\n'); p.stdin.flush()
print('\n>> 모두 통과 <<' if not fails else f'\n>> 실패 {len(fails)}건: {fails}')
sys.exit(1 if fails else 0)

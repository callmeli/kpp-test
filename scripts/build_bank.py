#!/usr/bin/env python3
"""生成服务端题库 worker/bank.json（Worker 首次请求 / 版本升级时导入 D1）。

来源：
  data/source/questions.json       抓取的原始题目（英文 + 图片 + 答案）
  data/source/zh.json   中文翻译
  data/bank_fixes/review_*.json            审校结果（马来文翻译、中英文修正、答案修正），格式见 README

用法：python3 scripts/build_bank.py [--v 版本号]
版本号默认取当前时间 YYYYMMDDHH；只要比线上 kv.seed_v 大，部署后就会导入（后台改过的题不会被覆盖）。
"""
import argparse, glob, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)

ap = argparse.ArgumentParser()
ap.add_argument('--v', type=int, default=int(time.strftime('%Y%m%d%H')))
args = ap.parse_args()

qs = json.load(open(P('data/source/questions.json')))['questions']
zh = json.load(open(P('data/source/zh.json')))['questions']

fixes = {}
for f in sorted(glob.glob(P('data/bank_fixes/review_*.json'))):
    for x in json.load(open(f)):
        fixes[x['id']] = x
# 人工确认过的答案修正（覆盖审校建议）：{id: 'B'}；以及要下线的重复题：{"drop": [...]}
manual = json.load(open(P('data/bank_fixes/manual.json'))) if os.path.exists(P('data/bank_fixes/manual.json')) else {}
drop = set(manual.get('drop', []))
ans_fix = manual.get('answers', {})
notes = manual.get('notes', {})   # 答题后显示的说明（比如法规已更新）：{id: {zh, en, ms}}

SEC = {'section-a': 'A', 'section-b': 'B', 'section-c': 'C'}
out, stats = [], {'ms': 0, 'zh_fix': 0, 'en_fix': 0, 'ans_fix': 0, 'dropped': 0}
for q in qs:
    if q['id'] in drop:
        stats['dropped'] += 1
        continue
    fx = fixes.get(q['id']) or {}
    z = zh.get(q['id'], {})
    zf = fx.get('zh_fix') or {}
    ef = fx.get('en_fix') or {}
    ms = fx.get('ms') or {}
    t = {'en': (ef.get('q') or q['question']).strip(), 'zh': (zf.get('q') or z.get('question') or '').strip() or None, 'ms': (ms.get('q') or '').strip() or None}
    if t['ms']: stats['ms'] += 1
    if zf: stats['zh_fix'] += 1
    if ef: stats['en_fix'] += 1
    opts = []
    for o in q['options']:
        l = o['label']
        if o['type'] == 'image':
            opts.append({'l': l, 'img': '/' + o['imagePath']})
        else:
            opts.append({'l': l, 't': {
                'en': ((ef.get('o') or {}).get(l) or o['content']).strip(),
                'zh': ((zf.get('o') or {}).get(l) or (z.get('options') or {}).get(l) or '').strip() or None,
                'ms': ((ms.get('o') or {}).get(l) or '').strip() or None,
            }})
    a = ans_fix.get(q['id']) or q['correctAnswer']
    if a != q['correctAnswer']: stats['ans_fix'] += 1
    assert a in [o['l'] for o in opts], q['id']
    item = {'id': q['id'], 's': SEC[q['id'][:9]], 't': t, 'o': opts, 'a': a}
    if q['id'] in notes:
        item['n'] = notes[q['id']]
    if q['questionImages']:
        item['img'] = ['/' + p for p in q['questionImages']]
    out.append(item)

json.dump({'v': args.v, 'qs': out}, open(P('worker/bank.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(f"worker/bank.json v={args.v} questions={len(out)}", stats, file=sys.stderr)

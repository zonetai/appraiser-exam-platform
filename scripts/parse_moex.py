"""把考選部試題 PDF 切成逐題 JSON。
用法：py -3 -I scripts/parse_moex.py data/moex/manifest.json db/seed/questions.moex.json
需要 pypdf（py -3 -m pip install pypdf）。
切出來的題目 verified=false，請在網站或 seed 中核對後改為 true。
"""
import json
import re
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    print("缺少 pypdf：py -3 -m pip install pypdf", file=sys.stderr)
    sys.exit(2)

CN_NUM = "一二三四五六七八九十"
Q_START = re.compile(r"^\s*([一二三四五六七八九十]+)、")
NOISE = [
    re.compile(r"^\d+年專門職業及技術人員高等考試.*"),
    re.compile(r"^(等\s*別|類\s*科|科\s*目|考試時間|代號|頁次)[：:]"),
    re.compile(r"^※注意"),
    re.compile(r"^不必抄題"),
    re.compile(r"^本科目除專門名詞"),
    re.compile(r"^（請接背面）|^\(請接背面\)"),
    re.compile(r"^\s*座號[：:]?\s*$"),
    re.compile(r"^\s*\d+\s*$"),
]
SCORE = re.compile(r"[（(]\s*(\d+)\s*分\s*[）)]")


def clean_lines(text: str):
    out = []
    for raw in text.splitlines():
        line = raw.replace("　", " ").rstrip()
        if not line.strip():
            continue
        if any(p.search(line.strip()) for p in NOISE):
            continue
        out.append(line.strip())
    return out


def split_questions(lines):
    qs = []
    cur = None
    for line in lines:
        m = Q_START.match(line)
        if m and (cur is None or CN_NUM.index(m.group(1)[0]) >= 0):
            # 新題開始（只接受遞增的題號，避免內文「一、」誤判）
            no = cn_to_int(m.group(1))
            if cur is None or no == cur["no"] + 1:
                if cur:
                    qs.append(cur)
                cur = {"no": no, "lines": [line[m.end():].strip()]}
                continue
        if cur:
            cur["lines"].append(line)
    if cur:
        qs.append(cur)
    return qs


def split_by_score(lines):
    """備援：部分 PDF（如民法科）的題號「一、二、」是獨立字型未被抽出，改以每題結尾的「（25 分）」切題。"""
    qs = []
    cur = []
    for line in lines:
        cur.append(line)
        if SCORE.search(line) and re.search(r"[）)]\s*$", line):
            qs.append({"no": len(qs) + 1, "lines": cur})
            cur = []
    if cur and qs:  # 殘留的附註併入最後一題
        qs[-1]["lines"].extend(cur)
    return qs


def cn_to_int(s: str) -> int:
    table = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    if s == "十":
        return 10
    if s.startswith("十"):
        return 10 + table[s[1]]
    if s.endswith("十"):
        return table[s[0]] * 10
    if "十" in s:
        a, b = s.split("十")
        return table[a] * 10 + table[b]
    return table[s]


def join_text(lines):
    """中文斷行合併：行尾非標點就直接接起來。"""
    text = ""
    for ln in lines:
        if not text:
            text = ln
            continue
        if re.match(r"^[（(][一二三四五六七八九十]+[）)]|^[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽]|^\d+[.、]|^[a-z][.、]", ln):
            text += "\n" + ln
        elif text[-1] in "。：；？！）)」』":
            text += "\n" + ln
        else:
            text += ln
    return text.strip()


def parse_scores(text: str):
    scores = [int(s) for s in SCORE.findall(text)]
    if not scores:
        return None
    if len(scores) == 1:
        return scores[0]
    total = sum(scores)
    # 子題配分總和通常 = 25 或 50；若總和超過 100 則取最後一個
    return total if total <= 100 else scores[-1]


def main():
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out_path = Path(sys.argv[2])
    results = []
    for item in manifest:
        try:
            reader = PdfReader(item["file"])
            text = "\n".join((p.extract_text() or "") for p in reader.pages)
        except Exception as e:  # noqa: BLE001
            print(f"讀取失敗 {item['file']}: {e}", file=sys.stderr)
            continue
        lines = clean_lines(text)
        qs = split_questions(lines)
        if len(qs) <= 1 and len(SCORE.findall("\n".join(lines))) >= 2:
            alt = split_by_score(lines)
            if len(alt) > len(qs):
                qs = alt
        if not qs and lines and SCORE.search("\n".join(lines)):
            qs = [{"no": 1, "lines": lines}]  # 整卷單一大題（如 110 年實務 100 分）
        if not qs:
            print(f"{item['year']} {item['subject_name']}: 切不出題目（可能是掃描檔）", file=sys.stderr)
            continue
        for q in qs:
            body = join_text(q["lines"])
            results.append({
                "year": item["year"],
                "subject": item["subject"],
                "exam_type": "申論",
                "question_no": q["no"],
                "score": parse_scores(body),
                "text": body,
                "source_url": item["source_url"],
                "verified": False,
            })
        print(f"{item['year']} {item['subject_name']}: {len(qs)} 題")
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"共 {len(results)} 題 → {out_path}")


if __name__ == "__main__":
    main()

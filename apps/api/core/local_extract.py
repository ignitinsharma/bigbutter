from core.docs import LOCAL_EXTRACT as __doc__  # module docstring lives in core/docs.py
import re
from typing import Optional, Dict, List
from core.wordlists import STOP_WORDS as STOP, NAME_STOPWORDS, TYPE_PATTERNS

def local_extract(raw: str, known: Optional[List[str]] = None, known_categories: Optional[List[str]] = None) -> Dict[str, object]:
    # Rule-based fallback: guess type/tags/people/title from regexes when no LLM is reachable.
    known = known or []
    low = raw.lower()
    typ = next((t for t, pat in TYPE_PATTERNS if re.search(pat, raw, re.I)), "note")

    hit = [k for k in known if k.lower() in low]
    freq: dict[str, int] = {}
    for w in re.sub(r"[^a-z0-9\s₹]", " ", low).split():
        if w not in STOP and len(w) > 3:
            freq[w] = freq.get(w, 0) + 1
    top = sorted(freq, key=lambda w: -freq[w])
    tags = list(dict.fromkeys([*hit, *top]))[:4]

    people = [w for w in re.findall(r"\b[A-Z][a-z]{2,}\b", raw) if w not in NAME_STOPWORDS][:3]

    first = re.split(r"[.!?]", raw.strip())[0].strip()
    words = first.split()[:7]
    while len(words) > 2 and words[-1].lower().strip(",;:") in STOP:  # no "…groceries at the"
        words.pop()
    title = " ".join(words).rstrip(",;:")
    title = title[:1].upper() + title[1:] if title else ""
    summary = first[:1].upper() + first[1:] + ("" if first.endswith(".") else ".") if first else ""
    category = next((c for c in (known_categories or []) if c and re.search(rf"\b{re.escape(c.lower())}\b", low)), "")
    return {"title": title, "type": typ, "summary": summary, "tags": tags,
            "people": people, "action_items": [first] if typ == "task" and first else [],
            "category": category, "keywords": tags}

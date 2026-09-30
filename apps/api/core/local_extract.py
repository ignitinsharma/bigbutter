"""Rule-based extraction fallback (zero deps, zero key). Port of prototype.html localExtract.

Rough but deterministic: keyword/type regexes, frequency tags reusing known
ones, capitalised-word people, first-sentence title/summary. Anything the
cloud extractor would do better is clearly its job on keys day.
"""
import re
from typing import Optional, Dict, List

STOP = set(
    "the a an and or but so if then than that this these those i we you he she it they "
    "me my our your of to in on at for with about from into over after before is are was "
    "were be been being do does did have has had will would can could should not no yes "
    "just really very actually honestly like need want think thinking feel today tomorrow yesterday".split()
)

def local_extract(raw: str, known: Optional[List[str]] = None, known_categories: Optional[List[str]] = None) -> Dict[str, object]:
    # Rule-based fallback: guess type/tags/people/title from regexes when no LLM is reachable.
    known = known or []
    low = raw.lower()
    if re.search(r"\b(need to|should|remind|ask |todo|must |have to|follow up)\b", raw, re.I):
        typ = "task"
    elif re.search(r"\b(idea|what if|maybe we|we could|thinking we|instead of)\b", raw, re.I):
        typ = "idea"
    elif re.search(r"[₹$]\s?\d|\b\d+\s?(rupees|rs|dollars)\b", raw, re.I):
        typ = "expense"
    elif re.search(r"\b(feel|felt|tired|lonely|anxious|happy|frustrated|worst)\b", raw, re.I):
        typ = "journal"
    else:
        typ = "note"

    hit = [k for k in known if k.lower() in low]
    freq: dict[str, int] = {}
    for w in re.sub(r"[^a-z0-9\s₹]", " ", low).split():
        if w not in STOP and len(w) > 3:
            freq[w] = freq.get(w, 0) + 1
    top = sorted(freq, key=lambda w: -freq[w])
    tags = list(dict.fromkeys([*hit, *top]))[:4]

    people = [w for w in re.findall(r"\b[A-Z][a-z]{2,}\b", raw)
              if w not in ("I", "The", "So", "And", "But", "We", "My", "This", "That")][:3]

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

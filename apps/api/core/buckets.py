"""Buckets: a small, closed set of life areas every note lands in exactly one of.

The LLM picks from the user's list (EXTRACT_PROMPT); anything off-list falls back to
MiniLM similarity against each bucket's description, then to Other. Tags and
category stay free-text underneath — buckets are the stable top level.
"""
from typing import Optional

OTHER = "Other"

# Default list + what each one covers (the descriptions feed the MiniLM fallback).
DEFAULTS = {
    "Work": "job, office, meetings, colleagues, clients, projects, deadlines, career",
    "Technology": "software, code, programming, computers, gadgets, apps, phones, AI, devices",
    "Shopping": "buy, purchase, order, groceries, store, products, wishlist, things to get",
    "Health": "doctor, dentist, medicine, fitness, exercise, gym, diet, sleep, wellbeing",
    "Finance": "money, bills, payments, bank, budget, investments, taxes, expenses, salary",
    "Home": "house, chores, cleaning, repairs, family, cooking, rent, household",
    "Learning": "study, courses, books, reading, research, skills, notes from learning",
    "Travel": "trips, flights, hotels, vacation, booking, places to visit, commute",
    "Personal": "friends, relationships, feelings, journal, hobbies, events, self",
}

MAX_BUCKETS = 20
MAX_LEN = 24

def clean(name: str) -> str:
    # Collapse whitespace, cap length; keeps the user's casing.
    return " ".join(str(name or "").split())[:MAX_LEN]

def normalize(names: Optional[list]) -> list:
    """The user's list (NULL → defaults), de-duped case-insensitively, capped,
    with Other always present and last."""
    src = list(DEFAULTS) if names is None else names
    out, seen = [], {OTHER.lower()}
    for n in src:
        c = clean(n)
        if c and c.lower() not in seen:
            seen.add(c.lower())
            out.append(c)
    return out[:MAX_BUCKETS - 1] + [OTHER]

def match(name: str, buckets: list) -> Optional[str]:
    # Canonical spelling of name in buckets (case-insensitive), or None.
    low = clean(name).lower()
    return next((b for b in buckets if b.lower() == low), None) if low else None

_desc_vecs: dict = {}  # bucket name → MiniLM vector of "name: description"

def _cos(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0

def pick_by_vector(vec: list, buckets: list, min_sim: float = 0.2) -> str:
    """No-LLM fallback: the bucket whose description is closest to the note's MiniLM
    vector. Custom buckets are described by their name alone. Below min_sim → Other.
    Raises RuntimeError when the local model is missing (caller falls back to Other)."""
    from core.local_embed import embed_local
    best, score = OTHER, min_sim
    for b in buckets:
        if b == OTHER:
            continue
        if b not in _desc_vecs:
            _desc_vecs[b] = embed_local(f"{b}: {DEFAULTS.get(b, b)}")
        s = _cos(vec, _desc_vecs[b])
        if s > score:
            best, score = b, s
    return best

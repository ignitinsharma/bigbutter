# wordlists: fixed word lists and keyword patterns the rule-based code matches against.

# Used by: core/local_extract.py — filler words never used as tags or title endings.
STOP_WORDS = set(
    "the a an and or but so if then than that this these those i we you he she it they "
    "me my our your of to in on at for with about from into over after before is are was "
    "were be been being do does did have has had will would can could should not no yes "
    "just really very actually honestly like need want think thinking feel today tomorrow yesterday".split()
)

# Used by: core/local_extract.py — capitalised words that start sentences, not names.
NAME_STOPWORDS = ("I", "The", "So", "And", "But", "We", "My", "This", "That")

# Used by: core/local_extract.py — first match wins, in this order; no match → "note".
TYPE_PATTERNS = (
    ("task", r"\b(need to|should|remind|ask |todo|must |have to|follow up)\b"),
    ("idea", r"\b(idea|what if|maybe we|we could|thinking we|instead of)\b"),
    ("expense", r"[₹$]\s?\d|\b\d+\s?(rupees|rs|dollars)\b"),
    ("journal", r"\b(feel|felt|tired|lonely|anxious|happy|frustrated|worst)\b"),
)

# Used by: core/openai_client.py core_query/_on_topic — words that describe the search itself, not what it's about.
SEARCH_FILLER = set(
    "notes note related relating regarding about any show me my find all there present kind kinds of "
    "the a an some please what which do does i have has is are to for on with stuff things thing anything "
    "get list search give tell".split()
)

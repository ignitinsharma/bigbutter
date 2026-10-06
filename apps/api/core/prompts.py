# prompts: every LLM prompt in one place, so wording changes never touch the logic.
# Templates with {placeholders} are filled with .format(); EXTRACT_PROMPT and QUERY_PROMPT hold
# literal JSON braces, so their per-call input is a separate *_INPUT template appended after them.

# Used by: core/openai_client.py extract_note — the structuring instructions.
EXTRACT_PROMPT = """Turn this raw personal capture into one structured record.
Return ONLY JSON: {"title":"under 8 words","type":"idea|task|note|person|link|expense|journal","summary":"1-2 short sentences, fix grammar, invent nothing","bucket":"exactly one name from the Buckets list","category":"1-3 lowercase words: what the note is ABOUT","keywords":["3-8 lowercase synonyms or broader terms for the category"],"tags":["2-5 lowercase topics"],"people":["names"],"action_items":["imperative phrases if actionable"]}
"task" only if they must DO something. "idea" for proposals and hypotheses. "expense" if money moved. "journal" for reflection. "note" is the fallback.
category resolves the word's MEANING in context — the same word can mean different things:
- "Apple is a great fruit" → category "fruit", keywords ["fruit","food","produce","healthy snack"]
- "Apple is a good mobile" → category "mobile phone", keywords ["phone","smartphone","mobile","device","iphone"]
- "Samsung is a mobile" → category "mobile phone", keywords ["phone","smartphone","mobile","device","android"]
bucket = the broad life area, copied exactly from the Buckets list below; "Other" only if none fits.
people = human names only, never brands or companies.
Reuse an existing tag or category whenever it fits — inventing a synonym leaves notes unconnected forever."""

# Used by: core/openai_client.py extract_note — per-capture input appended after EXTRACT_PROMPT.
EXTRACT_INPUT = '\n\nBuckets: {buckets}\nExisting tags: {tags}\nExisting categories: {cats}\n\nCapture:\n"""{text}"""'

# Phrases from EXTRACT_PROMPT's schema; a summary containing them is an echo, not a summary.
SCHEMA_ECHO = ("short sentences", "invent nothing", "fix grammar")

# Used by: core/openai_client.py understand_query — search → retrieval hints.
QUERY_PROMPT = """You turn a search over personal notes into retrieval hints.
Return ONLY JSON: {"terms":"the core subject words, no question filler","category":"1-3 lowercase words or empty","expansions":["3-6 lowercase synonyms / related words"]}
Resolve the MEANING: "best phone" → {"terms":"best phone","category":"mobile phone","expansions":["smartphone","mobile","phone","device","iphone","android"]}
Strip filler: "is there any kind of fruit notes present?" → {"terms":"fruit","category":"fruit","expansions":["fruit","food","produce"]}
Prefer one of the existing categories when it matches."""

# Used by: core/openai_client.py understand_query — per-search input appended after QUERY_PROMPT.
QUERY_INPUT = '\n\nExisting categories: {cats}\n\nSearch: "{q}"'

# Used by: core/openai_client.py judge — relevance check for borderline search hits.
JUDGE_PROMPT = """You check results for a search over someone's personal notes.
Search: "{q}"
Keep a note only if it is about the search topic: directly, or as a clear part of it
(studying is part of education; an iPhone is a mobile phone; a dentist visit is health).
Do NOT keep a note that merely shares a broad area (both "technology") or uses a word in another sense.
Notes:
{notes}
Return ONLY JSON: {{"relevant":["n1","n4"]}} with the ids of the notes to keep, or {{"relevant":[]}} if none fit."""

# Used by: core/openai_client.py summarize — 1-2 line answer grounded in the top hits.
SUMMARIZE_PROMPT = "Notes:\n{ctx}\n\nThey searched for '{query}'. Answer in 1-2 short lines using ONLY these notes."

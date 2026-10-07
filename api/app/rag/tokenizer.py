"""BM25 tokenizer, shared by indexing (`chunk_terms`) and querying.

`sim-hr-102`, `3.1` and `w-2` stay whole (and also yield their parts), so doc codes and section
numbers are matchable; plain words are stemmed with the English Snowball stemmer.
"""

import re
import unicodedata
from collections import Counter
from functools import lru_cache

import snowballstemmer

TOKEN_RE = re.compile(r"[a-z0-9]+(?:[.\-/][a-z0-9]+)*")
PART_RE = re.compile(r"[a-z0-9]+")

APOSTROPHE_RE = re.compile(r"['’‘`]")

_STOPWORD_TEXT = """
    a about above after again against all am an and any are aren't as at be because been before
    being below between both but by can cannot could couldn't did didn't do does doesn't doing
    don't down during each few for from further had hadn't has hasn't have haven't having he her
    here hers herself him himself his how i if in into is isn't it its itself just let me more
    most must my myself no nor not now of off on once only or other ought our ours ourselves out
    over own same shall she should shouldn't so some such than that the their theirs them
    themselves then there these they this those through to too under until up upon very was
    wasn't we were weren't what when where which while who whom why will with won't would
    wouldn't you your yours yourself yourselves s t d ll m re ve also may might per via
    """
# Apostrophes are stripped before matching, so "don't" is matched as "dont".
STOPWORDS = frozenset(APOSTROPHE_RE.sub("", word) for word in _STOPWORD_TEXT.split())

_stemmer = snowballstemmer.stemmer("english")


@lru_cache(maxsize=65536)
def _stem(word: str) -> str:
    return _stemmer.stemWord(word)


def _keep(token: str) -> bool:
    if token in STOPWORDS:
        return False
    return len(token) > 1 or token.isdigit()


def _normalize(token: str) -> str:
    return _stem(token) if token.isalpha() else token


def tokenize(text: str) -> list[str]:
    """Normalized, stopword-filtered, stemmed tokens (compounds plus their parts)."""
    normalized = APOSTROPHE_RE.sub("", unicodedata.normalize("NFKC", text).lower())
    tokens: list[str] = []
    for match in TOKEN_RE.finditer(normalized):
        token = match.group()
        parts = PART_RE.findall(token)
        if len(parts) > 1:
            tokens.append(token)  # compound: keep whole, unstemmed
            tokens.extend(_normalize(part) for part in parts if _keep(part))
        elif _keep(token):
            tokens.append(_normalize(token))
    return tokens


def term_freqs(text: str) -> Counter[str]:
    return Counter(tokenize(text))

from app.rag.tokenizer import term_freqs, tokenize


def test_codes_sections_and_stems() -> None:
    tokens = tokenize("SIM-HR-102 §3.1 employees' leave")
    for expected in ("sim-hr-102", "sim", "hr", "102", "3.1", "employe", "leav"):
        assert expected in tokens


def test_stopwords_and_single_letters_dropped_but_digits_kept() -> None:
    tokens = tokenize("The employee doesn't get a W-2 in 5 days")
    assert "the" not in tokens
    assert "a" not in tokens
    assert "doesnt" not in tokens
    assert "w-2" in tokens  # compound kept whole
    assert "w" not in tokens  # single letter part dropped
    assert "2" in tokens and "5" in tokens


def test_nfkc_and_case() -> None:
    assert tokenize("ＰＴＯ Policy") == tokenize("pto policy")


def test_term_freqs_counts() -> None:
    freqs = term_freqs("leave leave leaves")
    assert freqs["leav"] == 3

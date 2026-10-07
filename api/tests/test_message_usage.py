from app.schemas.chat import MessageUsageOut


def test_usage_from_retrieval() -> None:
    retrieval = {
        "timings_ms": {"search": 120, "total": 4210, "ttft": 2900},
        "usage": {"input_tokens": 900, "cost_usd": 0.00041},
    }
    usage = MessageUsageOut.from_retrieval(retrieval)
    assert usage == MessageUsageOut(latency_ms=4210, ttft_ms=2900, cost_usd=0.00041)


def test_usage_missing() -> None:
    assert MessageUsageOut.from_retrieval(None) is None
    assert MessageUsageOut.from_retrieval({}) is None
    partial = MessageUsageOut.from_retrieval({"timings_ms": {"total": 10}})
    assert partial == MessageUsageOut(latency_ms=10, ttft_ms=None, cost_usd=None)

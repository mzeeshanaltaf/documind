"""Answer the judge calls parked by `EVAL_JUDGE_MODE=offline` (local only, no Anthropic spend).

    uv run python -m scripts.offline_tasks status
    uv run python -m scripts.offline_tasks show [--limit 20] [--prompt KEY] [--out FILE]
    uv run python -m scripts.offline_tasks export FILE.jsonl [--limit 200] [--prompt KEY]
    uv run python -m scripts.offline_tasks import ANSWERS.jsonl

`show` prints the pending tasks for reading (each prompt's system text and output schema once);
`export` writes them as JSONL. `import` takes one JSON object per line,
`{"task_id": "...", "output": {...}}` (or `{"task_id": "...", "refusal": true}`), validates each
against the prompt's schema and stores it. The waiting jobs pick the answers up on their next
poll (`EVAL_OFFLINE_POLL_S`) and any follow-up call (claims_verify after claims_extract, validate
after generate) shows up as a new pending task: repeat until `status` shows nothing pending.
"""

import argparse
import asyncio
import json
import re
import sys
import uuid
from pathlib import Path

from app.core.db import engine
from app.judge import offline


def compact(packet: str, pattern: str) -> str:
    """An unanswerable candidate with only the chunk headers and the lines matching `pattern`
    (the validator's question is whether any excerpt answers it)."""
    head, _, rest = packet.partition("<chunks>")
    regex = re.compile(pattern, re.IGNORECASE)
    lines = []
    for line in rest.partition("</chunks>")[0].splitlines():
        if re.match(r"^\[\d+\] ", line) or (pattern and regex.search(line)):
            lines.append(line[:400])
    body = "\n".join(lines)
    return f"{head}<chunks (headers + lines matching the pattern)>\n{body}\n</chunks>"


def render(
    tasks: list[offline.OfflineTask],
    keys: dict[uuid.UUID, str],
    *,
    system: bool = True,
    catalog: bool = True,
    grep: str | None = None,
) -> str:
    out: list[str] = []
    seen: set[str] = set()
    for t in tasks:
        key = keys.get(t.prompt_version_id, t.purpose) if t.prompt_version_id else t.purpose
        out.append(f"=== TASK {t.id} · {key} · sample {t.sample_idx}")
        if system and key not in seen:
            seen.add(key)
            out.append(f"--- SYSTEM ({key}; the same for every task of this prompt)")
            out.append(t.system)
            schema = json.dumps(t.output_schema, ensure_ascii=False, separators=(",", ":"))
            out.append(f"--- OUTPUT SCHEMA\n{schema}")
        out.append("--- PACKET")
        packet = t.packet
        if not catalog and "<catalog>" in packet:
            head, _, rest = packet.partition("<catalog>")
            packet = head + "<catalog>[omitted]</catalog>" + rest.partition("</catalog>")[2]
        if grep is not None and "Type: unanswerable" in packet and "<chunks>" in packet:
            packet = compact(packet, grep)
        out.append(packet)
        out.append("--- TASK")
        out.append(t.task)
        out.append("")
    return "\n".join(out)


async def status() -> int:
    counts = await offline.counts()
    if not counts:
        print("no offline tasks")
    for (purpose, state), n in sorted(counts.items()):
        print(f"{state:10} {purpose:32} {n}")
    return 0


async def show(
    limit: int, purpose: str | None, out: Path | None, system: bool, catalog: bool, grep: str | None
) -> int:
    tasks = await offline.pending(limit, purpose)
    text = render(
        tasks, await offline.prompt_keys(tasks), system=system, catalog=catalog, grep=grep
    )
    if out is not None:
        await asyncio.to_thread(out.write_text, text, encoding="utf-8")
        print(f"{len(tasks)} pending tasks written to {out}")
    else:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        print(text)
    return 0


async def export(path: Path, limit: int, purpose: str | None) -> int:
    tasks = await offline.pending(limit, purpose)
    keys = await offline.prompt_keys(tasks)
    lines = [
        json.dumps(
            {
                "task_id": str(t.id),
                "prompt": keys.get(t.prompt_version_id) if t.prompt_version_id else None,
                "model": t.model,
                "system": t.system,
                "packet": t.packet,
                "task": t.task,
                "output_schema": t.output_schema,
            },
            ensure_ascii=False,
        )
        for t in tasks
    ]
    body = "\n".join(lines) + ("\n" if lines else "")
    await asyncio.to_thread(path.write_text, body, encoding="utf-8")
    print(f"{len(tasks)} pending tasks written to {path}")
    return 0


async def import_answers(path: Path) -> int:
    ok = failed = 0
    content = await asyncio.to_thread(path.read_text, encoding="utf-8")
    for number, line in enumerate(content.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            task_id = uuid.UUID(str(row["task_id"]))
        except (ValueError, KeyError) as exc:
            print(f"line {number}: unreadable ({exc})")
            failed += 1
            continue
        status = "refusal" if row.get("refusal") else "ok"
        result = await offline.fulfil(task_id, row.get("output"), status=status)
        if result.ok:
            ok += 1
        else:
            failed += 1
            print(f"line {number}: task {task_id}: {result.error}")
    print(f"stored {ok}, rejected {failed}")
    return 1 if failed else 0


async def main(args: argparse.Namespace) -> int:
    try:
        if args.command == "status":
            return await status()
        if args.command == "show":
            return await show(
                args.limit,
                args.prompt,
                args.out,
                not args.no_system,
                not args.no_catalog,
                args.grep,
            )
        if args.command == "export":
            return await export(args.file, args.limit, args.prompt)
        return await import_answers(args.file)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    for name in ("show", "export"):
        p = sub.add_parser(name)
        p.add_argument("--limit", type=int, default=20 if name == "show" else 200)
        p.add_argument("--prompt")
        if name == "show":
            p.add_argument("--out", type=Path)
            p.add_argument("--no-system", action="store_true")
            p.add_argument("--no-catalog", action="store_true")
            p.add_argument(
                "--grep", help="unanswerable validations: show only chunk headers + matching lines"
            )
        else:
            p.add_argument("file", type=Path)
    sub.add_parser("import").add_argument("file", type=Path)
    sys.exit(asyncio.run(main(parser.parse_args())))

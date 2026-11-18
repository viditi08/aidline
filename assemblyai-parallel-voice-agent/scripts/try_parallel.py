import argparse
import asyncio
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from parallel_api import ParallelAPI  # noqa: E402

load_dotenv(".env.local")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("question")
    group = ap.add_mutually_exclusive_group()
    group.add_argument(
        "--query", action="append", help="short search keywords (repeatable)"
    )
    group.add_argument("--decision", metavar="SUBJECT", help="check a yes/no question")
    args = ap.parse_args()

    tools = ParallelAPI()
    t0 = time.perf_counter()
    try:
        if args.decision:
            out = await tools.decide(args.decision, args.question)
        elif args.query:
            out = await tools.search(args.question, args.query)
        else:
            out = await tools.search(
                f"Find authoritative sources on {args.question}.", [args.question]
            )
    finally:
        await tools.aclose()
    print(out)
    mode = "Decisions" if args.decision else tools.config.search_mode
    print(f"\n--- {time.perf_counter() - t0:.2f}s ({mode})")


if __name__ == "__main__":
    asyncio.run(main())

"""Install YOUR copy of Learning Radiology (5th ed.) into a private build.

Copies the PDF to public/book/learning-radiology-5e.pdf (git-ignored — it never enters the public
repository) after verifying its SHA-256. A local dev/preview server, or a build you deploy to an
access-protected host (Vercel "All Deployments" protection), then opens the book automatically.

    python scripts/book/install_book.py --pdf "C:/path/to/learning-radiology.pdf"
"""
import argparse
import hashlib
import shutil
import sys
from pathlib import Path

EXPECTED = "0f711fa48c1872ceb06cda81df9ec60b1de0eab0590b585dda0d9aae26dad1b1"
ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "public" / "book" / "learning-radiology-5e.pdf"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--allow-other-copy", action="store_true", help="install even if the hash differs (page anchors may be offset)")
    a = ap.parse_args()
    src = Path(a.pdf)
    h = hashlib.sha256(src.read_bytes()).hexdigest()
    if h != EXPECTED and not a.allow_other_copy:
        print(f"SHA-256 {h} differs from the verified 5th-edition copy; re-run with --allow-other-copy to install anyway.", file=sys.stderr)
        return 1
    DEST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, DEST)
    print(f"installed {DEST.relative_to(ROOT)} ({src.stat().st_size / 1e6:.1f} MB, sha256 {h[:16]}…). It is git-ignored.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

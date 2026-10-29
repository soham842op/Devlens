"""Ground truth for Python error handling: does the file contain a try/except (ast.Try / ast.TryStar)?
Usage: python -I py_try.py <paths.json>  -> prints {path: {"parse_ok": bool, "has_try": bool}}"""
import ast
import json
import os
import sys


def long_path(path):
    # Windows paths over 260 characters need the extended-length prefix
    return "\\\\?\\" + os.path.abspath(path) if os.name == "nt" and not path.startswith("\\\\?\\") else path


out = {}
for path in json.load(open(sys.argv[1], encoding="utf-8")):
    try:
        tree = ast.parse(open(long_path(path), encoding="utf-8", errors="strict").read(), filename=path)
    except (SyntaxError, UnicodeDecodeError, ValueError):
        out[path] = {"parse_ok": False, "has_try": False}
        continue
    try_types = (ast.Try,) + ((ast.TryStar,) if hasattr(ast, "TryStar") else ())
    out[path] = {"parse_ok": True, "has_try": any(isinstance(n, try_types) for n in ast.walk(tree))}
json.dump(out, sys.stdout)

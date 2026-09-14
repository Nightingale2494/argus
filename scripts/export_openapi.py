"""Export current FastAPI application OpenAPI schema into contracts/openapi.json.

Run from repository root:
    python scripts/export_openapi.py
"""
import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
API_DIR = os.path.join(REPO_ROOT, "services", "api")
sys.path.insert(0, API_DIR)

# Set deterministic test secret so Settings import succeeds cleanly
os.environ.setdefault("ARGUS_JWT_SECRET", "test-secret-key-must-be-at-least-32-chars-long-001")


def main() -> None:
    try:
        from app.main import app
        schema = app.openapi()
        out_path = os.path.join(REPO_ROOT, "contracts", "openapi.json")
        is_check = "--check" in sys.argv

        if is_check:
            if not os.path.exists(out_path):
                print(f"ERROR: {out_path} does not exist. Run without --check to generate it.", file=sys.stderr)
                sys.exit(1)
            with open(out_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
            # Compare normalized JSON
            current_str = json.dumps(schema, indent=2, sort_keys=True)
            existing_str = json.dumps(existing, indent=2, sort_keys=True)
            if current_str != existing_str:
                print("ERROR: OpenAPI schema drift detected! Run 'python scripts/export_openapi.py' to update.", file=sys.stderr)
                sys.exit(1)
            print(f"PASS: OpenAPI schema matches {out_path} (0 drift, {len(schema.get('paths', {}))} endpoints)")
            return

        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(schema, f, indent=2)
            f.write("\n")
        print(f"Successfully exported FastAPI OpenAPI schema to {out_path} ({len(schema.get('paths', {}))} endpoints)")
    except Exception as err:
        print(f"ERROR exporting OpenAPI schema: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

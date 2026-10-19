"""Compile playbook-library/*.yaml|json (source of truth from the ChatGPT spec) into JSON the app imports.
Usage: python3 scripts/import-playbook-library.py   (needs PyYAML; no network)"""
import json, pathlib, yaml
root = pathlib.Path(__file__).resolve().parent.parent
src, out = root / "playbook-library", root / "src/lib/orchestrator/library"
out.mkdir(parents=True, exist_ok=True)
docs = [d for d in yaml.safe_load_all((src / "playbooks.yaml").read_text(encoding="utf-8")) if d]
(out / "playbooks.json").write_text(json.dumps(docs, ensure_ascii=False, indent=1), encoding="utf-8")
for name in ("schemas.json", "brief-schemas.json", "registry.json"):
    (out / name).write_text(json.dumps(json.loads((src / name).read_text(encoding="utf-8")), ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(docs)} playbooks compiled")

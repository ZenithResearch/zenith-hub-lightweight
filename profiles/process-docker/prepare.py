"""Export reviewed source commits into an ignored, credential-free build context."""
import argparse, hashlib, json, pathlib, subprocess
PINS = {"service": ("ZenithResearch/service-management", "bc084f2a875f7af333d7f01db01c94a9f93c1672"),
        "runtime": ("ZenithResearch/process-runtime", "2efdf9672a279ae924c095cc357d15ccad754bf1")}
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-source", required=True)
    parser.add_argument("--runtime-source", required=True)
    args = parser.parse_args()
    output = pathlib.Path(__file__).parent / "context"
    output.mkdir(exist_ok=True)
    manifest = {"schema": "zenith.container-demo-sources.v1", "zenithVersion": "0.1.0", "sources": {}}
    for name, (repo, commit) in PINS.items():
        source = getattr(args, name + "_source")
        actual = subprocess.check_output(["git", "-C", source, "rev-parse", commit + "^{commit}"], text=True).strip()
        if actual != commit: raise ValueError("Source commit mismatch")
        raw = subprocess.check_output(["git", "-C", source, "archive", "--format=tar", commit])
        (output / (name + ".tar")).write_bytes(raw)
        manifest["sources"][name] = {"repository": repo, "commit": commit, "archiveSha256": hashlib.sha256(raw).hexdigest()}
    (output / "sources.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(output)
if __name__ == "__main__": main()

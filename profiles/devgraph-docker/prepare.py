"""Export canonical Devgraph source without local credentials or WIP."""
import argparse,hashlib,json,pathlib,subprocess
COMMIT="51fb962f8d3c08904b32e8d04235315edf4d9797"
def main():
    parser=argparse.ArgumentParser();parser.add_argument("--source",required=True);args=parser.parse_args()
    raw=subprocess.check_output(["git","-C",args.source,"archive","--format=tar",COMMIT])
    output=pathlib.Path(__file__).parent/"context";output.mkdir(exist_ok=True)
    (output/"devgraph.tar").write_bytes(raw)
    (output/"sources.json").write_text(json.dumps({"repository":"ZenithResearch/devgraph","commit":COMMIT,"archiveSha256":hashlib.sha256(raw).hexdigest()},indent=2)+"\n")
if __name__=="__main__":main()

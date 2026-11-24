#!/usr/bin/env python3
"""Create the Hub's named profile without adopting a personal credential store."""
import argparse, json, os, sys
from pathlib import Path
def save(file,value):
    file.write_text(json.dumps(value,indent=2)+"\n");file.chmod(0o600)
def main():
    parser=argparse.ArgumentParser();parser.add_argument("--root",type=Path,required=True);parser.add_argument("--plan",type=Path,required=True);args=parser.parse_args()
    root=args.root;plan=json.loads(args.plan.read_text());receipt=json.loads((root/"receipt.json").read_text())
    assert root.is_absolute() and not root.is_symlink() and root.stat().st_uid==os.getuid() and not root.stat().st_mode&0o077
    software=receipt["software"]
    os.environ["HOME"]=str(root/"home");os.environ["HERMES_HOME"]=str(root);os.environ["HERMES_RUNTIME_DIR"]=software["runtimeRoot"];os.environ["PYTHONDONTWRITEBYTECODE"]="1"
    sys.path.insert(0,software["source"])
    from hermes_cli.profiles import create_profile
    profile=root/"profiles/hub-guide"
    if not profile.exists():
        profile=create_profile("hub-guide",no_alias=True,no_skills=True,description="Dedicated guide for this Zenith Hub",soul="You are the Zenith Hub guide. Help the owner set up and understand this Hub. Explain observed status honestly. Ask before making consequential changes. Never claim an action succeeded without evidence.")
    else:
        assert not profile.is_symlink() and (profile/".zenith-guide.json").is_file(),"profile_exists_without_hub_identity"
    for p in profile.rglob("*"):
        if not p.is_symlink():p.chmod(0o700 if p.is_dir() else 0o600)
    profile.chmod(0o700)
    template=plan["guideBinding"].get("template")
    import hermes_yaml as yaml
    selection={}
    if template:
        source=Path(template["home"])/"config.yaml"
        assert source.is_file() and not source.is_symlink() and source.stat().st_size<1048576
        model=(yaml.safe_load(source.read_text()) or {}).get("model",{})
        if isinstance(model,dict):
            public={k:model[k] for k in ("provider","default","base_url","context_length") if k in model and isinstance(model[k],(str,int))}
            if public.get("base_url"):
                from urllib.parse import urlsplit
                url=urlsplit(public["base_url"]);assert url.scheme in ("http","https") and not url.username and not url.password and not url.query and not url.fragment,"profile_model_endpoint_contains_credentials"
            if public:
                config=yaml.safe_load((profile/"config.yaml").read_text()) or {};config["model"]=public
                (profile/"config.yaml").write_text(yaml.safe_dump(config));(profile/"config.yaml").chmod(0o600)
                selection={"providerId":public.get("provider"),"modelName":public.get("default"),"modelEndpoint":public.get("base_url","").removesuffix("/v1"),"contextLength":public.get("context_length")}
                selection={k:v for k,v in selection.items() if v is not None and v!=""}
    identity={"name":"hub-guide","home":str(profile),"role":"hub-guide","template":template.get("name") if template else None}
    save(profile/".zenith-guide.json",{"schema":"zenith.hermes-guide-profile.v1","instanceId":plan["instanceId"]})
    save(root/"receipt.json",{**receipt,"profile":identity})
    print(json.dumps({"profile":identity,"backend":selection}))
if __name__=="__main__":main()

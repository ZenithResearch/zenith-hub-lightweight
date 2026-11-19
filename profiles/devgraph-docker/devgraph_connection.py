"""Read-only API adapter for an isolated Docker Devgraph."""
import json,os,pathlib,re,stat
from urllib import request,error
from urllib.parse import urlsplit

class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def private_json(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600:
            raise ValueError("Unsafe resource registry")
        raw=os.read(fd,65537)
        if len(raw)>65536:raise ValueError("Oversize resource registry")
    finally:os.close(fd)
    value=json.loads(raw)
    if not isinstance(value,dict) or set(value)!={"schema","revision","resources"} or value["schema"]!="zenith.hub-resources.v1" or type(value["revision"]) is not int or not 1<=value["revision"]<=9007199254740991 or not isinstance(value["resources"],list) or len(value["resources"])>8:
        raise ValueError("Invalid resource registry")
    ids=set()
    for item in value["resources"]:
        if not isinstance(item,dict) or set(item)!={"id","kind","label","endpoint","credentialFile","lifecycle","enabled"}:
            raise ValueError("Invalid resource binding")
        if not isinstance(item["id"],str) or re.fullmatch(r"[a-z][a-z0-9-]{0,63}",item["id"]) is None or item["id"] in ids or item["kind"]!="devgraph" or not isinstance(item["label"],str) or not item["label"].strip() or len(item["label"])>80 or any(ord(c)<32 for c in item["label"]) or item["lifecycle"]!="external" or type(item["enabled"]) is not bool or not isinstance(item["credentialFile"],str) or not pathlib.Path(item["credentialFile"]).is_absolute():
            raise ValueError("Invalid resource binding")
        if not isinstance(item["endpoint"],str):raise ValueError("Invalid resource endpoint")
        url=urlsplit(item["endpoint"])
        if url.scheme!="http" or url.hostname!="127.0.0.1" or not url.port or item["endpoint"]!="http://127.0.0.1:"+str(url.port):
            raise ValueError("Invalid existing resource origin")
        ids.add(item["id"])
    return value

class RegisteredConnection:
    """Reload a registered binding on each poll; disabling it stops future API polls."""
    def __init__(self,config,resource_id,*,enabled=True,timeout=15,opener=None):
        self.path=pathlib.Path(config);self.resource_id=resource_id
        self.enabled=enabled;self.timeout=timeout;self.opener=opener
    def status(self):
        result={"connected":False,"readOnly":True,"writeAuthority":"not_configured","work":None,
                "state":"not_configured","resourceId":self.resource_id,"lifecycle":"external"}
        if not self.enabled:return result
        try:
            config=private_json(self.path)
            item=next((v for v in config["resources"] if v["id"]==self.resource_id),None)
            if item is None:return dict(result,state="resource_not_registered")
            public={"resourceId":item["id"],"label":item["label"],"endpoint":item["endpoint"],"lifecycle":"external"}
            if not item["enabled"]:return dict(result,**public,state="disconnected")
            value=Connection(enabled=True,endpoint=item["endpoint"],credential_file=item["credentialFile"],timeout=self.timeout,opener=self.opener).status()
            return dict(value,**public)
        except (OSError,ValueError,TypeError,KeyError,OverflowError):return dict(result,state="resource_configuration_unavailable")

class Connection:
    def __init__(self,*,enabled=None,endpoint='http://devgraph:8080',credential_file='/run/devgraph-reader/devgraph.read',opener=None,timeout=3):
        self.enabled=os.environ.get('ZENITH_DEVGRAPH_ENABLED')=='1' if enabled is None else enabled
        url=urlsplit(endpoint)
        if url.scheme!='http' or url.hostname not in {'devgraph','127.0.0.1'} or url.username or url.password or url.path or url.query or url.fragment or not url.port:
            raise ValueError('Expected a private Devgraph API origin')
        if type(timeout) not in (int,float) or not .1<=timeout<=15:raise ValueError("Invalid bounded reader timeout")
        self.timeout=timeout
        self.endpoint=endpoint;self.path=pathlib.Path(credential_file)
        self.opener=opener or request.build_opener(request.ProxyHandler({}),NoRedirect())
    def credential(self):
        fd=os.open(self.path,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600:raise ValueError('Unsafe read credential')
            raw=os.read(fd,128)
        finally:os.close(fd)
        token=raw.decode('ascii').strip()
        if re.fullmatch(r'dgread1_[A-Za-z0-9_-]{43}',token) is None:raise ValueError('Invalid read credential')
        return token
    def read(self,path,token=None):
        headers={'Accept':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        with self.opener.open(request.Request(self.endpoint+path,headers=headers),timeout=self.timeout) as response:
            raw=response.read(1_048_577)
            if len(raw)>1_048_576:raise ValueError('Oversize API response')
            return json.loads(raw)
    def status(self):
        result={'connected':False,'readOnly':True,'writeAuthority':'not_configured','work':None,'state':'not_configured'}
        if not self.enabled:return result
        try:
            token=self.credential()
        except (OSError,UnicodeError,ValueError):return dict(result,state='credential_unavailable')
        try:
            health=self.read('/ready')
            if health.get('ready') is not True:return dict(result,state='not_ready')
            work={}
            for kind in ('Initiative','Project','Issue','Task','Proposal'):
                page=self.read('/work/'+kind+'?limit=20',token)
                if not isinstance(page,dict) or not isinstance(page.get('items'),list) or len(page['items'])>20 or any(not isinstance(item,dict) for item in page['items']):raise ValueError('Incompatible Work page')
                work[kind]=page['items']
            return dict(result,connected=True,state='connected',work=work)
        except error.HTTPError as exc:
            return dict(result,state={401:'authentication_failed',403:'access_denied',503:'not_ready'}.get(exc.code,'api_rejected'))
        except (ValueError,TypeError,AttributeError):return dict(result,state='incompatible_contract')
        except (OSError,TimeoutError):return dict(result,state='unavailable')

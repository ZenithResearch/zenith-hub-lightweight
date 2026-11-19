"""Read-only API adapter for an isolated Docker Devgraph."""
import json,os,pathlib,re,stat
from urllib import request,error
from urllib.parse import urlsplit

class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

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

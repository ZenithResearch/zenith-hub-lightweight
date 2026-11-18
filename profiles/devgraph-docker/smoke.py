"""Verify the isolated API, real read capability and default-deny Work writes."""
import json,pathlib,urllib.error,urllib.request
from devgraph.ontology import ontology_sources
assert ontology_sources()['closureVerified']
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
origin='http://127.0.0.1:8080'
def call(path,token=None,body=None):
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(origin+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
        with opener.open(req,timeout=8) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:return error.code,json.load(error)
assert call('/ready')[1]['ready']
assert call('/work/Task')[0]==401
credential=pathlib.Path('/state/devgraph/credentials/devgraph.read').read_text().strip()
status,result=call('/work/Task?limit=10',credential)
assert status==200 and result['items']==[],(status,result)
status,_=call('/work/Task',credential,{'id':'must-not-exist','title':'Read authority cannot create this'})
assert status==403,status
assert call('/work/Task?limit=10',credential)[1]['items']==[]
print('Verified persistent Devgraph readiness, normalized ontology, authenticated reads and write denial; no Work data inserted')

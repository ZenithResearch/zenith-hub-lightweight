import {HubRepository} from '../../../src/lib/objects/repository.mjs';
const [root,point]=process.argv.slice(2);let armed=false;
const repo=await HubRepository.open({dataDir:root,fault:p=>{if(armed&&p===point)process.kill(process.pid,'SIGKILL');}});armed=true;
await repo.importDocument({'@id':'urn:process-crash','@type':'https://zenith-research.ca/ontology/terms/Artifact'},{importKey:'process-crash'});
throw Error('expected crash point was not reached');

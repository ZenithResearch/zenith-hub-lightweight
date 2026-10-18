import {DeployerPage} from "@/components/hub/DeployerPage";
import {WorkspacePage} from "@/components/hub/WorkspacePage";
export const dynamic="force-dynamic";
export default function Home(){return process.env.ZENITH_PROCESS_PROFILE === "workspace" ? <WorkspacePage/> : <DeployerPage/>}

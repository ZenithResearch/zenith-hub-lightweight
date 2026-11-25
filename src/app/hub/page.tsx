import type {Metadata} from "next";
import {redirect} from "next/navigation";
import {MainHubPage} from "@/components/hub/MainHubPage";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Zenith Hub",description:"Work from your connected apps, with Hermes available throughout."};
export default async function Hub({searchParams}:{searchParams:Promise<{matrix?:string|string[]}>}){
 const {matrix}=await searchParams;
 if(typeof matrix==="string"&&matrix)redirect("/settings?matrix="+encodeURIComponent(matrix));
 return <MainHubPage/>;
}

"use client";
import {createContext,useContext,useMemo,useState,type ReactNode} from "react";
const WorkspaceState=createContext<{selectedConversationKey:string|null;selectConversation:(key:string)=>void}|null>(null);
/** In-memory UI selection survives navigation; no credentials or new persisted store. */
export function HubWorkspaceState({children}:{children:ReactNode}){
 const [selectedConversationKey,selectConversation]=useState<string|null>(null);
 const value=useMemo(()=>({selectedConversationKey,selectConversation}),[selectedConversationKey]);
 return <WorkspaceState.Provider value={value}>{children}</WorkspaceState.Provider>;
}
export function useHubWorkspaceState(){
 const value=useContext(WorkspaceState);
 if(!value)throw Error("Hub workspace state is unavailable");
 return value;
}

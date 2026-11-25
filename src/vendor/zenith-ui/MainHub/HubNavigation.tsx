"use client";
import type {AnchorHTMLAttributes,MouseEvent} from "react";
export type HubNavigate=(href:string)=>void;
export function HubNavigationLink({href,onNavigate,onClick,...props}:Omit<AnchorHTMLAttributes<HTMLAnchorElement>,"href">&{href:string;onNavigate?:HubNavigate}){
 function click(event:MouseEvent<HTMLAnchorElement>){
  onClick?.(event);
  if(!event.defaultPrevented&&onNavigate&&href.startsWith("/")&&!href.startsWith("//")&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&(!props.target||props.target==="_self")){
   event.preventDefault();onNavigate(href);
  }
 }
 return <a {...props} href={href} onClick={click}/>;
}

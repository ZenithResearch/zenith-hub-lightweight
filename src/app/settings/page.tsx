import type {Metadata} from "next";
import {HubSettingsPage} from "@/components/hub/YourHubPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Settings & configuration | Zenith Hub",
  description: "Apps, service connections and Hub configuration.",
};

export default function Settings(){return <HubSettingsPage/>;}

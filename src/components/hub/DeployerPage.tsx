"use client";
import { useEffect, useState } from "react";
import {
  DeploymentMonitor,
  type DeploymentItem,
} from "@/vendor/zenith-ui/DeploymentMonitor/DeploymentMonitor";
type Status = {
  installed: boolean;
  authority: string;
  pilot_ready: boolean;
  external_effects: boolean;
  actor_count: number | null;
  pilot?: { setup: string; cleanup_unresolved: boolean; workflow: {
    observed_at: number | null; run_state: string; recoverable: boolean; export_available: boolean;
  } | null } | null;
  components: { name: string; live: boolean | null; ready: boolean | null }[];
};
type Snapshot = {
  schema: string;
  mode: string;
  reason?: string;
  csrf?: string;
  profile: string;
  target?: string;
  release_digest?: string | null;
  status?: Status | null;
  actions?: string[];
};
type Plan = {
  id: string;
  action: string;
  target: string;
  detail: string;
  release_digest: string | null;
  configuration_digest?: string | null;
};
export function DeployerPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [plan, setPlan] = useState<Plan | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("Reading the local controller…");
  async function refresh() {
    const r = await fetch("/api/deployer", { cache: "no-store" });
    const v = await r.json();
    if (!r.ok) throw Error(v.error || "operator_unavailable");
    if (
      v.schema !== "zenith.deployer.v1" ||
      !["disabled", "local"].includes(v.mode) ||
      (v.mode === "local" &&
        (typeof v.csrf !== "string" ||
          typeof v.target !== "string" ||
          !Array.isArray(v.actions) ||
          (v.status !== null &&
            (!v.status || !Array.isArray(v.status.components)))))
    )
      throw Error("unsupported_controller");
    setSnapshot(v);
    return v as Snapshot;
  }
  useEffect(() => {
    let active = true;
    refresh()
      .then((v) => {
        if (active)
          setMessage(
            v.mode === "disabled"
              ? v.reason || "Local operator disabled."
              : "Connected. Installation health is separate from production readiness.",
          );
      })
      .catch(() => {
        if (active)
          setMessage(
            "The local operator is unavailable. Check its configuration and run doctor.",
          );
      });
    const poll = setInterval(() => {
      if (active && !document.hidden)
        refresh().catch(() => {
          if (active)
            setMessage(
              "Status refresh failed. Check the local controller. Deployed processes may still be running.",
            );
        });
    }, 15000);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, []);
  async function action(id: string) {
    if (id === "cancel") {
      setPlan(null);
      return;
    }
    setBusy(true);
    if (id === "apply")
      setMessage(`Applying ${plan?.action || "reviewed action"}…`);
    try {
      if (id === "refresh") {
        await refresh();
        setMessage("Status refreshed.");
        return;
      }
      const body =
        id === "apply"
          ? {
              schema: "zenith.deployer-action.v1",
              operation: "apply",
              plan_id: plan?.id,
            }
          : {
              schema: "zenith.deployer-action.v1",
              operation: "plan",
              action: id,
            };
      const r = await fetch("/api/deployer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Zenith-CSRF": snapshot?.csrf || "",
        },
        body: JSON.stringify(body),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error || "action_rejected");
      if (
        v.schema === "zenith.deployer-plan.v1" &&
        v.plan &&
        typeof v.plan.id === "string" &&
        ["install", "doctor", "start", "stop", "pilot-setup", "pilot-initialize", "pilot-next",
          "pilot-inspect", "pilot-resume", "pilot-renew", "pilot-export"].includes(v.plan.action) &&
        typeof v.plan.target === "string" &&
        typeof v.plan.detail === "string"
      ) {
        setPlan(v.plan);
        setMessage("Review the destination and action below.");
      } else if (
        v.schema === "zenith.deployer-result.v1" &&
        v.applied === true
      ) {
        setPlan(null);
        await refresh();
        setMessage(
          `${v.action} completed. Authority and provider readiness remain independently checked.`,
        );
      } else {
        throw Error("unsupported_controller_response");
      }
    } catch (e) {
      setPlan(null);
      setMessage(e instanceof Error ? e.message : "Action unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const s = snapshot?.status;
  const known = snapshot?.mode === "local";
  const pilot = snapshot?.profile === "local-review-v1";
  const items: DeploymentItem[] = ["service", "runtime"].map((name) => {
    const c = s?.components?.find((c) => c.name === name);
    return {
      name: name === "service" ? "Service Management" : "Process Runtime",
      detail:
        name === "service"
          ? "Requests, Cases and approved plans."
          : "Processes, runs, steps and committed outputs.",
      state: c?.ready ? "ready" : c?.live ? "blocked" : "unknown",
      label: c?.ready
        ? "Ready"
        : c?.live
          ? "Live · not ready"
          : c?.live === false
            ? "Stopped"
            : s?.installed === false
              ? "Not installed"
              : "Not observed",
    };
  });
  items.push({
    name: "Frank",
    detail: pilot ? "Runs the selected local-review process; authority is checked for each request."
      : "Executes eligible work through configured provider adapters.",
    state: s?.actor_count ? "pending" : "unknown",
    label: pilot ? s?.pilot?.cleanup_unresolved ? "Cleanup unresolved"
      : s?.pilot?.setup === "configured" ? "Configured · bounded actions" : "Setup pending"
      : s?.actor_count === 0 ? "No enabled actors" : "Not qualified",
  });
  const checkpoints: DeploymentItem[] = [
    {
      name: "Install this Mac",
      detail: "One pinned bundle; private component data.",
      state: s?.installed ? "ready" : "pending",
      label: s?.installed ? "Installed" : "Pending",
    },
    {
      name: "Connect native authority",
      detail: "Wallet custody, scoped permissions and receiver verification.",
      state: pilot && s?.pilot?.setup === "configured" ? "ready" : "blocked",
      label: pilot ? s?.pilot?.setup === "configured" ? "Configured · checked per request"
        : s?.pilot?.setup === "partial" ? "Partial setup retained" : "Pending"
        : s?.authority === "pending" ? "Pending" : "Not qualified",
    },
    ...(!pilot ? [{
      name: "Connect Matrix intake",
      detail: "Frank intake submits an authorized ServiceRequest.",
      state: "pending",
      label: "Not connected",
    } satisfies DeploymentItem] : []),
    {
      name: pilot ? "Run the selected local review" : "Run the first useful workflow",
      detail: pilot ? s?.pilot?.workflow?.observed_at
        ? `Runtime observed ${new Date(s.pilot.workflow.observed_at).toLocaleString()}; external effects stay disabled.`
        : "Initialize the selected inputs, run eligible steps and export committed Markdown."
        : "Enable a qualified provider and verify committed results.",
      state: pilot && s?.pilot?.workflow?.export_available ? "ready" : "pending",
      label: pilot ? s?.pilot?.workflow?.run_state ? `Observed: ${s.pilot.workflow.run_state}` : "No Runtime observation"
        : s?.external_effects ? "Review readiness" : "Effects disabled",
    },
  ];
  return (
    <DeploymentMonitor
      title="Your local environment"
      subtitle={pilot ? "One owner-selected local review on this Mac. External effects stay disabled."
        : "Set up one Mac to receive requests and execute approved work."}
      profile={pilot ? "Local review · Apple silicon" : "Process pilot · Apple silicon"}
      connection={known ? "Local controller" : "Controller not connected"}
      items={items}
      checkpoints={checkpoints}
      actions={[
        { id: "refresh", label: "Refresh status" },
        {
          id: "doctor",
          label: "Run doctor",
          disabled: !snapshot?.actions?.includes("doctor"),
        },
        {
          id: "install",
          label: pilot ? "Install local-review stack" : "Install base stack",
          disabled: !snapshot?.actions?.includes("install"),
        },
        {
          id: "start",
          label: "Start",
          disabled: !snapshot?.actions?.includes("start"),
        },
        {
          id: "stop",
          label: "Stop",
          disabled: !snapshot?.actions?.includes("stop"),
        },
        ...(pilot ? [
          {id:"pilot-setup", label:"Set up native identity"},
          {id:"pilot-initialize", label:"Initialize selected review"},
          {id:"pilot-next", label:"Run next eligible step"},
          {id:"pilot-inspect", label:"Inspect selected review"},
          {id:"pilot-resume", label:"Resume retained work"},
          {id:"pilot-renew", label:"Renew retained attestation"},
          {id:"pilot-export", label:"Export committed Markdown"},
        ].map((a) => ({...a,disabled:!snapshot?.actions?.includes(a.id)})) : []),
      ]}
      onAction={action}
      busy={busy}
      message={message}
      review={
        plan
          ? {
              title: `Review ${plan.action}`,
              detail: plan.detail,
              destination: plan.target,
              digest:
                plan.configuration_digest || plan.release_digest ||
                "Existing installed release; doctor checks its pins.",
            }
          : undefined
      }
    />
  );
}

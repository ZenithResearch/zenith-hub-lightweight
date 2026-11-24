import { PAGE_CONTENT_LIMIT, type PageContext } from "./chat-message.mjs";

const omitted = [
  "script", "style", "template", "noscript", "svg", "canvas", "iframe",
  "input", "textarea", "[role='textbox']", "[contenteditable]:not([contenteditable='false'])",
  "nextjs-portal", ".zn-hermes-hud",
  "[data-zenith-hermes-portal]", "[data-zenith-guide-host]",
  ".zn-welcome__signin", ".zn-model-picker__signin",
  "[data-hermes-context='exclude']", "#codex-browser-sidebar-comments-root",
].join(",");

function visible(element: Element, view: Window) {
  if (element.matches(omitted) || element.hasAttribute("hidden") ||
      element.getAttribute("aria-hidden") === "true" || element.hasAttribute("inert"))
    return false;
  const style = view.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" ||
      style.visibility === "collapse" || style.opacity === "0" ||
      style.contentVisibility === "hidden") return false;
  if (style.display !== "contents" && element.getClientRects().length === 0) return false;
  const box = element.getBoundingClientRect();
  if (box.width <= 1 && box.height <= 1 &&
      (style.overflow === "hidden" || style.clipPath !== "none")) return false;
  return true;
}

/** Snapshot the approved visible page scope at send time; never read entry values. */
export function capturePageContext(doc: Document = document): PageContext | null {
  const view = doc.defaultView;
  if (!view || !doc.body) return null;
  try {
    const dialogs = [...doc.querySelectorAll("dialog[open], [role='dialog'][aria-modal='true']")]
      .filter(element => visible(element, view));
    const root = dialogs.at(-1) || doc.querySelector("main") || doc.body;
    const lines: string[] = [];
    let length = 0;
    let truncated = false;
    const push = (value: string) => {
      const line = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
      if (!line || lines.at(-1) === line) return;
      const separator = lines.length ? 1 : 0;
      const remaining = PAGE_CONTENT_LIMIT - length - separator;
      if (line.length > remaining) {
        if (remaining > 0) lines.push(line.slice(0, remaining));
        truncated = true;
        return;
      }
      lines.push(line);
      length += separator + line.length;
    };
    const walk = (node: Node) => {
      if (truncated) return;
      if (node.nodeType === 3) { push(node.textContent || ""); return; }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (!visible(element, view)) return;
      if (element.tagName === "SELECT") {
        const label = element.getAttribute("aria-label");
        if (label) push(label);
        for (const option of (element as HTMLSelectElement).selectedOptions)
          push("Selected: " + option.label);
        return;
      }
      if (element.tagName === "DETAILS" && !(element as HTMLDetailsElement).open) {
        const summary = element.querySelector("summary");
        if (summary) walk(summary);
        return;
      }
      for (const child of element.childNodes) walk(child);
    };
    walk(root);
    const text = lines.join("\n") + (truncated ? "\n[Page content truncated]" : "");
    return { title: doc.title, path: doc.location?.pathname || "", text };
  } catch {
    // A transient or unavailable page must not prevent a normal message.
    return null;
  }
}

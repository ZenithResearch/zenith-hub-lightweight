import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Transpile the pure presentation source in memory; CSS has no server-rendering effect.
async function renderWorkspace(plan) {
    const source = await readFile(new URL("../../src/vendor/zenith-ui/WorkspaceConsole/WorkspaceConsole.tsx", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
    const module = { exports: {} }, require = createRequire(import.meta.url);
    new Function("require", "module", "exports", compiled.outputText)(name => name.endsWith(".css") ? {} : require(name), module, module.exports);
    return renderToStaticMarkup(React.createElement(module.exports.WorkspaceConsole, { snapshot: null, plan, busy: false, message: "", ids: [], catalogRead: false, catalogComplete: false, cursor: null, processId: "", selected: null, draftText: "", dirty: false, versionId: "", resumeId: "", validation: null, allowed: () => false }));
}

test("setup review renders command permission and machine identity expiries separately", async () => {
    const html = await renderWorkspace({ id: "review", action: "workspace-setup", target: "/Process-Workspace", expected_version: null, request_id: null, payload_sha256: null, configuration_digest: "a".repeat(64), payload: {}, expires_at: 60000, setup: { not_before: "1780000000", not_after: "1780003600", identity_not_after: "1811536000", scope: "Fixed authoring/read scope" } });
    assert.match(html, /<dt>Command permission window \(Unix seconds\)<\/dt><dd>1780000000 → 1780003600; at most one hour<\/dd>/);
    assert.match(html, /<dt>Machine identity key expires \(Unix seconds\)<\/dt><dd>1811536000<\/dd>/);
    assert.doesNotMatch(html, /Native identity window/);
    assert.match(html, /No automatic renewal or key rotation/);
    assert.match(html, /You control revocation/);
});

test("ordinary command review does not invent a machine lifetime", async () => {
    const html = await renderWorkspace({ id: "review", action: "draft-put", target: "/Process-Workspace", expected_version: null, request_id: "request-1", payload_sha256: "b".repeat(64), configuration_digest: "a".repeat(64), payload: {}, expires_at: 60000, setup: null });
    assert.doesNotMatch(html, /Command permission window|Machine identity key expires/);
});

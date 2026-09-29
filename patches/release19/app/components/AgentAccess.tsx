import { useFetcher } from "react-router";
/**
 * Release 15: mint a short-lived link that opens RankPilot outside the Shopify frame for bulk work.
 * Release 17: links work once, access can be switched off, and every session can be revoked.
 */
export function AgentAccess({ enabled = true }: { enabled?: boolean }) {
  const f = useFetcher<{ ok: boolean; message: string; url?: string }>();
  const manage = useFetcher<{ ok: boolean; message: string }>();
  const creating = f.state !== "idle";
  return (
    <section className="card" id="agent-workspace">
      <h2>Agent workspace</h2>
      <p>Open RankPilot in its own tab so an assistant can read findings and apply reviewed bulk updates. Every change is logged, verified in Shopify and can be undone in Results &amp; history.</p>
      <p>Each link opens once and expires after 15 minutes; the session it starts lasts up to 2 hours.</p>
      {enabled ? (
        <f.Form method="post">
          <input type="hidden" name="intent" value="agentLink" />
          <button type="submit" disabled={creating} aria-busy={creating}>{creating ? "Creating link… this can take a few seconds" : "Create agent workspace link"}</button>
        </f.Form>
      ) : (
        <p role="status">Agent access is off. Switch it on below to create a link.</p>
      )}
      {creating && <p role="status" className="notice">Creating a secure link…</p>}
      {f.data?.url && !creating && (
        <p role="status" className="notice">
          {f.data.message} <a href={f.data.url} target="_blank" rel="noreferrer noopener">Open agent workspace ↗</a>
        </p>
      )}
      {f.data && !f.data.ok && <p role="alert">{f.data.message}</p>}
      <details>
        <summary>Manage agent access</summary>
        <manage.Form method="post">
          <input type="hidden" name="intent" value="agentToggle" />
          <label><input type="checkbox" name="enabled" defaultChecked={enabled} /> Allow agent workspace links for this store</label>{" "}
          <button type="submit" disabled={manage.state !== "idle"}>Save</button>
        </manage.Form>
        <manage.Form method="post" onSubmit={(e) => { if (!window.confirm("Sign out every agent session and cancel unused links?")) e.preventDefault(); }}>
          <input type="hidden" name="intent" value="agentRevoke" />
          <button type="submit" disabled={manage.state !== "idle"}>Revoke all agent sessions</button>
        </manage.Form>
        {manage.data?.message && <p role="status">{manage.data.message}</p>}
      </details>
    </section>
  );
}

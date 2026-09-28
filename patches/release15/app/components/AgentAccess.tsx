import { useFetcher } from "react-router";
/** Release 15: mint a short-lived link that opens RankPilot outside the Shopify frame for bulk work. */
export function AgentAccess() {
  const f = useFetcher<{ ok: boolean; message: string; url?: string }>();
  return (
    <section className="card" id="agent-workspace">
      <h2>Agent workspace</h2>
      <p>Open RankPilot in its own tab so an assistant can read findings and apply reviewed bulk updates. Every change is logged, verified in Shopify and can be undone in Results &amp; history.</p>
      <f.Form method="post">
        <input type="hidden" name="intent" value="agentLink" />
        <button type="submit" disabled={f.state !== "idle"}>{f.state !== "idle" ? "Creating link…" : "Create agent workspace link"}</button>
      </f.Form>
      {f.data?.url && (
        <p role="status">
          {f.data.message} <a href={f.data.url} target="_blank" rel="noreferrer noopener">Open agent workspace ↗</a>
        </p>
      )}
      {f.data && !f.data.ok && <p role="alert">{f.data.message}</p>}
    </section>
  );
}

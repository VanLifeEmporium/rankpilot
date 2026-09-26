import {useEffect,useSyncExternalStore} from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  const ready=useSyncExternalStore(()=>()=>{},()=>true,()=>false);
  useEffect(()=>{document.documentElement.dataset.rankpilotReady="true";},[]);
  return (
    <html lang="en-GB">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <title>RankPilot | Van Life Emporium</title>
        <Meta />
        <Links />
      </head>
      <body>
        {!ready && <div className="client-startup" role="status">Starting RankPilot controls… If this message stays here, <a href="/app">reload the app</a>. No update has been sent.</div>}
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

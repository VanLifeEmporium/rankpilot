import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Outlet, useLoaderData, isRouteErrorResponse, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { context } from "../core/context.server";
import "../styles.css";
import {actionUI} from "../core/ui.server";
export const action = ({request}: ActionFunctionArgs) => actionUI(request);
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { store } = await context(request);
  return { demo: store.demo, apiKey: process.env.SHOPIFY_API_KEY || "" };
};
export default function App() {
  const { demo, apiKey } = useLoaderData<typeof loader>();
  const content = (
    <>
      {!demo && (
        <s-app-nav>
          {[
            "Dashboard", "Products", "Collections", "Content", "Reports", "Settings",
          ].map((t) => (
            <s-link
              key={t}
              href={t === "Dashboard" ? "/app" : `/app/${t.toLowerCase()}`}
            >
              {({Dashboard:"Dashboard",Audit:"Find issues",Reviews:"Review & apply",Content:"Blog drafts",AEO:"Help AI answer questions",Reports:"Results & history"} as Record<string,string>)[t] || t}
            </s-link>
          ))}
        </s-app-nav>
      )}
      <Outlet />
    </>
  );
  return demo ? (
    <AppProvider embedded={false}>{content}</AppProvider>
  ) : (
    <AppProvider embedded apiKey={apiKey}>
      {content}
    </AppProvider>
  );
}
// Release 19: Shopify responses keep Shopify's handling; anything else shows a plain message, not a blank page.
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) return boundary.error(error);
  return (
    <div className="card" role="alert" style={{ margin: 24 }}>
      <h1>Something went wrong on this page</h1>
      <p>Your saved changes are safe; nothing was sent to Shopify from this screen. Reload the page to try again. If it keeps happening, open another section and come back.</p>
      <p><a className="button" href="/app">Back to the dashboard</a></p>
    </div>
  );
}
export const headers: HeadersFunction = (args) => boundary.headers(args);

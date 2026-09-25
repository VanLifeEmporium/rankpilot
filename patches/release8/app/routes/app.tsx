import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { context } from "../core/context.server";
import "../styles.css";
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
            "Dashboard", "Reports", "Settings",
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
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => boundary.headers(args);

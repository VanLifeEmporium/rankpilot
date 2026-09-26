import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import Workspace from "../components/Workspace";
import { loadUI, actionUI } from "../core/ui.server";
export const loader = ({ request, params }: LoaderFunctionArgs) => {
 const section=params.section;const url=new URL(request.url);
 if(section==='blogs'||section==='articles')return redirect('/app/content'+url.search);
 if(section && !['dashboard','audit','reviews','products','collections','content','aeo','reports','settings'].includes(section))throw new Response('This RankPilot page does not exist.',{status:404});
 return loadUI(request);
};
export const action = ({ request }: ActionFunctionArgs) => actionUI(request);
export default function WorkspaceRoute() {
  const { section } = useParams();
  return <Workspace key={section || "dashboard"} />;
}

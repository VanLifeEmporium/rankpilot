import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import Workspace from "../components/Workspace";
import { loadUI, actionUI } from "../core/ui.server";
export const loader = ({ request }: LoaderFunctionArgs) => loadUI(request);
export const action = ({ request }: ActionFunctionArgs) => actionUI(request);
export default function WorkspaceRoute() {
  const { section } = useParams();
  return <Workspace key={section || "dashboard"} />;
}

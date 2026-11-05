import { RequireSession } from "../_components/requireSession";
import KanbanPage from "./board";
import "./kanban.css";

export default async function KanbanRoute() {
    return (
        <RequireSession>
            <KanbanPage />
        </RequireSession>
    );
}

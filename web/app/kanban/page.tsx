import { RequireSession } from "../_components/requireSession";
import KanbanPage from "./board";
import "./board.css";

export default async function KanbanRoute() {
    return (
        <RequireSession>
            <KanbanPage />
        </RequireSession>
    );
}

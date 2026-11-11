import Link from "next/link";
import { RequireSession } from "../_components/requireSession";
import { listProjects } from "../_lib/kanbanRepo";
import { createServerTranslator, getLocale } from "../_lib/i18n";
import "./projects.css";

/**
 * Project picker: `/kanban` lists every project and links to its board at
 * `/kanban/<public id>` (the cyphered project id, see app/_lib/idConversion).
 */
export default async function KanbanRoute() {
    return <RequireSession>{(session) => <ProjectList ownerId={session.sub ?? ""} />}</RequireSession>;
}

/** Only the signed-in user's own projects — see `app/_lib/kanbanRepo.ts`. */
async function ProjectList({ ownerId }: { ownerId: string }) {
    const projects = await listProjects(ownerId);
    const locale = await getLocale();
    const { t } = createServerTranslator(locale, "kanban");

    return (
        <div className="main-container">
            <div className="projects">
                <h1>{t("projectsHeading")}</h1>
                <p className="projects-intro">{t("projectsIntro")}</p>

                {projects.length === 0 ? (
                    <p className="projects-empty">{t("projectsEmpty")}</p>
                ) : (
                    <ul className="project-list">
                        {projects.map((project) => (
                            <li key={project.publicId}>
                                <Link className="project-row" href={`/kanban/${project.publicId}`}>
                                    <span className="project-icon" aria-hidden="true">
                                        {project.unicodeIcon ?? initials(project.name)}
                                    </span>

                                    <span className="project-body">
                                        <span className="project-name">
                                            {project.name}
                                            {project.archived && (
                                                <span className="project-archived">{t("archived")}</span>
                                            )}
                                        </span>
                                        {project.description && (
                                            <span className="project-desc">{project.description}</span>
                                        )}
                                    </span>

                                    <span className="project-meta">
                                        {t("columnCount", { count: project.columnCount })}
                                        <span aria-hidden="true"> · </span>
                                        {t("issueCount", { count: project.issueCount })}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

/** Fallback tile glyph for projects without a unicode icon. */
function initials(name: string): string {
    const letters = name
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
    return letters || "P";
}

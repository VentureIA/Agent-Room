export function buildHumanSummary(state) {
    const projectNames = state.projects.map((project) => project.name).join(" et ") || "les projets";
    const openQuestions = state.questions.filter((question) => question.status === "open");
    const blockers = openQuestions.filter((question) => question.urgency === "blocking");
    const pendingDecisions = state.decisions.filter((decision) => decision.status === "proposed");
    const pendingAccessRequests = state.accessRequests.filter((request) => request.status === "pending");
    const activeFileAlerts = state.fileAlerts.filter((alert) => alert.status === "active");
    const activeContracts = state.contracts.filter((contract) => contract.status === "active");
    const lines = [
        `AgentRoom relie ${projectNames}.`,
        "",
        `Etat actuel: ${state.projects.length} projet(s), ${openQuestions.length} question(s) ouverte(s), ${pendingDecisions.length} decision(s) a valider, ${pendingAccessRequests.length} demande(s) d'acces, ${activeFileAlerts.length} alerte(s) fichier, ${activeContracts.length} contrat(s) actif(s).`
    ];
    if (blockers.length > 0) {
        lines.push("", "Points bloquants:");
        for (const blocker of blockers) {
            lines.push(`- ${blocker.topic}: ${blocker.question}`);
        }
    }
    if (pendingDecisions.length > 0) {
        lines.push("", "Decisions a valider:");
        for (const decision of pendingDecisions) {
            lines.push(`- ${decision.title}: ${decision.reason}`);
        }
    }
    if (pendingAccessRequests.length > 0) {
        lines.push("", "Demandes d'acces a valider:");
        for (const request of pendingAccessRequests) {
            lines.push(`- ${request.path}: ${request.reason}`);
        }
    }
    if (activeFileAlerts.length > 0) {
        lines.push("", "Alertes fichiers:");
        for (const alert of activeFileAlerts) {
            lines.push(`- ${alert.path}: ${alert.reason}`);
        }
    }
    if (state.contracts.length === 0) {
        lines.push("", "Aucun contrat partage n'est encore publie. Les agents devraient documenter les endpoints, schemas ou webhooks critiques.");
    }
    return lines.join("\n");
}
//# sourceMappingURL=summary.js.map
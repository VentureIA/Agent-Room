export function buildHumanSummary(state) {
    const projectNames = state.projects.map((project) => project.name).join(" et ") || "les projets";
    const openQuestions = state.questions.filter((question) => question.status === "open");
    const blockers = openQuestions.filter((question) => question.urgency === "blocking");
    const pendingDecisions = state.decisions.filter((decision) => decision.status === "proposed");
    const activeContracts = state.contracts.filter((contract) => contract.status === "active");
    const lines = [
        `AgentRoom relie ${projectNames}.`,
        "",
        `Etat actuel: ${state.projects.length} projet(s), ${openQuestions.length} question(s) ouverte(s), ${pendingDecisions.length} decision(s) a valider, ${activeContracts.length} contrat(s) actif(s).`
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
    if (state.contracts.length === 0) {
        lines.push("", "Aucun contrat partage n'est encore publie. Les agents devraient documenter les endpoints, schemas ou webhooks critiques.");
    }
    return lines.join("\n");
}
//# sourceMappingURL=summary.js.map
export async function processInboxAutonomously(store, options = {}) {
    const currentProject = await store.getCurrentProject();
    const state = await store.getState();
    const questions = state.questions
        .filter((question) => question.status === "open" && question.toProjectId === currentProject.id)
        .slice(0, options.maxQuestions ?? 5);
    const result = { project: currentProject, answered: [], skipped: [] };
    for (const question of questions) {
        const draft = await draftAnswer(store, question, currentProject, options.maxFiles ?? 30);
        if (!draft) {
            result.skipped.push({
                questionId: question.id,
                reason: "No reliable evidence found in files visible by current AgentRoom permissions."
            });
            continue;
        }
        const answered = await store.answerQuestionForProject(currentProject.id, {
            questionId: question.id,
            answer: draft.answer,
            suggestedResolution: draft.suggestedResolution,
            confidence: draft.confidence
        });
        result.answered.push({
            questionId: answered.id,
            answer: draft.answer,
            confidence: draft.confidence,
            evidenceFiles: [...new Set(draft.evidence.map((item) => item.file))]
        });
    }
    return result;
}
async function draftAnswer(store, question, project, maxFiles) {
    const visibleFiles = await store.listVisibleFiles();
    const terms = extractTerms(question);
    const rankedFiles = rankFiles(visibleFiles, terms).slice(0, maxFiles);
    const evidence = [];
    for (const file of rankedFiles) {
        try {
            const content = await store.readAllowedProjectFile(file);
            evidence.push(...extractEvidence(file, content, terms));
        }
        catch {
            continue;
        }
    }
    const bestEvidence = evidence.slice(0, 8);
    if (bestEvidence.length === 0)
        return undefined;
    if (isFieldSpecificNullabilityQuestionWithoutFieldEvidence(question, bestEvidence))
        return undefined;
    const nullability = inferNullability(question, bestEvidence);
    const evidenceText = bestEvidence.map((item) => `- ${item.file}:${item.line} ${item.text}`).join("\n");
    const answerLead = nullability ?? `I found related evidence in ${project.name}'s visible files.`;
    return {
        answer: `${answerLead}\n\nEvidence:\n${evidenceText}`,
        suggestedResolution: nullability
            ? "Update the consuming project contract/importer to match the provider schema and keep a fallback for legacy content."
            : "Use the cited provider files as the current source of truth, or ask a more specific follow-up if this does not settle the integration.",
        confidence: nullability ? "high" : "medium",
        evidence: bestEvidence
    };
}
function extractTerms(question) {
    const raw = `${question.topic} ${question.question}`;
    const terms = raw
        .split(/[^A-Za-z0-9_]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3);
    const topicParts = question.topic.split(/[.:/\\]+/).filter(Boolean);
    return [...new Set([...topicParts, ...terms])];
}
function rankFiles(files, terms) {
    return files
        .map((file) => ({
        file,
        score: terms.reduce((sum, term) => sum + countOccurrences(file, term) * 4, 0) +
            (/\.(ts|tsx|js|jsx|json|md|graphql|ya?ml|php)$/i.test(file) ? 1 : 0)
    }))
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
        .map((entry) => entry.file);
}
function extractEvidence(file, content, terms) {
    const lines = content.slice(0, 80_000).split(/\r?\n/);
    const evidence = [];
    lines.forEach((line, index) => {
        if (evidence.length >= 4)
            return;
        const normalized = line.trim();
        if (!normalized)
            return;
        const score = terms.reduce((sum, term) => sum + countOccurrences(normalized, term), 0);
        if (score > 0)
            evidence.push({ file, line: index + 1, text: normalized.slice(0, 220) });
    });
    return evidence;
}
function isFieldSpecificNullabilityQuestionWithoutFieldEvidence(question, evidence) {
    if (!/\b(null|nullable|optional|required|missing|omit|empty)\b/i.test(`${question.topic} ${question.question}`)) {
        return false;
    }
    const field = question.topic.split(/[.:/\\]+/).filter(Boolean).at(-1);
    if (!field)
        return false;
    return !evidence.some((item) => item.text.toLowerCase().includes(field.toLowerCase()));
}
function inferNullability(question, evidence) {
    if (!/\b(null|nullable|optional|required|missing|omit|empty)\b/i.test(`${question.topic} ${question.question}`)) {
        return undefined;
    }
    const field = question.topic.split(/[.:/\\]+/).filter(Boolean).at(-1);
    const related = evidence.filter((item) => !field || item.text.toLowerCase().includes(field.toLowerCase()));
    if (field && related.length === 0)
        return undefined;
    const source = related.length > 0 ? related : evidence;
    const joined = source.map((item) => item.text).join("\n");
    if (/\b(null|nullable|optional|omitted|missing)\b|\?\s*:|\|\s*null|:\s*null\b/i.test(joined)) {
        return `Yes. Based on ${source[0]?.file}, ${field ?? "this field"} can be null or omitted in the provider data.`;
    }
    if (/\b(non-null|required|required:\s*true)\b|!\s*$/i.test(joined)) {
        return `No. Based on ${source[0]?.file}, ${field ?? "this field"} appears to be required by the provider data.`;
    }
    return undefined;
}
function countOccurrences(value, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return value.match(new RegExp(escaped, "gi"))?.length ?? 0;
}
//# sourceMappingURL=autonomous.js.map
import { stat } from "node:fs/promises";
import type { AccessRequest, Project, Question } from "./types.js";
import { AgentRoomStore } from "./storage.js";

export type ProcessInboxOptions = {
  maxQuestions?: number;
  maxFiles?: number;
};

export type ProcessInboxResult = {
  project: Project;
  answered: Array<{
    questionId: string;
    answer: string;
    confidence: "low" | "medium" | "high";
    evidenceFiles: string[];
  }>;
  skipped: Array<{
    questionId: string;
    reason: string;
    accessRequest?: AccessRequest;
  }>;
};

export type DirectQuestionResolution =
  | {
      status: "answered";
      questionId: string;
      answer: string;
      confidence: "low" | "medium" | "high";
      evidenceFiles: string[];
      source: "local-project" | "remote-snapshot";
    }
  | {
      status: "pending";
      questionId: string;
      reason: string;
      source: "local-project" | "remote-project" | "unavailable-project";
    };

type Evidence = {
  file: string;
  line: number;
  text: string;
};

export type EvidenceReader = {
  listVisibleFiles(): Promise<string[]>;
  readAllowedProjectFile(relativePath: string): Promise<string>;
};

export async function processInboxAutonomously(
  store: AgentRoomStore,
  options: ProcessInboxOptions = {}
): Promise<ProcessInboxResult> {
  const currentProject = await store.getCurrentProject();
  const state = await store.getState();
  const questions = state.questions
    .filter((question) => question.status === "open" && question.toProjectId === currentProject.id)
    .slice(0, options.maxQuestions ?? 5);

  const result: ProcessInboxResult = { project: currentProject, answered: [], skipped: [] };
  for (const question of questions) {
    const draft = await draftAnswerFromEvidence(store, question, currentProject, options.maxFiles ?? 30);
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

export async function resolveQuestionForLocalProject(
  store: AgentRoomStore,
  question: Question,
  toProject: Project,
  options: ProcessInboxOptions = {}
): Promise<DirectQuestionResolution> {
  if (toProject.path.startsWith("remote://")) {
    return {
      status: "pending",
      questionId: question.id,
      reason: `${toProject.name} is registered as a remote project, so this machine cannot inspect its files directly.`,
      source: "remote-project"
    };
  }

  if (!(await isReadableDirectory(toProject.path))) {
    return {
      status: "pending",
      questionId: question.id,
      reason: `${toProject.name} is not readable from this machine at ${toProject.path}. The question remains in that project's inbox.`,
      source: "unavailable-project"
    };
  }

  const targetStore = new AgentRoomStore(toProject.path, { roomDir: store.roomDir });
  try {
    const result = await processInboxAutonomously(targetStore, {
      maxQuestions: Math.max(options.maxQuestions ?? 5, 10),
      maxFiles: options.maxFiles ?? 50
    });
    const answered = result.answered.find((item) => item.questionId === question.id);
    if (answered) {
      return {
        status: "answered",
        questionId: question.id,
        answer: answered.answer,
        confidence: answered.confidence,
        evidenceFiles: answered.evidenceFiles,
        source: "local-project"
      };
    }

    const skipped = result.skipped.find((item) => item.questionId === question.id);
    return {
      status: "pending",
      questionId: question.id,
      reason: skipped?.reason ?? `${toProject.name} did not produce an evidence-backed answer yet.`,
      source: "local-project"
    };
  } finally {
    targetStore.close();
  }
}

export async function draftAnswerFromEvidence(
  reader: EvidenceReader,
  question: Question,
  project: Project,
  maxFiles: number
): Promise<{ answer: string; suggestedResolution: string; confidence: "medium" | "high"; evidence: Evidence[] } | undefined> {
  const visibleFiles = await reader.listVisibleFiles();
  const terms = extractTerms(question);
  const isSummaryQuestion = isProjectSummaryQuestion(question);
  const rankedFiles = rankFiles(visibleFiles, terms, isSummaryQuestion).slice(0, maxFiles);
  const evidence: Evidence[] = [];

  for (const file of rankedFiles) {
    try {
      const content = await reader.readAllowedProjectFile(file);
      evidence.push(...extractEvidence(file, content, terms, isSummaryQuestion && isUsefulProjectSummaryFile(file)));
    } catch {
      continue;
    }
  }

  const bestEvidence = evidence.slice(0, 8);
  if (isSummaryQuestion) return draftProjectSummaryAnswer(question, project, bestEvidence);
  if (bestEvidence.length === 0) return undefined;
  if (isFieldSpecificNullabilityQuestionWithoutFieldEvidence(question, bestEvidence)) return undefined;

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

function extractTerms(question: Question): string[] {
  const raw = `${question.topic} ${question.question}`;
  const terms = raw
    .split(/[^\p{L}\p{N}_]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
  const topicParts = question.topic.split(/[.:/\\]+/).filter(Boolean);
  return [...new Set([...topicParts, ...terms])];
}

function rankFiles(files: string[], terms: string[], preferProjectSummaryFiles = false): string[] {
  const ranked = files
    .map((file) => ({
      file,
      score:
        terms.reduce((sum, term) => sum + countOccurrences(file, term) * 4, 0) +
        (/\.(ts|tsx|js|jsx|json|md|graphql|ya?ml|php)$/i.test(file) ? 1 : 0) +
        (preferProjectSummaryFiles && isUsefulProjectSummaryFile(file) ? 20 : 0)
    }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .map((entry) => entry.file);
  return preferProjectSummaryFiles ? moveUsefulSummaryFilesFirst(ranked) : ranked;
}

function extractEvidence(file: string, content: string, terms: string[], includeOverviewLines = false): Evidence[] {
  const lines = content.slice(0, 80_000).split(/\r?\n/);
  const evidence: Evidence[] = [];
  lines.forEach((line, index) => {
    if (evidence.length >= 4) return;
    const normalized = line.trim();
    if (!normalized) return;
    const score = terms.reduce((sum, term) => sum + countOccurrences(normalized, term), 0);
    if (score > 0) evidence.push({ file, line: index + 1, text: normalized.slice(0, 220) });
    else if (includeOverviewLines && isUsefulOverviewLine(normalized)) {
      evidence.push({ file, line: index + 1, text: normalized.slice(0, 220) });
    }
  });
  return evidence;
}

function isFieldSpecificNullabilityQuestionWithoutFieldEvidence(question: Question, evidence: Evidence[]): boolean {
  if (!/\b(null|nullable|optional|required|missing|omit|empty)\b/i.test(`${question.topic} ${question.question}`)) {
    return false;
  }
  const field = question.topic.split(/[.:/\\]+/).filter(Boolean).at(-1);
  if (!field) return false;
  return !evidence.some((item) => item.text.toLowerCase().includes(field.toLowerCase()));
}

function inferNullability(question: Question, evidence: Evidence[]): string | undefined {
  if (!/\b(null|nullable|optional|required|missing|omit|empty)\b/i.test(`${question.topic} ${question.question}`)) {
    return undefined;
  }

  const field = question.topic.split(/[.:/\\]+/).filter(Boolean).at(-1);
  const related = evidence.filter((item) => !field || item.text.toLowerCase().includes(field.toLowerCase()));
  if (field && related.length === 0) return undefined;
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

function draftProjectSummaryAnswer(
  _question: Question,
  project: Project,
  evidence: Evidence[]
): { answer: string; suggestedResolution: string; confidence: "medium" | "high"; evidence: Evidence[] } | undefined {
  const evidenceText = evidence.slice(0, 8).map((item) => `- ${item.file}:${item.line} ${item.text}`).join("\n");
  const stack = project.stack.length > 0 ? project.stack.join(", ") : "unknown";
  const summary = [
    `${project.name} is registered in AgentRoom as: ${project.role}.`,
    `Known stack: ${stack}.`,
    evidenceText ? `Visible evidence:\n${evidenceText}` : "No visible README/package evidence was found, so this answer is based on the AgentRoom project card only."
  ].join("\n\n");

  return {
    answer: summary,
    suggestedResolution:
      "Use this as the immediate coordination summary. Ask a more specific follow-up for endpoints, schemas, webhooks, or implementation details.",
    confidence: evidence.length > 0 ? "high" : "medium",
    evidence
  };
}

function isProjectSummaryQuestion(question: Question): boolean {
  return /\b(summary|summarize|summarise|purpose|overview|architecture|features?|stack|objective|resume|resumer|résumé|résumer|objectif|fonctionnalités?|a quoi sert|à quoi sert)\b/i.test(
    `${question.topic} ${question.question}`
  );
}

function isUsefulProjectSummaryFile(file: string): boolean {
  return /(^|\/)(agentroom\/project-card\.md|readme\.md|package\.json|composer\.json|openapi\.ya?ml|schema\.graphql|docs\/[^/]+\.md)$/i.test(file);
}

function moveUsefulSummaryFilesFirst(files: string[]): string[] {
  return [
    ...files.filter(isUsefulProjectSummaryFile),
    ...files.filter((file) => !isUsefulProjectSummaryFile(file))
  ];
}

function isUsefulOverviewLine(line: string): boolean {
  if (line.length < 8) return false;
  if (/^(#|name|description|dependencies|scripts)\b/i.test(line)) return true;
  return /^[A-Z0-9].*[.?!:]?$/.test(line);
}

async function isReadableDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

function countOccurrences(value: string, term: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.match(new RegExp(escaped, "gi"))?.length ?? 0;
}

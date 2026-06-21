import type { Project } from "./types.js";

export function renderProjectCard(project: Project): string {
  return `# Project Card

Name: ${project.name}
Role: ${project.role}
Stack: ${project.stack.length > 0 ? project.stack.join(", ") : "Unknown"}

Provides:
- Project summary
- Visible documentation and contracts

Expects:
- Structured questions from connected projects
- Human approval before sensitive decisions

Primary agent:
- ${project.agentKind}

Human owner:
- ${project.humanOwner}
`;
}

export function defaultPermissionsMarkdown(): string {
  return `# agentroom.permissions.md

## Visible
- README.md
- docs/**
- src/api/**
- src/types/**
- tests/fixtures/**
- wordpress/acf-json/**
- package.json
- composer.json
- schema.graphql
- openapi.yaml

## Ask First
- src/auth/**
- src/database/migrations/**
- config/**

## Hidden
- .env*
- secrets/**
- private/**
- src/billing/**
- .git/**
- node_modules/**
- vendor/**
- dist/**
- build/**

## Always Redact
- API keys
- tokens
- passwords
- private keys
- customer data
`;
}

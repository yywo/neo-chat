import { TASK_PLAN_LIMITS } from "@/config/limits";

export type TaskPlanStepStatus = "pending" | "in_progress" | "completed";

export interface TaskPlanStep {
  title: string;
  status: TaskPlanStepStatus;
}

export interface TaskPlanSnapshot {
  steps: TaskPlanStep[];
  note?: string;
}

export interface TaskPlanParseError {
  code: "INVALID_TASK_PLAN";
  message: string;
}

export type TaskPlanParseResult =
  | { ok: true; plan: TaskPlanSnapshot }
  | { ok: false; error: TaskPlanParseError };

const VALID_STATUSES = new Set<TaskPlanStepStatus>([
  "pending",
  "in_progress",
  "completed",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const invalidTaskPlan = (message: string): TaskPlanParseResult => ({
  ok: false,
  error: {
    code: "INVALID_TASK_PLAN",
    message,
  },
});

export function parseTaskPlan(value: unknown): TaskPlanParseResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ["steps", "note"])) {
    return invalidTaskPlan("Task plan must contain only steps and note.");
  }
  if (
    !Array.isArray(value.steps) ||
    value.steps.length === 0 ||
    value.steps.length > TASK_PLAN_LIMITS.maxSteps
  ) {
    return invalidTaskPlan(
      `Task plan must contain 1-${TASK_PLAN_LIMITS.maxSteps} steps.`,
    );
  }

  const steps: TaskPlanStep[] = [];
  for (const item of value.steps) {
    if (!isRecord(item) || !hasOnlyKeys(item, ["title", "status"])) {
      return invalidTaskPlan(
        "Each task plan step must contain only title and status.",
      );
    }

    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title || title.length > TASK_PLAN_LIMITS.maxTitleChars) {
      return invalidTaskPlan(
        `Each task plan title must be 1-${TASK_PLAN_LIMITS.maxTitleChars} characters.`,
      );
    }
    if (
      typeof item.status !== "string" ||
      !VALID_STATUSES.has(item.status as TaskPlanStepStatus)
    ) {
      return invalidTaskPlan(
        "Task plan status must be pending, in_progress, or completed.",
      );
    }

    steps.push({
      title,
      status: item.status as TaskPlanStepStatus,
    });
  }

  if (value.note !== undefined && typeof value.note !== "string") {
    return invalidTaskPlan("Task plan note must be a string.");
  }
  const note = typeof value.note === "string" ? value.note.trim() : "";
  if (note.length > TASK_PLAN_LIMITS.maxNoteChars) {
    return invalidTaskPlan(
      `Task plan note must not exceed ${TASK_PLAN_LIMITS.maxNoteChars} characters.`,
    );
  }

  return {
    ok: true,
    plan: {
      steps,
      ...(note ? { note } : {}),
    },
  };
}

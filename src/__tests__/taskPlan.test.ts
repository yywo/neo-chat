import { describe, expect, it } from "vitest";
import { TASK_PLAN_LIMITS } from "../config/limits";
import { parseTaskPlan } from "../lib/agent/taskPlan";

describe("task plan parsing", () => {
  it("trims and clones a valid plan snapshot", () => {
    const input = {
      steps: [
        { title: "  Inspect context  ", status: "completed" },
        { title: "Implement UI", status: "in_progress" },
      ],
      note: "  Keep the change focused.  ",
    };

    const result = parseTaskPlan(input);

    expect(result).toEqual({
      ok: true,
      plan: {
        steps: [
          { title: "Inspect context", status: "completed" },
          { title: "Implement UI", status: "in_progress" },
        ],
        note: "Keep the change focused.",
      },
    });
    expect(input.steps[0]?.title).toBe("  Inspect context  ");
    if (result.ok) {
      result.plan.steps[0]!.title = "Changed";
    }
    expect(input.steps[0]?.title).toBe("  Inspect context  ");
  });

  it.each([
    ["an empty step list", { steps: [] }],
    [
      "too many steps",
      {
        steps: Array.from(
          { length: TASK_PLAN_LIMITS.maxSteps + 1 },
          (_, index) => ({ title: `Step ${index}`, status: "pending" }),
        ),
      },
    ],
    [
      "an oversized title",
      {
        steps: [
          {
            title: "x".repeat(TASK_PLAN_LIMITS.maxTitleChars + 1),
            status: "pending",
          },
        ],
      },
    ],
    ["an invalid status", { steps: [{ title: "Step", status: "running" }] }],
    [
      "an oversized note",
      {
        steps: [{ title: "Step", status: "pending" }],
        note: "x".repeat(TASK_PLAN_LIMITS.maxNoteChars + 1),
      },
    ],
    [
      "an unknown plan field",
      {
        steps: [{ title: "Step", status: "pending" }],
        extra: true,
      },
    ],
    [
      "an unknown step field",
      {
        steps: [{ title: "Step", status: "pending", extra: true }],
      },
    ],
  ])("returns a structured error for %s", (_label, input) => {
    expect(parseTaskPlan(input)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_TASK_PLAN",
        message: expect.any(String),
      },
    });
  });
});

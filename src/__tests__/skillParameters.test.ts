import { describe, expect, it } from "vitest";
import {
  buildSkillPromptContext,
  createSkillInvocations,
  getMissingSkillParameters,
  normalizeSkillBundles,
  normalizeTextSkill,
  renderSkillTemplate,
  resolveSkillParameterValues,
  resolveSkillBundle,
  SkillParameterValidationError,
} from "../lib/skills";

const baseSkill = {
  id: "brief-writer",
  name: "brief-writer",
  title: "Brief writer",
  description: "Writes a focused brief.",
  category: "writing",
  tags: [],
  audience: "user-facing",
  language: "en",
  outputFormat: "markdown",
  risk: {
    level: "low",
    textOnly: true,
    scriptRequired: false,
    externalToolRequired: false,
    networkRequired: false,
    reviewRequiredForHighStakes: true,
  },
  activation: {
    embeddingText: "brief",
    useWhen: [],
    avoidWhen: [],
    exampleQueries: [],
  },
  content: "Write for {{audience}} in a {{tone}} tone.",
  parameters: [
    {
      key: "audience",
      label: "Audience",
      input: "text",
      required: true,
      maxLength: 80,
    },
    {
      key: "tone",
      label: "Tone",
      input: "select",
      defaultValue: "concise",
      options: [
        { value: "concise", label: "Concise" },
        { value: "warm", label: "Warm" },
      ],
      maxLength: 20,
    },
  ],
};

describe("parameterized skills", () => {
  it("normalizes v2 parameters and renders escaped values", () => {
    const skill = normalizeTextSkill(baseSkill);
    expect(skill?.parameters).toHaveLength(2);
    expect(
      renderSkillTemplate(skill!, {
        audience: "R&D <team>",
        tone: "warm",
      }),
    ).toBe("Write for R&amp;D &lt;team&gt; in a warm tone.");
  });

  it("reports missing required values and rejects unknown slots", () => {
    const skill = normalizeTextSkill(baseSkill)!;
    expect(getMissingSkillParameters(skill)).toHaveLength(1);
    expect(() => renderSkillTemplate(skill)).toThrow(
      SkillParameterValidationError,
    );

    expect(() =>
      renderSkillTemplate({
        ...skill,
        content: "Unknown: {{missing}}",
        parameters: [],
      }),
    ).toThrow(/Unknown skill parameter slot/);
  });

  it("resolves defaults and enforces option and length contracts", () => {
    const skill = normalizeTextSkill(baseSkill)!;
    expect(
      resolveSkillParameterValues(skill, { audience: "operators" }),
    ).toEqual({
      audience: "operators",
      tone: "concise",
    });
    expect(() =>
      resolveSkillParameterValues(skill, {
        audience: "operators",
        tone: "verbose",
      }),
    ).toThrow(/Invalid option/);
    expect(() =>
      resolveSkillParameterValues(skill, {
        audience: "x".repeat(81),
      }),
    ).toThrow(/exceeds 80 characters/);
  });

  it("expands an ordered non-nested bundle and records reproducible metadata", () => {
    const skill = normalizeTextSkill(baseSkill)!;
    const bundle = normalizeSkillBundles([
      {
        id: "launch-brief",
        title: "Launch brief",
        description: "Prepare a launch brief.",
        parameters: [
          {
            key: "reader",
            label: "Reader",
            input: "text",
            required: true,
            maxLength: 80,
          },
        ],
        steps: [
          {
            id: "draft",
            skillId: skill.id,
            bindings: {
              audience: { type: "bundle", parameterKey: "reader" },
              tone: { type: "literal", value: "concise" },
            },
          },
        ],
      },
    ])[0];

    const applied = resolveSkillBundle({
      bundle,
      skills: [skill],
      values: { reader: "operators" },
    });
    expect(buildSkillPromptContext({ skills: applied })).toContain(
      "Write for operators in a concise tone.",
    );
    expect(createSkillInvocations(applied)[0]).toMatchObject({
      schemaVersion: 2,
      order: 0,
      bundleId: "launch-brief",
      parameters: { audience: "operators", tone: "concise" },
    });
    expect(createSkillInvocations(applied)[0].definitionHash).toMatch(
      /^fnv1a-/,
    );
  });
});

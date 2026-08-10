"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { SkillParameterDefinition } from "@/types";
import { Button, Dialog, Field, Input } from "@/components/ui/primitives";

export interface SkillParameterRequest {
  key: string;
  title: string;
  description?: string;
  parameters: SkillParameterDefinition[];
}

export type SkillParameterSubmission = Record<string, Record<string, string>>;

export interface ComposerSkillParameterValues {
  skillParameterValues: Record<string, Record<string, string>>;
  skillBundleParameterValues: Record<string, Record<string, string>>;
}

interface SkillParameterDialogProps {
  open: boolean;
  requests: SkillParameterRequest[];
  initialValues?: SkillParameterSubmission;
  onCancel: () => void;
  onSubmit: (values: SkillParameterSubmission) => void;
}

function createInitialValues(
  requests: readonly SkillParameterRequest[],
  existing: SkillParameterSubmission = {},
): SkillParameterSubmission {
  return Object.fromEntries(
    requests.map((request) => [
      request.key,
      Object.fromEntries(
        request.parameters.map((parameter) => [
          parameter.key,
          existing[request.key]?.[parameter.key] ??
            parameter.defaultValue ??
            "",
        ]),
      ),
    ]),
  );
}

export default function SkillParameterDialog({
  open,
  requests,
  initialValues,
  onCancel,
  onSubmit,
}: SkillParameterDialogProps) {
  const t = useTranslations("Skill.parameters.runtime");
  const initial = useMemo(
    () => createInitialValues(requests, initialValues),
    [initialValues, requests],
  );
  const [values, setValues] = useState<SkillParameterSubmission>(initial);

  useEffect(() => {
    if (open) setValues(initial);
  }, [initial, open]);

  const setValue = (requestKey: string, parameterKey: string, value: string) =>
    setValues((current) => ({
      ...current,
      [requestKey]: {
        ...current[requestKey],
        [parameterKey]: value,
      },
    }));

  return (
    <Dialog open={open} onClose={onCancel} title={t("title")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
        className="flex max-h-[min(640px,80vh)] flex-col"
      >
        <p className="border-b border-border px-4 py-3 text-sm leading-6 text-muted-foreground">
          {t("description")}
        </p>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 custom-scrollbar">
          {requests.map((request) => (
            <fieldset
              key={request.key}
              className="space-y-4 rounded-xl border border-border bg-muted/20 p-4"
            >
              <legend className="px-1 text-sm font-semibold text-foreground">
                {request.title}
              </legend>
              {request.description ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {request.description}
                </p>
              ) : null}
              {request.parameters.map((parameter) => {
                const id = `${request.key}-${parameter.key}`.replace(
                  /[^a-zA-Z0-9_-]/g,
                  "-",
                );
                const common = {
                  id,
                  name: id,
                  required: Boolean(parameter.required),
                  maxLength: parameter.maxLength,
                  value: values[request.key]?.[parameter.key] || "",
                  onChange: (
                    event: React.ChangeEvent<
                      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
                    >,
                  ) => setValue(request.key, parameter.key, event.target.value),
                };

                return (
                  <Field
                    key={parameter.key}
                    htmlFor={id}
                    label={
                      <>
                        {parameter.label}
                        {parameter.required ? (
                          <span
                            className="ml-1 text-red-500"
                            aria-hidden="true"
                          >
                            *
                          </span>
                        ) : null}
                      </>
                    }
                    description={parameter.description}
                  >
                    {parameter.input === "textarea" ? (
                      <textarea
                        {...common}
                        rows={4}
                        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    ) : parameter.input === "select" ? (
                      <select
                        {...common}
                        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">{t("selectPlaceholder")}</option>
                        {(parameter.options || []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input {...common} />
                    )}
                    <p className="text-right text-[11px] text-muted-foreground">
                      {(values[request.key]?.[parameter.key] || "").length}/
                      {parameter.maxLength}
                    </p>
                  </Field>
                );
              })}
            </fieldset>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {t("continue")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

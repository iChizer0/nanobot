import { useEffect, useId, useState } from "react";

import { Input } from "@/components/ui/input";

import { choicePillClass as pillClass } from "./ChoiceChips";
import { FieldHelp } from "./FieldHelp";
import { formatBytes, type VoiceChoice } from "./form";

/**
 * A `weights` field: the store keys the validator found for this engine (from the cached
 * index, for this host's platform, plus whatever is installed) as pills that carry each
 * key's state, and a Custom pill. Custom either takes any other key in an input (the
 * default) or, for a block whose model is a file of your own (`custom: "files"`), clears
 * the key (`null`, so a saved one is withdrawn too) and the validator then lists the
 * path input. A choice with an empty value is a tier without a key (the wake word's
 * Transcript); it too clears the key, and `customOpen` says which keyless state is in
 * force. A choice with `builds` is one model in several builds: the pill picks its
 * default build, a second row under the pills (Build) picks another. Every pick also
 * writes the keys its `sets` names. Above the help, the selected model's license line
 * (`licenseText`): what the index says it is licensed under, and the notice Apply has
 * you accept. The pick is written like every other edit; downloading is Apply's job.
 */
export function WeightsPicker({
  label,
  help,
  choices,
  value,
  disabled,
  customLabel,
  custom = "key",
  customOpen: customOpenByServer,
  sets,
  buildLabel,
  installedLabel,
  licenseText,
  onChange,
}: {
  label: string;
  help?: string;
  choices: VoiceChoice[];
  value: string;
  disabled?: boolean;
  customLabel: string;
  custom?: "key" | "files";
  customOpen?: boolean;
  sets?: Record<string, unknown>;
  buildLabel: string;
  installedLabel: string;
  licenseText: (choice: VoiceChoice) => string;
  onChange: (value: string | null | undefined, sets?: Record<string, unknown>) => void;
}) {
  const id = useId();
  const holds = (choice: VoiceChoice) => choice.value === value || Boolean(choice.builds?.some((build) => build.value === value));
  const listed = choices.some(holds);
  // A configured key the index does not list (hand-fetched, another host's platform, a
  // pasted config) is still what the block runs, and the files kind has no input to show
  // it in: it takes a pill of its own rather than leaving the row reading as unset.
  const pills = !listed && value && custom === "files" ? [...choices, { value, label: value }] : choices;
  // The key input, once opened, stays until a pill is picked; a keyless Custom pick shows
  // at once and the validator's next form (a new `customOpen`) takes over.
  const [pick, setPick] = useState<boolean | null>(null);
  useEffect(() => setPick(null), [customOpenByServer]);
  const customChecked = custom === "key"
    ? (pick ?? false) || (Boolean(value) && !listed)
    : !value && (pick ?? Boolean(customOpenByServer));
  const keyOpen = custom === "key" && customChecked;
  const selected = keyOpen ? undefined : choices.find(holds);
  // What the pill and the license line describe: the build in force, else the choice itself.
  const active = selected?.builds?.find((build) => build.value === value) ?? selected;
  const secondary = (choice: VoiceChoice) => [
    choice.langs?.join(", "),
    choice.installed ? installedLabel : choice.bytes ? formatBytes(choice.bytes) : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-x-4">
      <span id={`${id}-label`} className="flex min-h-10 items-center text-[11px] font-medium text-foreground/85 sm:min-h-9">
        {label}
      </span>
      <div className="min-w-0">
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5 py-1">
          {pills.map((choice) => (
            <label key={choice.value} className="relative block">
              <input
                type="radio"
                name={id}
                value={choice.value}
                checked={!customChecked && holds(choice)}
                disabled={disabled}
                onChange={() => {
                  setPick(false);
                  onChange(choice.value || null, choice.sets);
                }}
                className="peer sr-only"
              />
              <span className={pillClass}>
                {choice.label}
                <span className="ms-1.5 font-normal text-muted-foreground/80">
                  {secondary(holds(choice) && active ? active : choice)}
                </span>
              </span>
            </label>
          ))}
          <label className="relative block">
            <input
              type="radio"
              name={id}
              value=""
              checked={customChecked}
              disabled={disabled}
              onChange={() => {
                setPick(true);
                if (custom === "files") onChange(null, sets);
              }}
              className="peer sr-only"
            />
            <span className={pillClass}>{customLabel}</span>
          </label>
        </div>
        {selected?.builds ? (
          <div role="radiogroup" aria-label={`${label}: ${buildLabel}`} className="flex flex-wrap items-center gap-1.5 py-1">
            <span className="text-[11px] text-muted-foreground">{buildLabel}</span>
            {selected.builds.map((build) => (
              <label key={build.value} className="relative block">
                <input
                  type="radio"
                  name={`${id}-build`}
                  value={build.value}
                  checked={value === build.value}
                  disabled={disabled}
                  onChange={() => onChange(build.value, selected.sets)}
                  className="peer sr-only"
                />
                <span className={pillClass}>
                  {build.label}
                  <span className="ms-1.5 font-normal text-muted-foreground/80">{secondary(build)}</span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
        {keyOpen ? (
          <Input
            aria-label={`${label}: ${customLabel}`}
            value={value}
            disabled={disabled}
            placeholder={choices.find((choice) => choice.value)?.value}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value.trim() || undefined, sets)}
            className="mt-1 h-10 border-border/40 bg-background font-mono text-base sm:h-9 sm:text-[12px]"
          />
        ) : null}
        {active && (active.license || active.notice) ? <FieldHelp text={licenseText(active)} /> : null}
        <FieldHelp text={help} />
      </div>
    </div>
  );
}

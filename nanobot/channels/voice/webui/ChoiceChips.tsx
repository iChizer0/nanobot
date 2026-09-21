import { useId } from "react";

import { cn } from "@/lib/utils";

import { FieldHelp } from "./FieldHelp";
import type { VoiceChoice } from "./form";

/**
 * A radio group that wraps: the shared segmented control gives every choice an equal
 * column, which clips once a row holds more than a few short words (the backend and
 * text-to-speech providers here). Same states as the segmented control, one pill each.
 */
export function ChoiceChips({
  label,
  help,
  choices,
  value,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  choices: VoiceChoice[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-x-4">
      <span id={`${id}-label`} className="flex min-h-10 items-center text-[11px] font-medium text-foreground/85 sm:min-h-9">
        {label}
      </span>
      <div className="min-w-0">
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5 py-1">
          {choices.map((choice) => (
            <label key={choice.value} className="relative block">
              <input
                type="radio"
                name={id}
                value={choice.value}
                checked={value === choice.value}
                disabled={disabled}
                onChange={() => onChange(choice.value)}
                className="peer sr-only"
              />
              <span className={choicePillClass}>{choice.label}</span>
            </label>
          ))}
        </div>
        <FieldHelp text={help} />
      </div>
    </div>
  );
}

export const choicePillClass = cn(
  "inline-flex min-h-8 cursor-pointer items-center rounded-full bg-muted px-3 text-[12px] font-medium text-muted-foreground transition-colors",
  "hover:text-foreground peer-checked:bg-background peer-checked:text-foreground peer-checked:shadow-sm peer-checked:ring-1 peer-checked:ring-inset peer-checked:ring-border/45",
  "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-default peer-disabled:opacity-60",
);

/** Whether a choice list outgrows the equal-column segmented control on a phone-width panel. */
export function wideChoices(choices: VoiceChoice[]): boolean {
  return choices.length > 3 || choices.map((choice) => choice.label).join("").length > 20;
}

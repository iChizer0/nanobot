import { useId } from "react";

import { Input } from "@/components/ui/input";

import { cn } from "@/lib/utils";

import { FieldHelp } from "./FieldHelp";

/**
 * A number in the panel's label/control grid, its unit (if any) at the input's end, so the
 * label stays the quantity ("Stall notice after") and the unit is never a guess. Every
 * number takes this row rather than the shared form's text input, for the unit.
 *
 * A text input, not `type="number"`: the browser sanitises a partly typed number ("-", "0.")
 * to "", which this controlled input would write back as the resolved value, so a minus or a
 * decimal point could not be typed at all. `inputMode` still asks for the numeric keypad,
 * except where the schema admits negatives: that keypad has no minus key.
 */
export function NumberRow({
  label,
  help,
  unit,
  decimal,
  signed,
  value,
  placeholder,
  disabled,
  onChange,
  onBlur,
}: {
  label: string;
  help?: string;
  unit?: string;
  /** A float: a keypad with a decimal point. */
  decimal?: boolean;
  /** The value may be negative, so no numeric keypad (none of them has a minus). */
  signed?: boolean;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (text: string) => void;
  onBlur?: () => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-x-4">
      <label htmlFor={id} className="flex min-h-10 items-center text-[11px] font-medium text-foreground/85 sm:min-h-9">
        {label}
      </label>
      <div className="min-w-0">
        <span className="relative block">
          <Input
            id={id}
            type="text"
            inputMode={signed ? "text" : decimal ? "decimal" : "numeric"}
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            className={cn(
              "h-10 rounded-full border-border/40 bg-background text-base sm:h-9 sm:text-[13px]",
              unit && "pe-12",
            )}
          />
          {unit ? (
            <span aria-hidden className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-[12px] text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </span>
        <FieldHelp text={help} />
      </div>
    </div>
  );
}

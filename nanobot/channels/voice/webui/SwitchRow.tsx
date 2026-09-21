import { useId } from "react";

import { ToggleButton } from "@/components/settings/ToggleButton";

import { FieldHelp } from "./FieldHelp";

/**
 * A boolean field as the switch the rest of Settings uses for one, in the panel's
 * label/control grid; an On/Off segmented control would give two words to a state that
 * a switch shows.
 */
export function SwitchRow({
  label,
  help,
  checked,
  disabled,
  stateLabel,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  stateLabel: string;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-x-4">
      <label htmlFor={id} className="flex min-h-10 items-center text-[11px] font-medium text-foreground/85 sm:min-h-9">
        {label}
      </label>
      <div className="min-w-0">
        <div className="flex min-h-10 items-center sm:min-h-9">
          <ToggleButton
            id={id}
            checked={checked}
            disabled={disabled}
            ariaLabel={label}
            label={stateLabel}
            onChange={onChange}
          />
        </div>
        <FieldHelp text={help} />
      </div>
    </div>
  );
}

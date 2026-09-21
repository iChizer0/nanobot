import type { ChannelConfigField } from "@/components/settings/channels/catalog";
import type { ChannelValidationPayload } from "@/lib/types";

export type VoiceChoice = {
  value: string;
  label: string;
  /** `weights` choices: a store key's state and what the index says about it. */
  installed?: boolean;
  bytes?: number;
  langs?: string[];
  license?: string;
  notice?: string;
  /** Other keys a pick writes with the value (an engine the choice implies, a phrase it hears). */
  sets?: Record<string, unknown>;
  /** `weights` choices: the same model's builds (CPU first, the device build last); the choice's own value is the default one. */
  builds?: VoiceChoice[];
};

/** One field of the validator's `form` spec: a camelCase config path with its schema kind. */
export type VoiceFormField = {
  key: string;
  kind: "string" | "secret" | "int" | "float" | "bool" | "enum" | "list" | "json" | "weights";
  label: string;
  help?: string;
  choices?: VoiceChoice[];
  /** `weights` fields: what Custom is — any other key typed in (the default), or a file of your own, which clears the key and the validator lists its path input. */
  custom?: "key" | "files";
  /** ...and, for the files kind, whether the block runs from that file now (no key, yet not the empty-value choice). */
  customOpen?: boolean;
  /** Keys a Custom pick writes with the key. */
  sets?: Record<string, unknown>;
  /** `int`/`float` fields: the unit the number is in, shown at the input's end. */
  unit?: string;
  /** `int`/`float` fields: the schema admits negatives (a dB), so the row takes no numeric keypad. */
  signed?: boolean;
  /** Shown in its section only while Advanced is open; a set value stays in force. */
  advanced?: boolean;
  /** The schema accepts null: an emptied input writes it (its own value, "Empty" in the help)
   * instead of withdrawing the edit. */
  optional?: boolean;
  value?: unknown;
  configured?: boolean;
};

export type VoiceFormSection = {
  id: string;
  label: string;
  fields: VoiceFormField[];
  /** Shown only while Advanced is open: a section the setup does not use (another
   * section's switch turns it off), or a niche one. */
  advanced?: boolean;
  /** Under the legend: what the section is not in use for, and the switch that would use it. */
  note?: string | null;
};

export type VoiceForm = { sections: VoiceFormSection[] };

export type VoiceValidationPayload = ChannelValidationPayload & { form?: VoiceForm };

export type VoicePatch = Record<string, unknown>;

export const PATCH_KEY = "channels.voice.importJson";

/** The patch's one directive: start from the defaults (the validator's, or the gateway's
 * `NANOBOT_VOICE_DEFAULTS`), the rest of the patch on top. What Reset writes. */
export const RESET_KEY = "$reset";

/** The patch as the settings API takes it: the manifest's one (json) field, always — an
 * emptied patch is `{}`, which withdraws the saved one, where sending nothing would leave
 * it in force and validate the section the user has just discarded. */
export function patchValues(patch: VoicePatch): Record<string, string> {
  return { [PATCH_KEY]: JSON.stringify(patch) };
}

export function parsePatch(text: string | undefined): VoicePatch {
  if (!text?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? sectionOf(parsed as VoicePatch)
      : {};
  } catch {
    return {};
  }
}

/** The `channels.voice` section of a pasted config file, read as the plugin reads a paste
 * (`parse_import_blob`): the wrappers off, the keys it drops dropped. A row edit writes a
 * top-level key, which the plugin's own unwrapping would else discard along with
 * everything else outside the wrapper. */
export function sectionOf(patch: VoicePatch): VoicePatch {
  let node = patch;
  const inner = (key: string): VoicePatch | undefined => {
    const child = node[key];
    return child && typeof child === "object" && !Array.isArray(child) ? (child as VoicePatch) : undefined;
  };
  node = inner("channels") ?? node;
  node = inner("voice") ?? node;
  const section = { ...node };
  for (const dropped of ["enabled", "importJson", "import_json"]) delete section[dropped];
  return section;
}

export function getPath(patch: VoicePatch, path: string): unknown {
  let node: unknown = patch;
  for (const segment of path.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** A new patch with `path` set (or removed when `value` is undefined); empty objects pruned. */
export function withPath(patch: VoicePatch, path: string, value: unknown): VoicePatch {
  const [head, ...rest] = path.split(".");
  const next: VoicePatch = { ...patch };
  if (!rest.length) {
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  const current = next[head];
  const child = withPath(
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as VoicePatch)
      : {},
    rest.join("."),
    value,
  );
  if (Object.keys(child).length) next[head] = child;
  else delete next[head];
  return next;
}

/** `patch` with every entry of `sets` written. */
export function withPaths(patch: VoicePatch, sets: Record<string, unknown> | undefined): VoicePatch {
  return Object.entries(sets ?? {}).reduce((next, [path, value]) => withPath(next, path, value), patch);
}

/** `patch` with an enum choice picked: the value, and the keys the choice's `sets` names. */
export function pick(patch: VoicePatch, field: VoiceFormField, value: string): VoicePatch {
  const choice = field.choices?.find((candidate) => candidate.value === value);
  return withPaths(withPath(patch, field.key, value), choice?.sets);
}

/** The input's text for a value of this kind. */
export function formatValue(field: VoiceFormField, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (field.kind === "list") return Array.isArray(value) ? value.map(String).join(", ") : String(value);
  if (field.kind === "bool") return value ? "true" : "false";
  if (field.kind === "json") return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return String(value);
}

/** `fields` as runs of consecutive rows sharing `advanced`, in order: the panel shades a run
 * of advanced rows as one block where it sits. */
export function runsOf(fields: VoiceFormField[]): { advanced: boolean; fields: VoiceFormField[] }[] {
  const runs: { advanced: boolean; fields: VoiceFormField[] }[] = [];
  for (const field of fields) {
    const advanced = Boolean(field.advanced);
    const last = runs.at(-1);
    if (last && last.advanced === advanced) last.fields.push(field);
    else runs.push({ advanced, fields: [field] });
  }
  return runs;
}

/**
 * The value to write for an input's text. Empty text is a value where the schema has one for
 * it — null for an optional field, no items for a list — and otherwise withdraws the edit
 * (`undefined`), the input then showing the resolved value again. A secret's input never shows
 * the saved key, so its empty is always a withdrawal.
 */
export function parseValue(field: VoiceFormField, text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    if (field.kind === "secret") return undefined;
    if (field.optional) return null;
    return field.kind === "list" ? [] : undefined;
  }
  switch (field.kind) {
    case "int": {
      const parsed = Number(trimmed);
      return Number.isInteger(parsed) ? parsed : text;
    }
    case "float": {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : text;
    }
    case "list":
      return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
    case "json":
      try {
        return JSON.parse(trimmed);
      } catch {
        return text;
      }
    default:
      return text;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

export function toConfigField(
  field: VoiceFormField,
  label: string,
  placeholder: string | undefined,
  choices: VoiceChoice[] | undefined,
): ChannelConfigField {
  return {
    key: field.key,
    label,
    placeholder,
    secret: field.kind === "secret",
    optional: true,
    kind: field.kind,
    options: field.kind === "enum" ? choices : undefined,
  };
}

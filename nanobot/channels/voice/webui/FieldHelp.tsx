import { Fragment } from "react";

/**
 * A field's help line. The validator writes what a user would type (a device name, an
 * environment variable, a command) between backticks; those become inline code so they
 * read as literals next to the option names, which stay plain words.
 */
export function FieldHelp({ text }: { text?: string }) {
  if (!text) return null;
  const parts = text.split("`");
  return (
    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
      {parts.map((part, index) => (index % 2 ? (
        <code
          key={index}
          className="rounded-[4px] bg-background px-[3px] font-mono text-[10px] text-foreground/80 ring-1 ring-inset ring-border/35"
        >
          {part}
        </code>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      )))}
    </p>
  );
}

import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { Delta, Ref } from "../core";
import type { CustomField } from "../customFields/customFields";
import type { Status, Task } from "../tasks/tasks";
import { useLiveQuery } from "../useQuery";
import { CheckIcon, FlagIcon, NoPriorityIcon, PeopleIcon } from "./icons";
import {
  avatarColor,
  cx,
  fill,
  initials,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
} from "./palette";

export interface AvatarProps {
  /** A user or team, e.g. `task.creator` or one of `task.assignees`. */
  of: Ref<"user" | "team">;
  /** Diameter in px; 28 by default. */
  size?: number;
  className?: string;
}

const DEFAULT_AVATAR_SIZE = 28;
const MIN_INITIALS_PX = 12;

function avatarStyle(size: number): CSSProperties {
  return {
    fontSize: Math.max(MIN_INITIALS_PX, Math.round(size * 0.42)),
    height: size,
    width: size,
  };
}

const AVATAR_CLASS =
  "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold leading-none tracking-tight";

/** A round avatar: the image, else initials for a user or a people glyph for a team. */
export function Avatar({
  of,
  size = DEFAULT_AVATAR_SIZE,
  className,
}: AvatarProps): ReactElement {
  const base = cx(AVATAR_CLASS, className);
  if (of.image) {
    return (
      <span className={base} style={avatarStyle(size)} title={of.name}>
        <img
          alt={of.name}
          className="h-full w-full object-cover"
          src={of.image}
        />
      </span>
    );
  }
  const { background, text } = fill(avatarColor(of.id))!;
  return (
    <span
      aria-label={of.name}
      className={base}
      role="img"
      style={{ ...avatarStyle(size), backgroundColor: background, color: text }}
      title={of.name}
    >
      {of.kind === "team" ? (
        <PeopleIcon height="1.25em" width="1.25em" />
      ) : (
        initials(of.name)
      )}
    </span>
  );
}

export interface AvatarGroupProps {
  /** Users and teams, e.g. `task.assignees`. */
  of: Array<Ref<"user" | "team">>;
  /** How many to show before the rest collapse into a `+N` bubble; 3 by default. */
  max?: number;
  /** Diameter of each avatar in px; 28 by default. */
  size?: number;
  className?: string;
}

/** Overlapping avatars with a `+N` bubble for the overflow; renders nothing for an empty list. */
export function AvatarGroup({
  of,
  max = 3,
  size = DEFAULT_AVATAR_SIZE,
  className,
}: AvatarGroupProps): ReactElement | null {
  if (of.length === 0) {
    return null;
  }
  const shown = of.length > max ? of.slice(0, max) : of;
  const hidden = of.length - shown.length;
  const overlap = { marginLeft: -Math.round(size / 5) };
  return (
    <span className={cx("inline-flex items-center", className)}>
      {shown.map((member, index) => (
        <span
          className="inline-flex"
          key={`${member.kind}:${member.id}`}
          style={index > 0 ? overlap : undefined}
        >
          <Avatar className="ring-2 ring-background" of={member} size={size} />
        </span>
      ))}
      {hidden > 0 && (
        <span
          className={cx(
            AVATAR_CLASS,
            "bg-muted text-muted-foreground ring-2 ring-background",
          )}
          style={{ ...avatarStyle(size), ...overlap }}
        >
          +{hidden}
        </span>
      )}
    </span>
  );
}

export interface StatusBadgeProps {
  /** `task.status`, or one from `useStatuses`. */
  status: Status;
  className?: string;
}

/** The status name as ClickUp's filled, uppercase badge. Sized by the surrounding font; `className="text-xs"` makes it compact. */
export function StatusBadge({
  status,
  className,
}: StatusBadgeProps): ReactElement {
  return (
    <Pill
      className={cx(
        "rounded-md px-[0.7em] py-[0.36em] font-semibold uppercase tracking-wide",
        className,
      )}
      color={status.color}
    >
      {status.name}
    </Pill>
  );
}

export interface PriorityFlagProps {
  /** `task.priority`; `undefined` renders nothing unless `showEmpty`. */
  priority: Task["priority"];
  /** Renders a slashed circle for `undefined`; off by default. */
  showEmpty?: boolean;
  className?: string;
}

/** ClickUp's priority flag, without a label. Sized by the surrounding font. */
export function PriorityFlag({
  priority,
  showEmpty = false,
  className,
}: PriorityFlagProps): ReactElement | null {
  if (!priority && !showEmpty) {
    return null;
  }
  const color =
    priority && priority !== "low" ? PRIORITY_COLORS[priority] : undefined;
  return (
    <span
      aria-label={priority ? PRIORITY_LABELS[priority] : "No priority"}
      className={cx(
        "inline-flex items-center",
        !color && "text-muted-foreground",
        className,
      )}
      role="img"
    >
      {priority ? (
        <FlagIcon style={color ? { color } : undefined} />
      ) : (
        <NoPriorityIcon />
      )}
    </span>
  );
}

export interface TagProps {
  /** One of `task.tags`. */
  tag: Task["tags"][number];
  className?: string;
}

/** A tag as ClickUp's filled pill. Sized by the surrounding font. */
export function Tag({ tag, className }: TagProps): ReactElement {
  return (
    <Pill
      className={cx("rounded-full px-[0.85em] py-[0.32em]", className)}
      color={tag.color}
    >
      {tag.name}
    </Pill>
  );
}

export interface CustomFieldValueProps {
  /** One of `task.customFields`. */
  value: Task["customFields"][number];
  /** The field's definition from `useCustomFields`, matched by `id`; adds the option colors. */
  field?: CustomField;
  className?: string;
}

const PROGRESS_TYPES = new Set<CustomField["type"]>([
  "manual_progress",
  "automatic_progress",
]);

/**
 * A custom field value in the shape its type calls for: a check, a number, a
 * progress bar, a date, colored option pills, avatars for people, names for
 * tasks, links for attachments. Sized by the surrounding font.
 */
export function CustomFieldValue({
  value,
  field,
  className,
}: CustomFieldValueProps): ReactElement {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 text-foreground",
        className,
      )}
    >
      {renderFieldValue(value, field)}
    </span>
  );
}

function renderFieldValue(
  { type, value }: Task["customFields"][number],
  field: CustomField | undefined,
): ReactNode {
  if (typeof value === "boolean") {
    return value ? (
      <CheckIcon aria-hidden={false} aria-label="Yes" role="img" />
    ) : (
      <span aria-label="No" className="text-muted-foreground" role="img">
        –
      </span>
    );
  }
  if (typeof value === "number") {
    return PROGRESS_TYPES.has(type) ? (
      <Progress percent={value} />
    ) : (
      value.toLocaleString()
    );
  }
  if (typeof value === "string") {
    if (type === "date") {
      return formatDate(value);
    }
    if (type === "drop_down") {
      return <OptionPill field={field} name={value} />;
    }
    return value;
  }
  if (type === "attachment") {
    return (value as string[]).map((url) => (
      <a
        className="underline"
        href={url}
        key={url}
        rel="noreferrer"
        target="_blank"
      >
        {fileName(url)}
      </a>
    ));
  }
  if (type === "labels") {
    return (value as string[]).map((name) => (
      <OptionPill field={field} key={name} name={name} />
    ));
  }
  const refs = value as Array<Ref<"user" | "team" | "task">>;
  if (type === "users") {
    return <AvatarGroup of={refs as Array<Ref<"user" | "team">>} size={24} />;
  }
  return refs.map((ref) => ref.name).join(", ");
}

function fileName(url: string): string {
  const last = url.split("?")[0]!.split("/").pop();
  return last ? decodeURIComponent(last) : url;
}

function OptionPill({
  field,
  name,
}: {
  field: CustomField | undefined;
  name: string;
}) {
  const color = field?.options?.find((option) => option.name === name)?.color;
  return (
    <Pill className="rounded-full px-[0.75em] py-[0.25em]" color={color}>
      {name}
    </Pill>
  );
}

function Progress({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <>
      <span
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={clamped}
        className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <span
          className="block h-full bg-foreground"
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="text-muted-foreground">{Math.round(clamped)}%</span>
    </>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

/** A filled pill with readable text; an unusable color falls back to the muted token. */
function Pill({
  children,
  className,
  color,
}: {
  children: ReactNode;
  className: string;
  color: string | undefined;
}) {
  const resolved = color ? fill(color) : undefined;
  const style: CSSProperties | undefined = resolved
    ? { backgroundColor: resolved.background, color: resolved.text }
    : undefined;
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap leading-none",
        !resolved && "bg-muted text-foreground",
        (!resolved || resolved.edge) && "ring-1 ring-inset ring-foreground/15",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

export interface RichTextProps {
  /** A task or comment `body`. */
  value: Delta;
  className?: string;
}

/**
 * A body as ClickUp shows it, rendered by the host: mentions, tables, embeds
 * and the rest. Empty while the HTML loads; plain text if the host cannot
 * render it.
 */
export function RichText({ value, className }: RichTextProps): ReactElement {
  const { data, isError } = useLiveQuery(
    "html",
    value,
    async (client) => [{ html: await client.toHtml(value) }],
    { cache: false },
  );
  const classes = cx("prose prose-sm max-w-none dark:prose-invert", className);
  if (isError) {
    return (
      <div className={cx(classes, "whitespace-pre-wrap")}>
        {plainText(value)}
      </div>
    );
  }
  return (
    <div
      className={classes}
      dangerouslySetInnerHTML={{ __html: data?.[0]?.html ?? "" }}
    />
  );
}

function plainText({ ops }: Delta): string {
  return ops
    .map((op) => (typeof op.insert === "string" ? op.insert : ""))
    .join("");
}

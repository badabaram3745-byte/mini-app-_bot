import type { Delta, Ref } from "./core";
import type { CustomField } from "./customFields";
import type { Status, Task } from "./tasks";
import type { ReactElement } from "react";

export interface AvatarProps {
    /** A user or team, e.g. `task.creator` or one of `task.assignees`. */
    of: Ref<"user" | "team">;
    /** Diameter in px; 28 by default. */
    size?: number;
    className?: string;
}
/** A round avatar: the image, else initials for a user or a people glyph for a team. */
export declare function Avatar({ of, size, className, }: AvatarProps): ReactElement;
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
export declare function AvatarGroup({ of, max, size, className, }: AvatarGroupProps): ReactElement | null;
export interface StatusBadgeProps {
    /** `task.status`, or one from `useStatuses`. */
    status: Status;
    className?: string;
}
/** The status name as ClickUp's filled, uppercase badge. Sized by the surrounding font; `className="text-xs"` makes it compact. */
export declare function StatusBadge({ status, className, }: StatusBadgeProps): ReactElement;
export interface PriorityFlagProps {
    /** `task.priority`; `undefined` renders nothing unless `showEmpty`. */
    priority: Task["priority"];
    /** Renders a slashed circle for `undefined`; off by default. */
    showEmpty?: boolean;
    className?: string;
}
/** ClickUp's priority flag, without a label. Sized by the surrounding font. */
export declare function PriorityFlag({ priority, showEmpty, className, }: PriorityFlagProps): ReactElement | null;
export interface TagProps {
    /** One of `task.tags`. */
    tag: Task["tags"][number];
    className?: string;
}
/** A tag as ClickUp's filled pill. Sized by the surrounding font. */
export declare function Tag({ tag, className }: TagProps): ReactElement;
export interface CustomFieldValueProps {
    /** One of `task.customFields`. */
    value: Task["customFields"][number];
    /** The field's definition from `useCustomFields`, matched by `id`; adds the option colors. */
    field?: CustomField;
    className?: string;
}
/**
 * A custom field value in the shape its type calls for: a check, a number, a
 * progress bar, a date, colored option pills, avatars for people, names for
 * tasks, links for attachments. Sized by the surrounding font.
 */
export declare function CustomFieldValue({ value, field, className, }: CustomFieldValueProps): ReactElement;
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
export declare function RichText({ value, className }: RichTextProps): ReactElement;

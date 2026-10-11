# Live Artifacts

A live artifact is one that fetches its ClickUp data at view time instead of shipping a copy. Use it for anything that should reflect the workspace as it is now: task boards, dashboards, sprint trackers, inboxes.

Hardcode what the artifact is about, never what it shows. The ids of the list, space or tasks the user pointed at go in the code; everything about them (names, statuses, assignees, counts) is fetched at view time. Baked-in data goes stale and leaks: every viewer would see what you had access to. Reads and writes run as the viewer, so what they see depends on who they are and can be empty. The artifact-creator skill's safety rules still apply.

## Read live data

The kit is in every project as `kits/clickup`; use one hook per kind:

```jsx
import { PriorityFlag, StatusBadge, useLists, useTasks } from "@kits/clickup";

const SPRINT_LIST_ID = "901234567"; // the list the user asked about

export default function App() {
  const list = useLists([SPRINT_LIST_ID]);
  const tasks = useTasks({
    parent: SPRINT_LIST_ID,
    assignees: ["me"],
    dueAt: "overdue",
  });
  return (
    <main>
      <h1>{list.data?.[0]?.name ?? "Sprint"}</h1>
      <Overdue tasks={tasks} />
    </main>
  );
}

function Overdue({ tasks }) {
  if (tasks.error) {
    return <p role="alert">Live data could not load: {tasks.error.message}</p>;
  }
  if (tasks.isPending) {
    return <p aria-busy="true">Loading…</p>;
  }
  if (tasks.data.length === 0) {
    return <p>Nothing of yours is overdue.</p>;
  }
  return (
    <ul>
      {tasks.data.map((task) => (
        <li key={task.id} className="flex items-center gap-2">
          <PriorityFlag priority={task.priority} />
          {task.name}
          <StatusBadge className="text-xs" status={task.status} />
        </li>
      ))}
    </ul>
  );
}
```

## Kinds

The kit covers spaces, folders, lists, custom fields, tasks with their statuses and types, comments, users, teams, inbox, reminders and search. Each kind has a `use<Kinds>` hook; `clickup.<kinds>` has the same reads as plain promises, plus the writes. Before using a kind, read its reference file in `kits/clickup/docs/`: fields, selector, filters and writes. Spaces, folders and lists are in `hierarchy.d.ts`, users and teams in `people.d.ts`. `Avatar`, `AvatarGroup`, `StatusBadge`, `PriorityFlag`, `Tag` and `CustomFieldValue` render assignees, statuses, priorities, tags and custom fields; `RichText` renders a task or comment `body` (`docs/components.d.ts`). `kits/clickup/src/` is the kit's source, there when a question outlives the docs; read `docs/` first.

`clickup.viewer` is the user looking at the artifact; `clickup.navigate(url)` opens a ClickUp url; `clickup.askBrain(prompt)` sends a prompt to Brain.

## How the kit works

- Every asset is a `Ref`, `{ kind, id, name, url }`, plus the fields of its kind; full assets also carry `ancestors`, from the space down.
- Hooks return TanStack Query v5's `useQuery` result (`data`, `error`, `isPending`, `isFetching`, and the rest) and take its `enabled`, `placeholderData` and `refetchInterval` options. The same selector shares one request across components. A hook first shows what the viewer saw last time, then loads fresh data, so `data` is often set while `isFetching` is true: keep showing it rather than a spinner.
- Every failure is a `LiveError` with a `code`. `invalid`: your selector or input is wrong; fix the code. `forbidden`: the viewer is not allowed to; hide the feature. `failed`: something went wrong; retry when `retryable`. `denied`: the viewer declined a write.
- Dates are ISO 8601 strings; inputs also take `YYYY-MM-DD`.

## Writes

There are no write hooks. Create and update with the `clickup` methods (`clickup.tasks.update(task, patch)`, `clickup.tasks.create(input)`, and so on), wrapped in `useMutation({ mutationFn })` and called from an event handler. Every changed field needs the viewer's approval in ClickUp, so a write stops at the first denial and can stay pending for a while. The kit does the rest: lists on screen update optimistically, roll back if the viewer declines, and refetch once ClickUp confirms. Don't `refetch()` after a write or mirror it in local state.

```jsx
import { clickup, useMutation, useStatuses } from "@kits/clickup";

export default function TaskRow({ task }) {
  const list = task.ancestors.find((ref) => ref.kind === "list");
  const statuses = useStatuses({ parent: list }, { enabled: !!list });
  const done = statuses.data?.find((status) => status.type === "done");
  const complete = useMutation({
    mutationFn: (status) => clickup.tasks.update(task, { status }),
  });

  return (
    <li>
      {task.name}
      <button
        disabled={!done || complete.isPending}
        onClick={() => complete.mutate(done)}
      >
        {complete.isPending ? "Waiting for approval…" : "Mark done"}
      </button>
      {complete.isError && <p role="alert">{complete.error.message}</p>}
    </li>
  );
}
```

## Design for data you have not seen

What you see while authoring is a sample: for another viewer any optional field can be missing, text can be far longer or shorter, and a query can return nothing or hit the limit. Design the loading, empty and error states: keep the layout with a skeleton while loading, say what came up empty, and when live data could not load, say so and keep the rest usable. Never invent replacement data, and render live values as text, never as HTML.

The sandbox preview does not restrict reads and only pretends to write, so you will never see a `forbidden` state there and nothing changes after a write. Design both anyway.

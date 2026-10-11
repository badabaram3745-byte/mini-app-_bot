import type { LiveBridge } from "../host/bridge";
import { perform } from "../host/perform";
import { ArtifactWriteActionType as Action } from "../host/wire";
import type { ChecklistItem, Task } from "./tasks";

/** The `parent` value that puts a checklist item at the top level (`CHECKLIST_ITEM_NO_PARENT` in the protocol's schemas). */
const CHECKLIST_ITEM_NO_PARENT = "none";

/** Syncs the task's checklists to `next`, diffed by id. */
export async function syncChecklists(
  host: LiveBridge,
  task: Task,
  next: ChecklistItem[],
): Promise<void> {
  const taskId = task.id;
  const current = new Map(task.checklists.map((list) => [list.id, list]));
  for (const checklist of next) {
    const existing = current.get(checklist.id);
    if (!existing) {
      const outcome = await perform(host, Action.CreateChecklist, {
        taskId,
        name: checklist.name,
      });
      const checklistId = outcome.result?.id;
      if (checklistId) {
        await syncChecklistItems(
          host,
          taskId,
          checklistId,
          [],
          checklist.items,
        );
      }
      continue;
    }
    current.delete(checklist.id);
    if (existing.name !== checklist.name) {
      await perform(host, Action.SetChecklistName, {
        taskId,
        checklistId: checklist.id,
        name: checklist.name,
      });
    }
    await syncChecklistItems(
      host,
      taskId,
      checklist.id,
      existing.items,
      checklist.items,
    );
  }
  for (const removed of current.values()) {
    await perform(host, Action.DeleteChecklist, {
      taskId,
      checklistId: removed.id,
    });
  }
}

async function syncChecklistItems(
  host: LiveBridge,
  taskId: string,
  checklistId: string,
  current: ChecklistItem[],
  next: ChecklistItem[],
): Promise<void> {
  const target = { taskId, checklistId };
  const existing = new Map(
    flattenItems(current, CHECKLIST_ITEM_NO_PARENT).map((entry) => [
      entry.item.id,
      entry,
    ]),
  );
  const kept = new Set<string>();
  const sync = async (
    items: ChecklistItem[],
    parent: string,
  ): Promise<void> => {
    for (const item of items) {
      const before = existing.get(item.id);
      let itemId: string | undefined = item.id;
      if (before) {
        kept.add(item.id);
        if (before.item.name !== item.name) {
          await perform(host, Action.SetChecklistItemName, {
            ...target,
            itemId: item.id,
            name: item.name,
          });
        }
        if (item.done !== undefined && before.item.done !== item.done) {
          await perform(host, Action.SetChecklistItemResolved, {
            ...target,
            itemId: item.id,
            resolved: String(item.done),
          });
        }
        if (before.parent !== parent) {
          await perform(host, Action.SetChecklistItemParent, {
            ...target,
            itemId: item.id,
            parent,
          });
        }
      } else {
        const outcome = await perform(host, Action.CreateChecklistItem, {
          ...target,
          name: item.name,
        });
        itemId = outcome.result?.id;
        if (itemId && parent !== CHECKLIST_ITEM_NO_PARENT) {
          await perform(host, Action.SetChecklistItemParent, {
            ...target,
            itemId,
            parent,
          });
        }
        if (itemId && item.done) {
          await perform(host, Action.SetChecklistItemResolved, {
            ...target,
            itemId,
            resolved: "true",
          });
        }
      }
      if (itemId) {
        await sync(item.items, itemId);
      }
    }
  };
  await sync(next, CHECKLIST_ITEM_NO_PARENT);
  for (const itemId of existing.keys()) {
    if (!kept.has(itemId)) {
      await perform(host, Action.DeleteChecklistItem, { ...target, itemId });
    }
  }
}

/** Every item at every depth with the id of the item above it. */
function flattenItems(
  items: ChecklistItem[],
  parent: string,
): Array<{ item: ChecklistItem; parent: string }> {
  return items.flatMap((item) => [
    { item, parent },
    ...flattenItems(item.items, item.id),
  ]);
}

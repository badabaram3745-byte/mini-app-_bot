# Shadcn UI

Use shadcn when an artifact needs working controls: dialogs, menus, forms, tables, calendars, tabs. The kit is in every project as `kits/shadcn`; import any component or helper by name:

```jsx
import { Button, Dialog, DialogContent, DialogTrigger, cn } from "@kits/shadcn";
```

The installed kit's `kits/shadcn/docs/components.md` lists every export by component, and each component's source sits in `kits/shadcn/src/`.

Runtime: React 18, Tailwind 3.4, Recharts 2.15, DayPicker 9.8, Embla 8.6, Sonner 1.7, React Hook Form 7, Zod 3, and Lucide 0.577.

## Principles

1. **Shadcn supplies behavior, never identity.** Build expressive surfaces such as heroes, landing pages, and decks in your own layout; use shadcn where a control needs its interaction mechanics. Derive its theme from the artifact's design plan by overriding the CSS variables in any imported CSS file:

   ```css
   :root {
     --primary: #147d64;
     --accent: oklch(82% 0.12 72);
     --radius: 0;
   }
   ```

2. **Compose, don't reinvent.** Settings page = Tabs + Card + form controls. Dashboard = Sidebar + Card + Chart + Table. Combobox = Popover + Command.
3. **Use built-in variants before custom styles.** `variant="outline"`, `size="sm"`, etc.
4. **Use semantic colors.** `bg-primary`, `text-muted-foreground` — never raw values like `bg-blue-500`. These Tailwind utilities are wired to the theme tokens and work in your own layout too.

## Rules

Styling:

- **`className` for layout, not styling.** Theme through tokens; never override component colors or typography per instance.
- **No `space-x-*`/`space-y-*`.** Use `flex` with `gap-*`; vertical stacks are `flex flex-col gap-*`.
- **`size-10`, not `w-10 h-10`.** And `truncate`, not the three-class ellipsis combo.
- **`cn()` for conditional classes**, not template-literal ternaries.
- **No manual `z-index` on overlays.** Dialog, Sheet, Popover handle their own stacking.

Forms:

- **Form layout uses `FieldGroup` + `Field`** with `FieldLabel`, `FieldDescription`, `FieldError` — never raw `div`s with `space-y-*`:

```jsx
<FieldGroup>
  <Field>
    <FieldLabel htmlFor="email">Email</FieldLabel>
    <Input id="email" />
    <FieldDescription>We never share it.</FieldDescription>
  </Field>
</FieldGroup>
```

- **`FieldSet` + `FieldLegend`** for grouping related checkboxes/radios.
- **`InputGroup` uses `InputGroupInput`/`InputGroupTextarea`**, never raw `Input` inside; buttons and affixes inside inputs use `InputGroupAddon`.
- **Option sets of 2–7 choices use `ToggleGroup`**, not looped `Button`s with manual active state.

Composition:

- **Items always inside their Group.** `SelectItem` → `SelectGroup`, `DropdownMenuItem` → `DropdownMenuGroup`, `CommandItem` → `CommandGroup`, `TabsTrigger` → `TabsList`.
- **Custom triggers use `asChild`.**
- **Dialog, Sheet, and Drawer always need a Title** (`className="sr-only"` if visually hidden).
- **Use full Card composition** — `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`, not everything dumped in `CardContent`.
- **Button has no `isLoading`.** Compose `Spinner` + `disabled`.
- **Icons come from `lucide-react`.** Inside buttons they need no sizing classes; the component sizes them.
- **`Avatar` always needs `AvatarFallback`.**
- **Components before custom markup.** Callouts are `Alert`, empty states are `Empty`, loading placeholders are `Skeleton`, dividers are `Separator`, status labels are `Badge`, toasts are `toast()` from `sonner` with one `<Toaster />` rendered.

## Component Selection

| Need                       | Use                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Button/action              | `Button` with appropriate variant, `ButtonGroup`                                        |
| Form inputs                | `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Slider`, `InputOTP`, `Calendar` |
| Toggle between 2–7 options | `ToggleGroup` + `ToggleGroupItem`                                                       |
| Data display               | `Table`, `Card`, `Badge`, `Avatar`, `Item`, `Kbd`                                       |
| Navigation                 | `Sidebar`, `NavigationMenu`, `Breadcrumb`, `Tabs`, `Pagination`                         |
| Overlays                   | `Dialog` (modal), `Sheet` (side panel), `Drawer` (bottom sheet), `AlertDialog` (confirmation) |
| Feedback                   | `toast()` from `sonner`, `Alert`, `Progress`, `Skeleton`, `Spinner`, `Empty`            |
| Command palette            | `Command` inside `Dialog`                                                               |
| Charts                     | `ChartContainer` + Recharts primitives                                                  |
| Layout                     | `Card`, `Separator`, `Resizable`, `ScrollArea`, `Accordion`, `Collapsible`, `AspectRatio` |
| Menus                      | `DropdownMenu`, `ContextMenu`, `Menubar`                                                |
| Tooltips/info              | `Tooltip`, `HoverCard`, `Popover`                                                       |

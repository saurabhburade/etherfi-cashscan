"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value className={cn("flex flex-1 text-left", className)} data-slot="select-value" {...props} />
  );
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "group/select-trigger flex h-10 w-fit items-center justify-between gap-1.5 rounded-full border border-transparent bg-input/50 px-3 py-2 text-sm whitespace-nowrap outline-none transition-[color,background-color,border-color,box-shadow] duration-200 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground [&_svg]:shrink-0",
        className,
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-3.5 text-muted-foreground transition-transform duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-data-popup-open/select-trigger:rotate-180 motion-reduce:duration-0" />
        }
      />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  ...props
}: SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner align={align} className="isolate z-50" side={side} sideOffset={sideOffset}>
        <SelectPrimitive.Popup
          className={cn(
            "group/select-popup relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] data-starting-style:scale-y-75 data-starting-style:opacity-0 data-starting-style:blur-[3px] data-ending-style:scale-y-90 data-ending-style:opacity-0 data-ending-style:blur-[3px] motion-reduce:duration-[100ms] motion-reduce:data-starting-style:scale-y-100 motion-reduce:data-starting-style:blur-none motion-reduce:data-ending-style:scale-y-100 motion-reduce:data-ending-style:blur-none dark:ring-foreground/10",
            className,
          )}
          data-slot="select-content"
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow className="flex w-full items-center justify-center py-1">
            <ChevronUpIcon className="size-4" />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow className="flex w-full items-center justify-center py-1">
            <ChevronDownIcon className="size-4" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-10 w-full cursor-default items-center gap-2 rounded-xl py-1.5 pr-8 pl-2 text-sm outline-hidden transition-[color,background-color,opacity,transform,filter] duration-200 select-none focus:bg-accent focus:text-accent-foreground group-data-starting-style/select-popup:-translate-y-1.5 group-data-starting-style/select-popup:opacity-0 group-data-starting-style/select-popup:blur-[3px] group-data-ending-style/select-popup:-translate-y-1 group-data-ending-style/select-popup:opacity-0 group-data-ending-style/select-popup:blur-[3px] motion-reduce:duration-[100ms] motion-reduce:group-data-starting-style/select-popup:translate-y-0 motion-reduce:group-data-starting-style/select-popup:blur-none motion-reduce:group-data-ending-style/select-popup:translate-y-0 motion-reduce:group-data-ending-style/select-popup:blur-none data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />}
      >
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };

"use client";

import {
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "~/components/ui/input-group";
import {
  evaluateAmount,
  formatMoney,
  isAmountExpression,
  minorToInput,
} from "~/lib/money";
import { cn } from "~/lib/utils";

type AmountInputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "ref"
> & {
  value: string;
  onChange: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
  /** The field holds a signed amount (a balance), not a magnitude */
  allowSign?: boolean;
  /** Addons before and after the text, e.g. the sign and the currency */
  start?: ReactNode;
  end?: ReactNode;
  /** Classes of the group, which draws the border */
  groupClassName?: string;
};

/**
 * An amount field that also takes arithmetic: while the
 * text is an expression (`120+35,5`) the result shows inside the field, and
 * blur or Enter replace the text with it. Escape puts back what the field
 * held before. Text starting with an operator continues that earlier value,
 * so `+50` on 100 gives 150.
 */
export function AmountInput({
  value,
  onChange,
  ref,
  allowSign = false,
  start,
  end,
  groupClassName,
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: AmountInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // what the field held when it got focus: Escape's target and the base of
  // an expression that starts with an operator
  const before = useRef({ text: value, minor: null as number | null });
  const [focused, setFocused] = useState(false);

  const expression = isAmountExpression(value, { allowSign });
  const result = expression
    ? evaluateAmount(value, { allowSign, base: before.current.minor })
    : null;

  const setRef = (element: HTMLInputElement | null) => {
    inputRef.current = element;

    if (typeof ref === "function") {
      ref(element);
    } else if (ref) {
      ref.current = element;
    }
  };

  const commit = () => {
    if (expression && result !== null) {
      onChange(minorToInput(result));
    }
  };

  // Radix closes a dialog on Escape from a capturing document listener, so
  // an Escape that only undoes an expression is caught earlier, on window
  useEffect(() => {
    if (!focused || !expression) {
      return;
    }

    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.target !== inputRef.current) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      onChange(before.current.text);
    };

    window.addEventListener("keydown", onEscape, true);

    return () => window.removeEventListener("keydown", onEscape, true);
  }, [focused, expression, onChange]);

  return (
    <InputGroup className={groupClassName}>
      {start}
      <InputGroupInput
        {...props}
        ref={setRef}
        value={value}
        inputMode="decimal"
        autoComplete="off"
        className={cn("tabular-nums", className)}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event: FocusEvent<HTMLInputElement>) => {
          before.current = {
            text: value,
            minor: evaluateAmount(value, { allowSign }),
          };
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event: FocusEvent<HTMLInputElement>) => {
          commit();
          setFocused(false);
          onBlur?.(event);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          // before the form submits or the next field takes over
          if (event.key === "Enter") {
            commit();
          }

          onKeyDown?.(event);
        }}
      />
      {expression ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText className="tabular-nums" aria-live="polite">
            = {result === null ? "—" : formatMoney(result)}
          </InputGroupText>
        </InputGroupAddon>
      ) : null}
      {end}
    </InputGroup>
  );
}

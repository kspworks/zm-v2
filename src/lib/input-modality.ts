let lastInput: "pointer" | "keyboard" = "keyboard";

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      lastInput = "pointer";
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
        lastInput = "keyboard";
      }
    },
    true,
  );
}

export const lastInputWasPointer = () => lastInput === "pointer";

/**
 * Radix hands focus back to the trigger when a popup closes, and Chrome
 * draws a focus-visible ring for that scripted focus even after a click.
 * Keep the return for keyboard users only; after a pointer close the focus
 * stays where the user clicked.
 */
export const pointerAwareCloseAutoFocus =
  (handler?: (event: Event) => void) => (event: Event) => {
    handler?.(event);
    if (!event.defaultPrevented && lastInputWasPointer()) {
      event.preventDefault();
    }
  };

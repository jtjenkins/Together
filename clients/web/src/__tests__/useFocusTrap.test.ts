import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

/** Helper: render useFocusTrap with a real DOM container built from static test markup. */
function renderTrap(
  elements: Array<{ tag: string; id: string; attrs?: Record<string, string> }>,
  active: boolean,
) {
  const container = document.createElement("div");
  for (const el of elements) {
    const node = document.createElement(el.tag);
    node.id = el.id;
    if (el.attrs) {
      for (const [k, v] of Object.entries(el.attrs)) {
        node.setAttribute(k, v);
      }
    }
    node.textContent = el.id;
    container.appendChild(node);
  }
  document.body.appendChild(container);

  const { result, rerender, unmount } = renderHook(
    ({ active: a }) => {
      const ref = useRef<HTMLElement>(container);
      useFocusTrap(ref, a);
      return ref;
    },
    { initialProps: { active } },
  );

  return { container, result, rerender, unmount };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("useFocusTrap", () => {
  it("should focus the first focusable element when activated", () => {
    const { container } = renderTrap(
      [
        { tag: "button", id: "a" },
        { tag: "button", id: "b" },
      ],
      true,
    );

    const first = container.querySelector("#a") as HTMLElement;
    expect(document.activeElement).toBe(first);
  });

  it("should not focus anything when inactive", () => {
    const focusBefore = document.activeElement;
    renderTrap(
      [
        { tag: "button", id: "a" },
        { tag: "button", id: "b" },
      ],
      false,
    );

    expect(document.activeElement).toBe(focusBefore);
  });

  it("should wrap focus from last to first on Tab", () => {
    const { container } = renderTrap(
      [
        { tag: "button", id: "a" },
        { tag: "button", id: "b" },
      ],
      true,
    );

    const first = container.querySelector("#a") as HTMLElement;
    const last = container.querySelector("#b") as HTMLElement;

    last.focus();
    expect(document.activeElement).toBe(last);

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
    });
    const prevented = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    expect(prevented).toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });

  it("should wrap focus from first to last on Shift+Tab", () => {
    const { container } = renderTrap(
      [
        { tag: "button", id: "a" },
        { tag: "button", id: "b" },
      ],
      true,
    );

    const first = container.querySelector("#a") as HTMLElement;
    const last = container.querySelector("#b") as HTMLElement;

    expect(document.activeElement).toBe(first);

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    });
    const prevented = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    expect(prevented).toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
  });

  it("should not trap non-Tab keys", () => {
    renderTrap(
      [
        { tag: "button", id: "a" },
        { tag: "button", id: "b" },
      ],
      true,
    );

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    });
    const prevented = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);

    expect(prevented).not.toHaveBeenCalled();
  });

  it("should restore focus to previously focused element on deactivation", () => {
    const outsideButton = document.createElement("button");
    outsideButton.id = "outside";
    document.body.appendChild(outsideButton);
    outsideButton.focus();
    expect(document.activeElement).toBe(outsideButton);

    const { rerender, container } = renderTrap(
      [
        { tag: "button", id: "a" },
        { tag: "button", id: "b" },
      ],
      true,
    );

    const first = container.querySelector("#a") as HTMLElement;
    expect(document.activeElement).toBe(first);

    rerender({ active: false });

    expect(document.activeElement).toBe(outsideButton);
  });

  it("should handle container with no focusable elements (dev warning)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const container = document.createElement("div");
    const div = document.createElement("div");
    div.textContent = "No focusable elements";
    container.appendChild(div);
    document.body.appendChild(container);

    renderHook(() => {
      const ref = useRef<HTMLElement>(container);
      useFocusTrap(ref, true);
    });

    warnSpy.mockRestore();
  });

  it("should handle null ref gracefully", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => {
      const ref = useRef<HTMLElement | null>(null);
      useFocusTrap(ref, true);
    });

    warnSpy.mockRestore();
  });

  it("should find inputs, links, and textareas as focusable", () => {
    const { container } = renderTrap(
      [
        { tag: "input", id: "i" },
        { tag: "a", id: "l", attrs: { href: "#" } },
        { tag: "textarea", id: "t" },
      ],
      true,
    );

    const input = container.querySelector("#i") as HTMLElement;
    expect(document.activeElement).toBe(input);
  });

  it("should find elements with tabindex as focusable", () => {
    const { container } = renderTrap(
      [
        { tag: "div", id: "d1", attrs: { tabindex: "0" } },
        { tag: "div", id: "d2", attrs: { tabindex: "0" } },
      ],
      true,
    );

    const d1 = container.querySelector("#d1") as HTMLElement;
    expect(document.activeElement).toBe(d1);
  });

  it("should exclude tabindex='-1' from focusable elements", () => {
    const { container } = renderTrap(
      [
        { tag: "div", id: "hidden", attrs: { tabindex: "-1" } },
        { tag: "button", id: "btn" },
      ],
      true,
    );

    const btn = container.querySelector("#btn") as HTMLElement;
    expect(document.activeElement).toBe(btn);
  });

  it("should remove keydown listener on unmount", () => {
    const { unmount, container } = renderTrap(
      [
        { tag: "button", id: "a" },
        { tag: "button", id: "b" },
      ],
      true,
    );

    const last = container.querySelector("#b") as HTMLElement;
    const first = container.querySelector("#a") as HTMLElement;

    unmount();

    last.focus();
    expect(document.activeElement).toBe(last);

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
    });
    document.dispatchEvent(event);

    // Trap listener was removed, so focus should not jump to first
    expect(document.activeElement).not.toBe(first);
  });
});

/** Preserve keyboard position when a state broadcast replaces the table DOM. */
export function renderWithFocus(table: HTMLElement, render: () => void): void {
  const active = document.activeElement;
  const key = active instanceof HTMLElement && table.contains(active)
    ? active.dataset.focusKey : undefined;
  render();
  if (!key) return;
  const replacement = Array.from(table.querySelectorAll<HTMLElement>("[data-focus-key]"))
    .find((element) => element.dataset.focusKey === key);
  (replacement ?? table.querySelector<HTMLElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
}

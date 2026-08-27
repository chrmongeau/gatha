/**
 * The view state machine. Four screens, no router library — see SPEC.md §4.
 *
 * It owns the mount point and nothing else: no data, no timers. Screens are
 * built by their own modules and handed here to be shown.
 */
export interface Screen {
  readonly element: HTMLElement;
  destroy(): void;
}

export class Views {
  private current: Screen | null = null;
  private painted = false;

  constructor(private readonly root: HTMLElement) {}

  /**
   * Swap the visible screen. Everything after the first paint cross-fades in
   * and takes focus; the first does neither, so a cold load does not open on a
   * blank screen with a focus ring already drawn on it.
   */
  show(screen: Screen, focus?: HTMLElement | null): void {
    const isTransition = this.painted;
    this.painted = true;

    this.current?.destroy();
    this.current = screen;

    if (isTransition) screen.element.classList.add('is-entering');
    this.root.replaceChildren(screen.element);
    this.root.scrollTop = 0;
    if (isTransition) focus?.focus();
  }
}

/** Keep the entire spectator scene visible without scrolling or clipping it.
 * Measure natural layout; transforms don't affect ResizeObserver dimensions,
 * so live text updates only trigger work when their layout actually changes.
 */
export function fitBoard(viewport: HTMLElement, display: HTMLElement) {
  let previous = '';
  const fit = () => {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return;
    const signature = () =>
      [
        width,
        height,
        display.offsetWidth,
        display.offsetHeight,
        display.scrollWidth,
        display.scrollHeight,
      ].join(':');
    if (signature() === previous) return;
    const fits = (scale: number) => {
      // Reflow into the full screen width at each scale, avoiding empty side
      // margins and needless wrapping when the window is narrow or short.
      display.style.width = `${Math.floor(width / scale)}px`;
      return (
        Math.max(display.scrollHeight, display.offsetHeight) * scale <=
          height && display.scrollWidth * scale <= width
      );
    };
    let fitted = 1;
    if (!fits(1)) {
      let lower = 0.05,
        upper = 1;
      // Bounded search runs only on geometry changes, never on the game loop.
      for (let i = 0; i < 9; i++) {
        const candidate = (lower + upper) / 2;
        if (fits(candidate)) lower = candidate;
        else upper = candidate;
      }
      fitted = Math.floor(lower * 10000) / 10000;
      fits(fitted);
    }
    display.style.setProperty('--board-scale', String(fitted));
    display.style.setProperty(
      '--board-offset',
      `${Math.max(0, (width - display.scrollWidth * fitted) / 2)}px`,
    );
    previous = signature();
  };
  const observer = new ResizeObserver(fit);
  observer.observe(viewport);
  observer.observe(display);
  fit();
  return () => observer.disconnect();
}

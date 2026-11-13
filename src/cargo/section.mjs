import markup from './layout.html?raw';
import css from './layout.css?raw';
import { mountCargo } from './engine.mjs';

export function createCargoSection(dialog) {
  const host = dialog.querySelector('.cargo-host');
  const root = host.attachShadow({mode:'open'});
  let controller;
  let plan = new Map();
  dialog.addEventListener('close', () => {
    controller?.abort();
    root.replaceChildren();
  });
  function open() {
    const style = document.createElement('style');
    style.textContent = css;
    const content = document.createElement('template');
    content.innerHTML = markup;
    root.replaceChildren(style, content.content);
    controller = new AbortController();
    const storage = {
      getItem: key => plan.get(key) ?? null,
      setItem: (key, value) => plan.set(key, value),
    };
    mountCargo(root, root.querySelector('.cargo-root'), storage, controller.signal);
    dialog.showModal();
  }
  return {open, reset() { plan = new Map(); }};
}

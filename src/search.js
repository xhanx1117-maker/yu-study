export const searchKey = value => String(value ?? '').normalize('NFC').toLowerCase();
const delay = 250;

// The browser owns the draft, selection and IME marked range. Only publish a
// committed value. WebKit may send its final input on either side of compositionend.
export function bindSearch(input, apply) {
  let applied = input.value;
  let composing = false, ending = false, timer;
  const listeners = new AbortController();
  const listen = (type, fn) => input.addEventListener(type, fn, {signal:listeners.signal});

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ending = false;
      if (composing || !input.isConnected || input.value === applied) return;
      applied = input.value;
      apply(applied);
    }, delay);
  }
  function begin() {
    composing = true;
    ending = false;
    clearTimeout(timer);
  }
  function edit(event) {
    if (composing || event.isComposing) {
      if (!ending) clearTimeout(timer);
      return;
    }
    ending = false;
    schedule();
  }
  listen('compositionstart', begin);
  listen('compositionupdate', begin);
  listen('compositionend', () => { composing = false; ending = true; schedule(); });
  listen('input', edit);
  listen('search', edit); // Native search-field clear on Safari.

  return {
    reset(value = '') {
      clearTimeout(timer);
      composing = ending = false;
      applied = value;
      if (input.value !== value) input.value = value;
    },
    dispose() {
      clearTimeout(timer);
      listeners.abort();
    }
  };
}

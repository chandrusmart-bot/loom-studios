// Undo/redo over immutable snapshots, with revert to the first state.

export function createHistory(initial) {
  let stack = [initial], at = 0;
  return {
    get current() { return stack[at]; },
    get original() { return stack[0]; },
    get canUndo() { return at > 0; },
    get canRedo() { return at < stack.length - 1; },
    push(state) { stack = stack.slice(0, at + 1); stack.push(state); at++; return state; },
    undo() { if (at > 0) at--; return stack[at]; },
    redo() { if (at < stack.length - 1) at++; return stack[at]; },
    /** Back to the original quantized state; recorded so it can be undone. */
    revert() { return this.push(stack[0]); },
    reset(state) { stack = [state]; at = 0; },
  };
}

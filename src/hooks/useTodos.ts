import { useCallback, useEffect, useMemo, useState } from "react";
import { load, save, uid } from "../lib/storage";

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  /** Carried over unfinished from a previous day. */
  carried?: boolean;
};

type Store = { date: string; todos: Todo[] };

const KEY = "island.todos";
const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

/** New day: finished tasks are cleared, unfinished ones carry over. */
function rollover(s: Store, day: string): Store {
  if (s.date === day) return s;
  return { date: day, todos: s.todos.filter((t) => !t.done).map((t) => ({ ...t, carried: true })) };
}

export function useTodos(now: number) {
  const day = dayKey(now);
  const [store, setStore] = useState<Store>(() => rollover(load<Store>(KEY, { date: dayKey(), todos: [] }), dayKey()));

  useEffect(() => save(KEY, store), [store]);
  useEffect(() => setStore((s) => rollover(s, day)), [day]);

  const add = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setStore((s) => ({ ...s, todos: [...s.todos, { id: uid(), text: t, done: false }] }));
  }, []);
  const toggle = useCallback(
    (id: string) => setStore((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),
    [],
  );
  const edit = useCallback((id: string, text: string) => {
    const t = text.trim();
    setStore((s) => ({
      ...s,
      todos: t ? s.todos.map((x) => (x.id === id ? { ...x, text: t } : x)) : s.todos.filter((x) => x.id !== id),
    }));
  }, []);
  const remove = useCallback((id: string) => setStore((s) => ({ ...s, todos: s.todos.filter((t) => t.id !== id) })), []);
  const clearDone = useCallback(() => setStore((s) => ({ ...s, todos: s.todos.filter((t) => !t.done) })), []);

  // Open tasks first (in the order added), finished ones sink to the bottom.
  const todos = useMemo(() => [...store.todos.filter((t) => !t.done), ...store.todos.filter((t) => t.done)], [store.todos]);
  const doneCount = store.todos.filter((t) => t.done).length;

  return { todos, total: store.todos.length, doneCount, remaining: store.todos.length - doneCount, add, toggle, edit, remove, clearDone };
}

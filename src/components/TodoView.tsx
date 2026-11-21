import { useRef, useState, type KeyboardEvent } from "react";
import type { useTodos } from "../hooks/useTodos";
import { CheckIcon, CloseIcon } from "./Icons";

type Todos = ReturnType<typeof useTodos>;

export function TodoView({ todos }: { todos: Todos }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    todos.add(draft);
    setDraft("");
  };

  const pct = todos.total ? (todos.doneCount / todos.total) * 100 : 0;

  return (
    <div className="todo">
      <div className="todo-head">
        <div>
          <div className="todo-date">
            {new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <div className="todo-summary">
            {todos.total === 0
              ? "Nothing planned yet"
              : todos.remaining === 0
                ? "All done for today"
                : `${todos.remaining} left · ${todos.doneCount} done`}
          </div>
        </div>
        {todos.doneCount > 0 && (
          <button className="text-btn" onClick={todos.clearDone}>
            Clear done
          </button>
        )}
      </div>

      <div className="todo-progress" aria-hidden>
        <div className="todo-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <ul className="todo-list">
        {todos.todos.map((t) => (
          <TodoItem key={t.id} todo={t} todos={todos} />
        ))}
      </ul>

      <div className="todo-add">
        <span className="todo-add-plus" aria-hidden>+</span>
        <input
          ref={inputRef}
          className="todo-input"
          placeholder="Add a task, press Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") inputRef.current?.blur();
          }}
        />
      </div>
    </div>
  );
}

function TodoItem({ todo, todos }: { todo: Todos["todos"][number]; todos: Todos }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(todo.text);

  const commit = () => {
    setEditing(false);
    if (text !== todo.text) todos.edit(todo.id, text);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setText(todo.text);
      setEditing(false);
    }
  };

  return (
    <li className={`todo-item ${todo.done ? "is-done" : ""}`}>
      <button
        className="todo-check"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? "Mark as not done" : "Mark as done"}
        onClick={() => todos.toggle(todo.id)}
      >
        {todo.done && <CheckIcon />}
      </button>
      {editing ? (
        <input className="todo-edit" autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      ) : (
        <span
          className="todo-text"
          title="Double-click to edit"
          onDoubleClick={() => {
            setText(todo.text);
            setEditing(true);
          }}
        >
          {todo.text}
          {todo.carried && !todo.done && <span className="todo-tag">from yesterday</span>}
        </span>
      )}
      <button className="todo-remove" aria-label="Delete task" onClick={() => todos.remove(todo.id)}>
        <CloseIcon />
      </button>
    </li>
  );
}

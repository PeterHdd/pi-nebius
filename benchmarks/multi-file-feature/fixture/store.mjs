const tasks = [];
let nextId = 1;
export function create(title) {
  const task = { id: String(nextId++), title };
  tasks.push(task);
  return task;
}
export function list() {
  return tasks;
}

export function regularTotal(lines, discount = 0) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return subtotal * (1 - discount) + 5;
}
export function priorityTotal(lines, discount = 0) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return subtotal * (1 - discount) + 15;
}

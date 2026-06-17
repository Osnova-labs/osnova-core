export function compareUpdatedDesc<T extends { updatedAt?: string }>(left: T, right: T): number {
  return Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
}

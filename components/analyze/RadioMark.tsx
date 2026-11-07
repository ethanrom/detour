/** A plain radio mark: no icon, no tint. Selected is an ink ring with an ink dot. */
export function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${selected ? "border-ink" : "border-rule-strong bg-surface"}`}
    >
      {selected && <span className="size-2 rounded-full bg-ink" />}
    </span>
  );
}
